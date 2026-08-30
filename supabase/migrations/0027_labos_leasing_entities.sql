-- ============================================================================
-- 0027 · LabOS, part 4: leasing transactions, exposure, traffic
--
-- Milestone 1 scope only — everything the Weekly Summary workbook's SUMMARY,
-- Unit Availability Details, and Traffic Detail sheets can populate. No
-- occupancy%/budget/3-yr-average columns here: those are Trend-workbook-
-- sourced and out of scope until that adapter exists.
--
-- Governance (still deferred, carried from the PRD): resident_ref/
-- prospect_ref are read by the adapter but intentionally left null in
-- Milestone 1 — no resident/prospect name is persisted. Notice/move-out/
-- cancel Reason text is represented only as has_reason (boolean); the
-- verbatim text is not stored. This is the conservative default in the
-- absence of a governance decision, not a resolution of it.
--
-- Confirmed business rule (NEW RENTALS only): a row whose Line column isn't
-- a sequential number ("-", blank) is real data but not an official numbered
-- lease for the week — preserved for audit (line_label, exclusion_reason),
-- excluded from new_rentals_count via is_official_kpi. Every other event
-- type defaults is_official_kpi to true; the columns exist on every row for
-- schema uniformity, not because the ambiguity applies elsewhere.
-- ============================================================================

create type labos.leasing_event_type as enum (
  'new_rental', 'move_in', 'move_out', 'notice', 'renewal', 'cancel_denial'
);

create type labos.new_rental_exclusion_reason as enum (
  'waitlist_placeholder', 'cancelled_or_denied', 'other_unnumbered'
);

create table labos.leasing_transactions (
  id                uuid primary key default gen_random_uuid(),
  sync_run_id       uuid not null references labos.sync_runs(id),   -- source lineage
  property_id       uuid not null references labos.properties(id),
  unit_id           uuid references labos.units(id),                -- nullable: unit not yet in Inventory (V9)
  event_type        labos.leasing_event_type not null,
  resident_ref      text,                        -- intentionally null in Milestone 1 (governance)
  rent              numeric(10,2),
  effective_date    date,
  expiration_date   date,
  move_date         date,
  prior_rent        numeric(10,2),                -- renewals only
  lease_term        text,                         -- 'ST' | 'LT', nullable
  has_reason        boolean not null default false,  -- reason text deliberately not persisted (governance)
  sheet_line_ref    text not null,                 -- e.g. 'SUMMARY!MOVE-INS#3' — idempotency key component
  line_label        text not null,                 -- raw Line column text ("1", "-", "7") — audit trail
  is_official_kpi   boolean not null default true,  -- false only for non-numeric-Line new_rental rows
  exclusion_reason  labos.new_rental_exclusion_reason,
  created_at        timestamptz not null default now(),
  unique (sync_run_id, sheet_line_ref)
);

create type labos.exposure_status as enum (
  'vacant_unrented', 'notice_unrented', 'notice_rented', 'applicant', 'future', 'hold'
);

create table labos.exposure_records (
  id              uuid primary key default gen_random_uuid(),
  sync_run_id     uuid not null references labos.sync_runs(id),
  property_id     uuid not null references labos.properties(id),
  unit_id         uuid references labos.units(id),
  status          labos.exposure_status not null,
  is_skip         boolean not null default false,   -- the '(Skip)' status annotation seen on real data
  days_vacant     int,
  make_ready_date date,
  move_in_date    date,
  notice_date     date,
  move_out_date   date,
  -- Current Exposure = unrented AND (already vacant OR moving out within 30 days) — see PRD Unknown #8's
  -- resolution. Applicant/Future are confirmed "secured" (excluded) per your Milestone-1 decision.
  is_unrented     boolean not null,
  created_at      timestamptz not null default now(),
  unique (sync_run_id, unit_id)
);

create table labos.traffic_leads (
  id                 uuid primary key default gen_random_uuid(),
  sync_run_id        uuid not null references labos.sync_runs(id),
  property_id        uuid not null references labos.properties(id),
  prospect_ref       text,                       -- intentionally null in Milestone 1 (governance)
  first_contact_date date not null,
  source_channel     text,
  called             boolean not null default false,
  emailed            boolean not null default false,
  toured             boolean not null default false,
  leased             boolean not null default false,
  sheet_line_ref     text not null,
  created_at         timestamptz not null default now(),
  unique (sync_run_id, sheet_line_ref)
);
