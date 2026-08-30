-- ============================================================================
-- 0026 · LabOS, part 3: Sync Run — the audit/lineage skeleton
--
-- Built before any entity table so every entity row can carry sync_run_id
-- from the moment it's created (source lineage, per the ingestion
-- architecture). A Sync Run is a first-class, permanent audit record — never
-- deleted, only superseded (sync_runs_active_week + superseded_by below),
-- per the approved trigger-model design
-- (docs/RIVER-RUN-INGESTION-ARCHITECTURE.md, Section 3a).
-- ============================================================================

create type labos.sync_run_status as enum (
  'pending', 'discovering', 'parsing', 'validating', 'blocked',
  'normalizing', 'loading', 'completed', 'failed'
);

create table labos.sync_runs (
  id                      uuid primary key default gen_random_uuid(),
  property_id             uuid not null references labos.properties(id),
  reporting_week          date not null,
  status                  labos.sync_run_status not null default 'pending',
  triggered_by            uuid not null references public.profiles(id),
  triggered_at            timestamptz not null default now(),
  completed_at            timestamptz,
  superseded_by           uuid references labos.sync_runs(id),
  overwrite_confirmed_by  uuid references public.profiles(id),
  overwrite_confirmed_at  timestamptz,
  notes                   text
);

-- Idempotency: only one ACTIVE completed run per property/reporting-week.
-- A rerun creates a new row and marks the old one superseded — nothing is
-- ever deleted or mutated in place (see idempotency/overwrite strategy in
-- the build plan, Deliverable 8).
create unique index sync_runs_active_week
  on labos.sync_runs (property_id, reporting_week)
  where status = 'completed' and superseded_by is null;

create type labos.source_type as enum ('weekly_summary', 'trend_workbook', 'portfolio_survey');

create table labos.source_files (
  id                uuid primary key default gen_random_uuid(),
  sync_run_id       uuid not null references labos.sync_runs(id),
  source_type       labos.source_type not null,
  drive_file_id     text,                       -- null in Milestone 1 (local-file provider)
  file_name         text not null,
  last_modified_at  timestamptz,
  discovered_at     timestamptz not null default now(),
  content_hash      text                        -- change detection on rerun
);

create type labos.validation_severity as enum ('blocking', 'warning', 'info');

create table labos.validation_results (
  id            uuid primary key default gen_random_uuid(),
  sync_run_id   uuid not null references labos.sync_runs(id),
  rule_code     text not null,                  -- e.g. 'REPORTING_WEEK_MISMATCH' (V1-V12)
  severity      labos.validation_severity not null,
  message       text not null,
  context       jsonb,                          -- structural refs only (sheet/row/unit) — never resident/prospect names
  created_at    timestamptz not null default now()
);
