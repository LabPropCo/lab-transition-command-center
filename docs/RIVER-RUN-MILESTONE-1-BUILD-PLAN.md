# River Run Ingestion — Milestone 1 Build Plan

**Status:** Approved. Implementation in progress. All three open business-rule questions resolved below; one new architectural principle (Operational Memory) incorporated.

**Resolved decisions (were open, now confirmed):**
1. **Move-In/Move-Out same-row semantics** — confirmed as the expected business rule: outgoing resident vacates, unit turns, incoming resident moves in, same row. V12 remains a **warning** (not blocking) specifically so a future, genuinely unexpected pattern still surfaces for review rather than being silently assumed to fit this rule forever.
2. **Applicant status** — confirmed **secured**, excluded from Exposure. Operationally, reaching Applicant status protects the unit for planning purposes; Exposure represents only units that still require leasing activity.
3. **Traffic Detail `Key Notes`** — confirmed **stored**, verbatim, unmodified, as first-class data (not excluded like Notice `Reason`, which remains a separate, still-deferred governance question). See the new Operational Memory architecture below — this is its first populated source.
**Milestone target:** one real Weekly Summary workbook → Weekly-Summary Adapter → validate → normalize → load into Supabase under a Sync Run → show exactly what was processed.
**Explicitly not in this milestone:** narrative generator, full Property Dashboard, Yardi adapter, live Trend-workbook write-back (interface only), Portfolio Survey ingestion, occupancy %/budget/3-yr-average KPIs (all Trend-workbook-sourced).

Grounded in the real `River Run Weekly Summary 2026.07.26.xlsx` workbook already inspected — field mappings and parsing rules below reflect its actual structure, not an assumed one.

---

## New Architectural Principle — Structured Operational Data vs. Operational Memory

Two distinct classes of information, both first-class, both preserved:

- **Structured Operational Data** — occupancy, exposure, leases, pricing, renewals, traffic, market survey, availability. Measurable metrics. Everything in Deliverable 1's schema up to this point.
- **Operational Memory** — the weekly narrative, Traffic Detail notes, pricing rationale, competitive observations, manager comments, decision reasoning, market conditions. Not metrics — the *why* behind them. Stored verbatim, immutable (never edited in place — only superseded, same pattern as `sync_runs`), so that even if a future version categorizes or summarizes this content, the original text is always still there underneath.

This is what eventually makes questions like "when have we used loss-leader pricing, and did it work?" answerable — not by mining metrics alone, but by having the reasoning preserved alongside them. Milestone 1 populates exactly one source of Operational Memory (`Traffic Detail`'s `Key Notes`); the table is designed generically so narrative text, pricing rationale, and manager comments slot into the same structure later without a redesign.

```sql
create type labos.memory_type as enum (
  'traffic_note', 'narrative', 'pricing_rationale', 'competitive_observation',
  'manager_comment', 'decision_reasoning', 'market_condition'
);

create table labos.operational_memory (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),   -- lineage
  property_id uuid not null references labos.properties(id),
  reporting_week date not null,
  memory_type labos.memory_type not null,
  source_ref text,                 -- e.g. a traffic_leads.sheet_line_ref — nullable (a standalone
                                    -- weekly narrative won't tie to one structured row)
  content text not null,           -- verbatim, original text — never modified during ingestion
  superseded_by uuid references labos.operational_memory(id),
  created_at timestamptz not null default now()
);

-- Immutability enforced, not just documented: content can only be superseded, never edited in place.
create or replace function labos.prevent_operational_memory_content_edit()
returns trigger language plpgsql as $$
begin
  if new.content is distinct from old.content then
    raise exception 'operational_memory.content is immutable; insert a new row and set superseded_by instead';
  end if;
  return new;
end $$;

create trigger trg_operational_memory_immutable
  before update on labos.operational_memory
  for each row execute function labos.prevent_operational_memory_content_edit();
```

`Traffic Detail`'s `Key Notes` populate this table with `memory_type = 'traffic_note'` and `source_ref` set to the corresponding `traffic_leads.sheet_line_ref` — a join, not a duplicated column. No categorization, tagging, or embedding is built in Milestone 1 — explicitly deferred (per your instruction not to summarize or modify), but the schema doesn't block adding those later.

---

## Deliverable 1 — Phased Implementation Plan

| Phase | Deliverable | Depends on |
|---|---|---|
| 1. Data Foundation | Migrations: `labos` schema, `sync_runs`, `source_files`, `validation_results`, entity tables, RLS | Nothing (first) |
| 2. Weekly Summary Adapter | Parses one workbook into a canonical, source-agnostic payload | Phase 1's canonical shape must be defined first (adapter targets it) |
| 3. Validation & Normalization | Rule matrix + payload→row mapping | Phase 2 output shape |
| 4. Sync Run Execution | Orchestrates 1–3, end to end, idempotent | Phases 1–3 |
| 5. Minimal Sync Review UI | Read-only screen over `sync_runs` + children | Phase 4 producing real data to show |

---

## Deliverable 2 — Proposed Migration Order

1. `00XX_labos_schema.sql` — create schema `labos`; revoke default public grants on it.
2. `00XX_labos_properties.sql` — `labos.properties`, `labos.floorplans`, `labos.units` (reference data).
3. `00XX_labos_sync_runs.sql` — `labos.sync_runs`, `labos.source_files`, `labos.validation_results` (the run/audit skeleton — built before entity tables so entity rows can FK to a run from the start).
4. `00XX_labos_leasing_entities.sql` — `labos.leasing_transactions`, `labos.exposure_records`, `labos.traffic_leads`.
5. `00XX_labos_operational_memory.sql` — `labos.operational_memory` + immutability trigger.
6. `00XX_labos_weekly_kpi.sql` — `labos.weekly_kpi_snapshots` (derived table).
7. `00XX_labos_rls.sql` — all RLS policies + grants, applied last, once every table exists (matches this repo's existing convention of security fixes landing as their own migration, e.g. `0023_admin_users_module.sql`).

Each is additive-only, no edits to existing Transition Center migrations.

---

## Deliverable 1 continued — Phase 1: Data Foundation (Schema Detail)

```sql
create schema if not exists labos;
revoke all on schema labos from public;

-- Reference data — minimal for Milestone 1 (one property)
create table labos.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,              -- 'River Run'
  created_at timestamptz not null default now()
);

create table labos.floorplans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references labos.properties(id),
  type_code text not null,                -- e.g. 'A1R', 'B2', 'C1R' (from Inventory sheet)
  bed_count int not null,
  river_side boolean not null,
  description text,                       -- e.g. '1 BED RIVER'
  unique (property_id, type_code)
);

create table labos.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references labos.properties(id),
  unit_number text not null,              -- e.g. 'E304'
  floorplan_id uuid references labos.floorplans(id),
  sqft int,
  unique (property_id, unit_number)
);

-- Run / audit skeleton
create type labos.sync_run_status as enum (
  'pending','discovering','parsing','validating','blocked','normalizing','loading','completed','failed'
);

create table labos.sync_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references labos.properties(id),
  reporting_week date not null,
  status labos.sync_run_status not null default 'pending',
  triggered_by uuid not null references public.profiles(id),   -- reuse existing identity
  triggered_at timestamptz not null default now(),
  completed_at timestamptz,
  superseded_by uuid references labos.sync_runs(id),           -- set when a later rerun replaces this one
  overwrite_confirmed_by uuid references public.profiles(id),
  overwrite_confirmed_at timestamptz,
  notes text
);

-- Only one ACTIVE completed run per property/week — reruns supersede, never delete
create unique index sync_runs_active_week
  on labos.sync_runs (property_id, reporting_week)
  where status = 'completed' and superseded_by is null;

create type labos.source_type as enum ('weekly_summary','trend_workbook','portfolio_survey');

create table labos.source_files (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),
  source_type labos.source_type not null,
  drive_file_id text,                      -- null in Milestone 1 (local-file provider, see Phase 4)
  file_name text not null,
  last_modified_at timestamptz,
  discovered_at timestamptz not null default now(),
  content_hash text                        -- for change detection on rerun
);

create type labos.validation_severity as enum ('blocking','warning','info');

create table labos.validation_results (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),
  rule_code text not null,                 -- e.g. 'REPORTING_WEEK_MISMATCH'
  severity labos.validation_severity not null,
  message text not null,
  context jsonb,                           -- structural refs only (sheet/row/unit) — never resident names
  created_at timestamptz not null default now()
);

-- Entities (Milestone 1 scope: Weekly Summary workbook only)
create type labos.leasing_event_type as enum (
  'new_rental','move_in','move_out','notice','renewal','cancel_denial'
);

create table labos.leasing_transactions (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),   -- source lineage
  property_id uuid not null references labos.properties(id),
  unit_id uuid references labos.units(id),                    -- nullable: unit not yet matched to Inventory
  event_type labos.leasing_event_type not null,
  resident_ref text,                        -- intentionally NULL in Milestone 1 — see Phase 2 governance note
  rent numeric(10,2),
  effective_date date,
  expiration_date date,
  move_date date,
  prior_rent numeric(10,2),                 -- renewals only
  lease_term text,                          -- 'ST' | 'LT', nullable
  has_reason boolean not null default false, -- reason TEXT deliberately not persisted, see governance note
  sheet_line_ref text not null,              -- e.g. 'SUMMARY!MOVE-INS#3' — idempotency key component
  created_at timestamptz not null default now(),
  unique (sync_run_id, sheet_line_ref)
);

create type labos.exposure_status as enum (
  'vacant_unrented','notice_unrented','notice_rented','applicant','future','hold'
);

create table labos.exposure_records (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),
  property_id uuid not null references labos.properties(id),
  unit_id uuid references labos.units(id),
  status labos.exposure_status not null,
  is_skip boolean not null default false,     -- the '(Skip)' annotation seen on real data
  days_vacant int,
  make_ready_date date,
  move_in_date date,
  notice_date date,
  move_out_date date,
  is_unrented boolean not null,               -- computed at normalization time, see Phase 3
  created_at timestamptz not null default now(),
  unique (sync_run_id, unit_id)
);

create table labos.traffic_leads (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),
  property_id uuid not null references labos.properties(id),
  prospect_ref text,                          -- intentionally NULL in Milestone 1, same governance note
  first_contact_date date not null,
  source_channel text,
  called boolean not null default false,
  emailed boolean not null default false,
  toured boolean not null default false,
  leased boolean not null default false,
  sheet_line_ref text not null,
  unique (sync_run_id, sheet_line_ref)
);

-- Derived — Milestone 1 scope only (no occupancy%/budget/3yr-avg: those need the Trend workbook)
create table labos.weekly_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references labos.sync_runs(id),
  property_id uuid not null references labos.properties(id),
  reporting_week date not null,
  new_rentals_count int not null,
  move_ins_count int not null,
  move_outs_count int not null,
  notices_count int not null,
  renewals_count int not null,
  cancels_denials_count int not null,
  walk_ins_count int not null,
  current_exposure_count int not null,
  unique (sync_run_id)
);
```

**Primary/foreign keys:** every entity table carries both `sync_run_id` (lineage — which run produced this row) and `property_id` (query convenience) as explicit FKs. `units`/`floorplans` are the only tables shared *across* runs (reference data, not lineage-scoped).

**Unique constraints & idempotency:** `sync_runs_active_week` (partial unique index) is the reporting-week idempotency guarantee — see Phase 4 for the full rerun/overwrite flow. Entity tables use `(sync_run_id, sheet_line_ref)` uniqueness so a crashed-and-retried load can't double-insert.

**Row-Level Security:**
```sql
alter table labos.properties enable row level security;
-- ...(same pattern on every labos.* table)

create policy labos_read_platform_admin on labos.properties
  for select using (public.is_platform_admin());

-- No client INSERT/UPDATE/DELETE policy on any labos.* table in Milestone 1 —
-- all writes happen via the service-role-executed Sync Run job, never the browser client.
grant usage on schema labos to authenticated, service_role;
grant select on all tables in schema labos to authenticated;   -- filtered by RLS above
grant all on all tables in schema labos to service_role;       -- ingestion job only
```
This reuses `is_platform_admin()` exactly as built for the Admin module — no new permission model invented for Milestone 1. A finer-grained "LabOS user" role (distinct from platform admin) is a real future need but out of scope until there's more than one person who needs read access.

---

## Deliverable 4 — Canonical Adapter Interface

```ts
// Every adapter (Weekly-Summary today, Yardi later) implements this — nothing
// downstream (validation, normalization, load) knows which one produced the payload.
interface SourceAdapter {
  readonly sourceType: "weekly_summary" | "trend_workbook" | "portfolio_survey";
  parse(file: SourceFileHandle): Promise<CanonicalPayload>;
}

interface SourceFileHandle {
  fileName: string;
  lastModifiedAt: Date;
  driveFileId: string | null;   // null when read via the Milestone-1 local-file provider
  bytes: ArrayBuffer;
}

interface CanonicalPayload {
  reportingWeek: string;            // ISO date, cross-validated (see Validation Matrix)
  propertyName: string;             // 'River Run' — matched against labos.properties.name
  leasingTransactions: CanonicalLeasingTransaction[];
  exposureRecords: CanonicalExposureRecord[];
  trafficLeads: CanonicalTrafficLead[];
  parseWarnings: ParseWarning[];     // non-fatal parse-time issues, flow into validation_results as 'warning'
}
```

`CanonicalLeasingTransaction`, `CanonicalExposureRecord`, `CanonicalTrafficLead` mirror the table shapes in Deliverable 1 exactly (field-for-field) — normalization (Phase 3) is a near-identity mapping, by design, so most of the real complexity lives in the adapter, not downstream.

A `TrendWriteBackPort` interface is declared but **not implemented** in Milestone 1, per your constraint:
```ts
interface TrendWriteBackPort {
  appendWeeklyRow(snapshot: WeeklyKpiSnapshot): Promise<void>;
}
// Milestone 1: no implementation registered. Sync Run's derive step does not call this port at all.
```

---

## Deliverable 2 — Phase 2: Weekly Summary Adapter (Detailed)

### Expected file structure (verified against the real workbook)

| Sheet | Role | Structure |
|---|---|---|
| `SUMMARY` | Leasing transactions | A sequence of labeled sections in column A (`NEW RENTALS`, `MOVE-INS`, `MOVE-OUTS`, `NOTICE`, `RENEWALS`, `CANCELS/DENIAL`), each followed by its own header row, then data rows until the next blank row. |
| `Unit Availability Details` | Exposure | Fixed header block (rows 0–7), then repeated groups: a `River Run (riverrun)` label row, data rows, a `Total` subtotal row, blank separator — repeated until a final `Total for riverrun` / `Grand Total Count`. |
| `Traffic Detail` | Leads | Single header row (`Prospect, First Contact Date, Source, Call, Email, Tour, Lease, Key Notes`), then one data row per prospect. Some rows wrap onto a continuation line (blank Prospect cell, note text only) — must be merged into the preceding row, not treated as a new prospect. |
| `Inventory` | Unit/floorplan reference | Single header row (`Unit #, Type, Reference, River, [combined code], Description`), one row per unit. Static — same shape expected every week. |

### Parsing rules

- **`SUMMARY` is section-driven, not row-number-driven.** The adapter scans column A for the six known section labels and reads each section's own header + data rows relative to where that label was found — never a hardcoded row range. This is required because a heavier week (more move-outs, more notices) shifts every subsequent section down; this week's file happens to have zero rows in three of the six sections, which would break any fixed-offset parser.
- **Reporting week cross-check.** `SUMMARY!A1`'s date (e.g. `7/26/26`) must match the date encoded in the workbook's file name. Mismatch is a **blocking** error (Validation Matrix).
- **`Unit Availability Details` status classification** (per real, inspected data):
  - Blank `Status` + no resident/rent populated → `vacant_unrented`
  - `Status = "Notice"` + a current resident populated (Resident ID/Name/Rent present) → `notice_unrented` — a current resident has given notice; nothing yet re-leased.
  - `Status = "Future"` or `"Applicant"` + a resident/applicant populated with a move-in date → the unit is already spoken for, even though presently vacant.
  - A `(Skip)` suffix on `Status` is parsed as a separate `is_skip` boolean, not a distinct status category.
  - **Flagged, not assumed:** some rows show both a `Move In` and a `Move Out` date on the same unit — read from the actual data, this appears to mean "current resident's move-out" and "incoming applicant's move-in" on the same physical unit mid-turn, not two dates about the same person. This interpretation is *inferred from the data pattern*, not confirmed, and directly affects the exposure calculation. **Flagged below as a business-rule decision needed before this ships**, not silently encoded as certain.
- **`Traffic Detail` continuation rows.** A row with a blank `Prospect` cell and only a `Key Notes` value is a continuation of the previous row's notes, not a new lead — merge, don't create a duplicate `traffic_leads` row.
- **`Inventory`** is read once per run as reference data to resolve `unit_number → floorplan_id`; if a unit number appears in `SUMMARY`/`Unit Availability Details` that isn't in `Inventory`, that's a validation warning (unit created with `floorplan_id = null`), not a blocking failure — new units do get added to a property occasionally.

### Field mappings & type conversions

| Source | Column | Canonical field | Conversion |
|---|---|---|---|
| SUMMARY (any section) | `Unit #` | `unitNumber` | trim; `"-"` or blank → row excluded (placeholder/waitlist line, not a real transaction — see Missing-Value Behavior) |
| SUMMARY | `Rent` / `Prior Rent` / `New Rent` | `rent` / `priorRent` | strip `$`/`,`, parse as decimal; blank → `null` |
| SUMMARY | `M/I Date`, `Exp Date`, `M/O Date` | respective date fields | parse `M/D/YY`; blank → `null` |
| SUMMARY | `Names` | *(not mapped)* | **intentionally excluded** — see Governance note below |
| SUMMARY | `Reason` (Move-Outs/Notice/Cancels) | `hasReason` (boolean only) | text presence recorded; **verbatim text not persisted** — see Governance note |
| SUMMARY | `Lease Term (ST, LT)` | `leaseTerm` | pass through as-is; unrecognized value → warning |
| Unit Availability Details | `Unit` | `unitNumber` | trim |
| " | `Status` | `status` (+ `isSkip`) | mapped per classification rules above |
| " | `Resident Rent` / `Unit Rent` | `residentRent` / `unitRent` | strip formatting, decimal |
| " | `Days Vacant`, all date columns | pass-through | blank → `null` |
| Traffic Detail | `Prospect` | *(not mapped)* | **intentionally excluded** — see Governance note |
| " | `First Contact Date` | `firstContactDate` | parse date; **required**, missing → blocking (can't compute a weekly-scoped lead without it) |
| " | `Call`/`Email`/`Tour`/`Lease` (`✓`/blank) | booleans | `✓` → `true`, else `false` |
| " | `Key Notes` | `operational_memory.content` (`memory_type='traffic_note'`, `source_ref` = the lead's `sheetLineRef`) | **stored verbatim, unmodified** — confirmed; see Operational Memory section above |
| Inventory | `Unit #`, `Type`, bed count/reference/river columns, `Description` | `floorplans`/`units` reference rows | direct mapping, one-time per run |

### Governance note — resident/prospect identity (still deferred; distinct from Key Notes, now resolved)

Per the standing deferred decision on sensitive resident data: the adapter **reads** resident/prospect names and Notice `Reason` free text (it needs to, to detect duplicate rows and produce readable validation messages) but **does not carry them into the canonical payload or database** in Milestone 1. `resident_ref`/`prospect_ref` columns exist and stay `null`; `Reason` is represented only as a boolean (`has_reason`). This is the conservative default in the absence of a governance decision — not a resolution of it. `Key Notes` is no longer part of this open question (resolved — stored, see above); one thing still needs your call:
1. Should there ever be an authorized, access-controlled path to the real resident/prospect identity (e.g. for someone actually following up with a lead), or does Milestone 1's exclusion become the permanent policy?

### Missing-value & duplicate-handling rules

- A `Unit #` of `"-"` (seen on `WAITC1`/`WAITB1` waitlist-style rows) is **excluded** from `leasingTransactions` — these aren't real unit transactions, they're waitlist placeholders. Recorded as an `info` validation notice (count of excluded placeholder rows), not silently dropped without a trace.
- A completely blank data row inside a section (all cells empty) ends that section — it is not a phantom transaction.
- Duplicate `sheet_line_ref` within one parse (shouldn't happen structurally, but defensively checked) → **blocking** error; indicates the section-scanner mis-detected boundaries.

### Fail vs. warn

| Condition | Outcome |
|---|---|
| A known section label (`NEW RENTALS`, etc.) is missing entirely from `SUMMARY` | **Blocking** — workbook structure has changed |
| `Unit Availability Details` grand total row is missing | **Blocking** — can't confirm the sheet parsed completely |
| A unit number not found in `Inventory` | **Warning** — unit loaded with `floorplan_id = null` |
| A date fails to parse | **Blocking** for required dates (e.g. `First Contact Date`), **warning** for optional ones |
| Reporting week (file name) vs. in-sheet date mismatch | **Blocking** |
| Placeholder (`"-"`) unit rows present | **Info** |
| `Inventory` sheet missing or empty | **Blocking** — reference data required for every other sheet's unit resolution |

### Example canonical payload (this reporting week, sensitive fields omitted per the governance note above)

```json
{
  "reportingWeek": "2026-07-26",
  "propertyName": "River Run",
  "leasingTransactions": [
    {
      "eventType": "new_rental",
      "unitNumber": "E304",
      "rent": 3495.00,
      "effectiveDate": null,
      "expirationDate": "2027-10-20",
      "leaseTerm": "LT",
      "resident_ref": null,
      "hasReason": false,
      "sheetLineRef": "SUMMARY!NEW_RENTALS#1"
    },
    {
      "eventType": "cancel_denial",
      "unitNumber": "D303",
      "resident_ref": null,
      "hasReason": true,
      "sheetLineRef": "SUMMARY!CANCELS_DENIAL#1"
    }
  ],
  "exposureRecords": [
    {
      "unitNumber": "F304",
      "status": "vacant_unrented",
      "isSkip": false,
      "daysVacant": 26,
      "makeReadyDate": "2026-06-30",
      "isUnrented": true
    }
  ],
  "trafficLeads": [
    {
      "firstContactDate": "2026-07-20",
      "sourceChannel": "Property Website",
      "called": true,
      "emailed": false,
      "toured": false,
      "leased": false,
      "prospect_ref": null,
      "sheetLineRef": "TRAFFIC_DETAIL#1"
    }
  ],
  "parseWarnings": []
}
```

---

## Deliverable 6 — Validation Matrix (Phase 3)

| # | Rule | Severity | Notes |
|---|---|---|---|
| V1 | Workbook belongs to River Run (property-name cell matches) | Blocking | Wrong-property file loaded |
| V2 | Reporting week: file-name date matches in-sheet date | Blocking | See Phase 2 |
| V3 | All required sheets present (`SUMMARY`, `Unit Availability Details`, `Traffic Detail`, `Inventory`) | Blocking | |
| V4 | All six `SUMMARY` sections present (even if empty) | Blocking | Structural drift check |
| V5 | Required numeric/date fields parse cleanly | Blocking (required fields) / Warning (optional) | |
| V6 | `Unit Availability Details` grand total = sum of group subtotals | Blocking | Internal reconciliation — the sheet's own math must check out before we trust it |
| V7 | No duplicate reporting-week load without explicit overwrite confirmation | Blocking | See Idempotency, Phase 4 |
| V8 | Source file's last-modified timestamp is recent relative to reporting week | Warning | Staleness check |
| V9 | Unit number not found in `Inventory` | Warning | Unit loaded with null floorplan. Does **not** fire for units classified `waitlist_placeholder` (V13) — they're known not to be physical units, so "missing from Inventory" isn't meaningful for them |
| V10 | Genuinely blank row (no unit number at all) | Info | Distinct from a populated row with a non-numeric Line (V13, `new_rental` only) |
| V11 | No resident/prospect name or free-text reason present in any canonical payload field | Blocking (self-check on adapter output, not the raw file) | Defense-in-depth for the governance rule — the adapter should never even be *able* to emit these fields, but this rule catches it if it ever does |
| V12 | `Unit Availability Details` rows with simultaneous Move-In and Move-Out dates | Warning | Confirmed business rule (outgoing vacates, unit turns, incoming moves in) — kept as a warning on purpose, so a genuinely unexpected future pattern still surfaces rather than being silently forced into the confirmed rule |
| V13 | `NEW RENTALS` row with a non-numeric Line value | Warning (`cancelled_or_denied` / `other_unnumbered`) or Info (`waitlist_placeholder`) | Confirmed business rule: excluded from `new_rentals_count`, classified and preserved for audit — never discarded. See Deliverable 10 for the real numbers this produced. |

**Normalization rules** (payload → DB rows): near-identity, per the canonical-payload design — one row per canonical entity, `sync_run_id` stamped on every row, `unit_id` resolved via `(property_id, unit_number)` lookup (creating a new `units` row with `floorplan_id = null` when unmatched, per V9), `is_unrented` computed at this stage as `status in ('vacant_unrented','notice_unrented')`, `current_exposure_count` computed as `count(*) where is_unrented and (move_out_date is null or move_out_date <= reporting_week + 30)`.

---

## Deliverable 7 — Sync Run State Machine

```
pending → discovering → parsing → validating ─┬─→ blocked (blocking error present; stop, nothing loaded)
                                                └─→ normalizing → loading → completed
                                                                              │
                                                                              ▼ (any unhandled exception at any stage)
                                                                            failed
```

- **pending → discovering:** file handle obtained (local path in Milestone 1; Drive connector later).
- **discovering → parsing:** `source_files` row written (name, last-modified, hash) before a single cell is read — so even a parse crash leaves an audit trail of what was attempted.
- **parsing → validating:** adapter output (canonical payload + parse warnings) produced.
- **validating → blocked:** any Blocking-severity result — run stops, **nothing is normalized or loaded**, all validation results are still persisted.
- **validating → normalizing:** zero blocking results (warnings/info do not stop the run).
- **loading → completed:** all entity rows + the `weekly_kpi_snapshots` row committed in one transaction.
- **failed:** reserved for unexpected exceptions (a crash, not a validation failure) — distinct from `blocked`, which is an expected, clean stop.

---

## Deliverable 8 — Idempotency & Overwrite Strategy

- **Re-running against the same reporting week:** a new `sync_runs` row is always created (full audit trail, never mutate a past run). Before `loading`, the run checks `sync_runs_active_week` for an existing **completed, non-superseded** run for the same `(property_id, reporting_week)`.
  - If none exists → proceeds normally.
  - If one exists **and** the new run was not invoked with an explicit overwrite confirmation → the run stops at `blocked` with rule `V7` ("duplicate reporting-week load"), and **nothing is written**. The existing data is untouched.
  - If one exists **and** overwrite was explicitly confirmed (a required parameter in Milestone 1's developer command/endpoint — no default, no implicit "latest wins") → the run proceeds; on successful `loading`, the prior run is marked `superseded_by = <new run id>` (kept, never deleted) and the new run becomes the active one for that week.
- **Retry after a mid-load crash (`failed` status):** entity tables' `unique (sync_run_id, sheet_line_ref)` means re-running the *same* sync run's load step is a safe upsert, not a duplicate-producing insert — but in Milestone 1, a failed run is simply not retried in place; a fresh Sync Run is started, which is safe because nothing partial from the failed run was left "active" (the unique-active-week index only recognizes `completed` runs).
- **Nothing is ever deleted.** Superseded runs, their source file records, validation results, and entity rows all remain queryable — the audit trail requirement is satisfied by superseding, not erasing.

---

## Deliverable 9 — Test Strategy

| Test | What it proves |
|---|---|
| Unit — section-scanner (`SUMMARY`) | Correctly locates all six sections regardless of how many rows are in each, using a synthetic fixture with fabricated units/rents (no real names) shaped like a "heavy" week (many rows) and a "light" week (this week's near-empty sections) |
| Unit — `Unit Availability Details` status classification | Each of the six status/skip combinations classifies correctly, using synthetic rows |
| Unit — per validation rule (V1–V13) | One crafted fixture per rule, asserting it fires at the correct severity and no others fire |
| Unit — New Rentals Line-column classification (V13) | Numbered rows count toward `new_rentals_count`; `"-"`-Line rows don't; a `"-"` row also in `CANCELS/DENIAL` classifies `cancelled_or_denied`; a WAIT-prefixed `"-"` row classifies `waitlist_placeholder` and does not also trigger V9; excluded rows remain visible in the payload/DB for audit |
| Golden-file — full adapter | Real `2026.07.26` workbook (only after resident/prospect names are scrubbed from a *test copy* — never committed with real names) → canonical payload matches an expected JSON snapshot |
| Integration — full Sync Run | Golden-file payload → validate → normalize → load against a local/test Supabase instance → assert final row counts and `weekly_kpi_snapshots` values |
| Idempotency | Run twice without overwrite flag → second run `blocked` with V7, zero new entity rows; run twice *with* overwrite flag → first run marked superseded, second is the active one, row counts reflect only the second run |
| RLS | A non-platform-admin authenticated client cannot `SELECT` from any `labos.*` table; a platform admin can |

---

## Deliverable 10 — Acceptance Criteria (Milestone 1 "Definition of Done")

**Status: proven, not just specified.** Everything below was actually run against the real `River Run Weekly Summary 2026.07.26.xlsx` via `npm run labos:sync`, against the in-memory mock repository (Option 2 — see the Database Verification Checklist below for what that does and doesn't prove).

Three distinct counts matter here, and must not be conflated:
- **Official KPI counts** — what actually counts toward the property's weekly numbers.
- **Total source rows encountered** — everything the adapter found in the sheet, official or not.
- **Excluded / supplemental rows** — real data, preserved for audit, deliberately not counted.

| Metric | Total rows encountered | Official (counted) | Excluded (audit-only) |
|---|---|---|---|
| New Rentals | 6 | **3** | 3 (1 `cancelled_or_denied` — `D303`; 2 `waitlist_placeholder` — `WAITC1`, `WAITB1`) |
| Move-Ins | 5 | 5 | 0 |
| Move-Outs | 0 | 0 | 0 |
| Notices | 0 | 0 | 0 |
| Renewals | 0 | 0 | 0 |
| Cancels/Denials | 1 | 1 | 0 |
| Traffic leads (walk-ins) | 71 | 71 | 0 |
| Current Exposure | — | 8 | — |

1. A `sync_runs` row is created with `reporting_week = 2026-07-26`, ending in `status = completed`. ✅ Verified.
2. `source_files` records the workbook's name and last-modified timestamp. ✅ Verified.
3. Official `new_rentals_count = 3`; `new_rentals_excluded_count = 3`, each excluded row classified and retained (never discarded) — `D303` as `cancelled_or_denied` (it also appears in `CANCELS/DENIAL` this same week), `WAITC1`/`WAITB1` as `waitlist_placeholder` (WAIT-prefixed, not physical units). Move-ins/move-outs/notices/renewals/cancels-denials match the workbook's numbered rows exactly: **5, 0, 0, 0, 1**. ✅ Verified against the real file.
4. `traffic_leads` count (71) matches `Traffic Detail`'s real row count, continuation rows merged rather than double-counted. ✅ Verified.
5. `exposure_records` contains one row per unit found in `Unit Availability Details` (15 units), correctly split into `is_unrented = true/false` per the now-confirmed classification rules, yielding **Current Exposure = 8**. V12 (simultaneous move-in/move-out) fired as a warning on the 5 affected rows, as designed — confirmed as expected behavior, not a bug. ✅ Verified.
6. Zero blocking validation errors on this real file. ✅ Verified (0 blocking, 6 warning, 21 info on the actual run).
7. Re-running against the same file without an overwrite flag is `blocked` with V7, and no duplicate rows exist anywhere. ✅ Verified via `syncRun.test.ts` (mocked repository — the CLI itself is a fresh process per invocation, see the script's own header comment).
8. No resident name, prospect name, or free-text reason/notes value exists anywhere in the database after the run. ✅ Verified — `weeklySummaryAdapter.test.ts` asserts the canonical payload never contains one, and this was true of the real-file run's output as well.
9. A human-readable completion summary is produced, including the official-vs-excluded KPI breakdown. ✅ Verified (console output shown above; Phase 5's UI surfaces the same data visually).

**What is still NOT proven by any of the above:** that the `labos.*` migrations actually execute successfully against a real Postgres database, that the real `SupabaseLabosRepository` correctly persists these exact rows, and that RLS behaves as designed. See the Database Verification Checklist.

---

## Deliverable 11 — Risks & Dependencies

- **Nothing here has been proven against a real database.** Every test — the section-scanner, the adapter, validation, normalization, the Sync Run state machine, even `SupabaseLabosRepository` itself — runs against either pure functions or a mocked repository/mocked Supabase client. That proves the orchestration and business logic are correct against the contract both repositories share. It does **not** prove the `labos.*` migrations actually execute cleanly, that constraints/RLS behave as designed, or that the real repository's SQL is syntactically valid against live Postgres. See the Database Verification Checklist immediately below — this is the single biggest gap between "Milestone 1 is code-complete" and "Milestone 1 is production-ready."
- **Structural drift risk.** These are hand-maintained Excel files. A renamed section label, an inserted column, or a reordered sheet breaks the section-scanner. V4/V3 catch it as a blocking error rather than a silent misread, but someone still has to notice and fix the adapter when it happens.
- **No real Drive integration wired into the app yet** (Milestone 1 uses a local-file provider by design — see Phase 4 folder structure below). Swapping in the connector is Milestone 2 scope, not a risk to *this* milestone, but worth naming so it isn't forgotten.
- **Single-property assumption.** `labos.properties` has one row. Extending to a second property is mechanically simple (the schema already supports it) but untested until it happens.

---

## Database Verification Checklist

**This is the honest boundary of what Milestone 1 has actually proven.** Everything above was verified against pure functions, an in-memory mock repository, or a mocked Supabase client — none of which execute real SQL. Mocked tests passing is **not** evidence the migrations run correctly; it's evidence the orchestration code calls a repository correctly, against a contract we defined ourselves. The two are independent, and only the checklist below closes the second gap. Nothing here should be run until you've explicitly approved a target database, per the standing production-change policy.

### What remains unproven

1. Do the 7 migrations (`0024`–`0030`) apply cleanly, in order, with no syntax errors, on a real Postgres instance?
2. Do the unique constraints/partial indexes actually enforce what they're supposed to (`sync_runs_active_week`, `(sync_run_id, sheet_line_ref)`, `(sync_run_id, unit_id)`)?
3. Does the `operational_memory` immutability trigger actually reject an `UPDATE` to `content`?
4. Does RLS actually block a non-platform-admin `authenticated` client from reading `labos.*`, and actually allow a platform admin?
5. Does `SupabaseLabosRepository`'s real SQL (upserts with `onConflict`, the `.schema('labos')` calls, the count queries) execute without error against the real schema — as opposed to just matching the shape our own fake client expected?
6. Does the full real workbook, run through the real repository end-to-end, produce the same row counts already proven against the mock (3 official new rentals, 3 excluded, 5 move-ins, 0 move-outs, 1 cancel/denial, 15 exposure records, 8 current exposure, 71 traffic leads, 71 operational memory entries)?

### How to verify it, when you're ready

**Target:** a real Postgres database you're comfortable applying unproven migrations to — ideally a throwaway/local Supabase project, not the linked production project, for this first pass. If you want to use the linked project, that requires the standard disclosure (what changes, impact, downtime risk, rollback) and your explicit go-ahead first, same as any other production change.

```bash
# 1. Apply the migrations
supabase link --project-ref <target-project-ref>   # only if not already linked to this target
supabase db push                                    # applies 0024-0030 in order

# 2. Confirm they landed
supabase migration list                             # 0024-0030 should show matching local/remote
```

Expected result: no errors; `select * from labos.properties limit 1;` (via the SQL editor or `psql`) returns an empty result set with the right columns, not a "relation does not exist" error.

**Constraint checks (expected results):**
```sql
-- 3: should raise a unique-violation-style error, not silently succeed
insert into labos.sync_runs (property_id, reporting_week, status, triggered_by)
  values ('<a-real-property-id>', '2026-07-26', 'completed', '<a-real-profile-id>');
insert into labos.sync_runs (property_id, reporting_week, status, triggered_by)
  values ('<same-property-id>', '2026-07-26', 'completed', '<a-real-profile-id>');
  -- expect: violates "sync_runs_active_week"

-- 4: should raise the immutability trigger's exception
insert into labos.operational_memory (sync_run_id, property_id, reporting_week, memory_type, content)
  values ('<a-real-sync-run-id>', '<a-real-property-id>', '2026-07-26', 'traffic_note', 'original text');
update labos.operational_memory set content = 'edited text' where sync_run_id = '<that-sync-run-id>';
  -- expect: "labos.operational_memory.content is immutable..."
```

**RLS check (expected results):** as a platform admin's authenticated session, `select * from labos.sync_runs;` should return rows. As a non-admin authenticated user (any pilot user without `is_platform_admin = true`), the same query should return zero rows (RLS silently filters, per this schema's `for select using (public.is_platform_admin())` policy) — not an error, an empty result. As the `anon` role, it should also return zero rows (no policy grants it anything).

**Real repository + real data (expected result):** run `npm run labos:sync -- --file "<path>" --property-name "River Run" --reporting-period-end <YYYY-MM-DD> --workbook-alias riverrun` against a version of `SupabaseLabosRepository` wired to the target database (a small wiring change to `scripts/labos/run-sync.ts`, swapping `MockLabosRepository` for `SupabaseLabosRepository` with a service-role client — not built by default, per Option 2). Before this step, confirm `checkIngestionCapability()` reports `authorized: true` against that same client — the Sync Run's own preflight will refuse to proceed otherwise, per the same rule any other caller has to satisfy. Expect the exact same numbers already proven against the mock: **3 official new rentals + 3 excluded (1 `cancelled_or_denied`, 2 `waitlist_placeholder`), 5 move-ins, 0 move-outs, 0 notices, 0 renewals, 1 cancel/denial, 15 exposure records (current exposure 8), 71 traffic leads, 71 operational memory entries.** Any discrepancy from these numbers means something about the real SQL (upsert conflict targets, type coercion, RLS interaction with the service role) behaves differently than the mock assumed — investigate before trusting the pipeline further.

**Rollback procedure — this is destructive, not a safe undo, once real data exists.** `drop schema labos cascade;` never touches the Transition Center's `public` schema, but within `labos` it is a full, irreversible reset: every property, unit, Sync Run, source-file record, validation result, leasing transaction, exposure record, traffic lead, and — critically — every Operational Memory entry (the one thing this milestone made deliberately immutable and permanent) is gone, with no backup and no undo. This is an acceptable rollback **only before the first real Sync Run has been committed** (schema-only, zero data at risk). Once ingestion begins, treat it as a last-resort data-loss event requiring your explicit sign-off, not a routine step — see the Deployment Runbook's rollback decision points. If the goal is only to undo one bad sync, that's what superseding is for (Deliverable 8); actual schema deletion should never be the first response to a bad run.

**Assumptions this checklist itself is making, worth confirming before you rely on it:** that `gen_random_uuid()` is available without an explicit `create extension` (true for every existing migration in this project, so assumed true here too); that the target project's Postgres version supports partial unique indexes and enum types identically to what's been assumed (standard Postgres 13+ behavior, should be safe on any current Supabase project).

---

## Deliverable 3 — Proposed File & Folder Structure

```
supabase/migrations/
  00XX_labos_schema.sql
  00XX_labos_properties.sql
  00XX_labos_sync_runs.sql
  00XX_labos_leasing_entities.sql
  00XX_labos_weekly_kpi.sql
  00XX_labos_rls.sql

src/labos/                          # mirrors the existing src/vendors/, src/users/ domain-module pattern
  types.ts                          # CanonicalPayload and friends (Deliverable 4)
  adapters/
    weeklySummaryAdapter.ts         # Phase 2
    sectionScanner.ts               # SUMMARY sheet's section-scanning parser, unit-testable in isolation
  validation/
    rules.ts                       # the Validation Matrix, as executable rules
  syncRun.ts                       # orchestrates discover → parse → validate → normalize → load (Phase 4 state machine)
  sourceFileProviders/
    localFileProvider.ts           # Milestone 1
    driveFileProvider.ts           # stub only, not implemented this milestone
  api.ts                           # thin read functions for Phase 5's UI

scripts/labos/
  run-sync.ts                      # developer-invoked entrypoint: `npm run labos:sync -- --file <path> [--confirm-overwrite]`

src/screens/labos/
  SyncReview.tsx                    # Phase 5, minimal review screen — built last
```

---

## Deliverable 12 — Estimated Sequence of Engineering Tasks

| # | Task | Why here | Depends on | Test | Definition of Done |
|---|---|---|---|---|---|
| 1 | Write & apply the 6 migrations (Deliverable 2) | Nothing else can be built without the target shape existing | — | `supabase db push` succeeds; manual `select` against each new table | Schema live, RLS confirmed via a non-admin test query denied |
| 2 | `CanonicalPayload`/`SourceAdapter` TypeScript types (Deliverable 4) | Adapter and validation both need to target one agreed shape before either is written | Task 1 (mirrors table shapes) | `tsc` clean | Types compile, reviewed against Deliverable 1's table shapes for 1:1 correspondence |
| 3 | `sectionScanner.ts` for `SUMMARY` | Riskiest, most structure-dependent piece — isolate and prove it first | Task 2 | Unit tests: heavy week + light week synthetic fixtures | Correctly finds all 6 sections in both fixtures |
| 4 | Full `weeklySummaryAdapter.ts` (all 4 sheets) | Builds on the scanner | Task 3 | Golden-file test against scrubbed real workbook | Matches expected canonical payload exactly |
| 5 | Validation rules (V1–V12) | Needs real adapter output to validate against | Task 4 | One test per rule | All 12 rules independently testable and correct |
| 6 | Normalization + load (payload → DB rows) | Needs both the payload shape and passing validation | Tasks 4, 5 | Integration test against local Supabase | Row counts match Deliverable 10's acceptance numbers |
| 7 | Sync Run state machine + idempotency/overwrite logic | Orchestrates everything above; idempotency can only be tested once load exists | Task 6 | Idempotency test (Deliverable 9) | Rerun-without-flag blocks; rerun-with-flag supersedes correctly |
| 8 | `localFileProvider.ts` + `scripts/labos/run-sync.ts` | The actual runnable entrypoint for this milestone | Task 7 | Manual run against the real workbook | Acceptance Criteria (Deliverable 10) pass end-to-end |
| 9 | Minimal `SyncReview.tsx` (Phase 5) | Only useful once there's real data to show | Task 8 | Manual smoke test in browser | Shows reporting week, source file, validation results, entity counts, audit history for at least one real run |

---

## Business Decisions — Status

All three Milestone 1 questions are resolved (see top of document). One question remains open, carried forward from the PRD, not part of this milestone's build:

1. **Whether an authorized, access-controlled path to real resident/prospect identity should ever exist**, or whether Milestone 1's blanket exclusion (of *names* — `Key Notes` itself is now stored) is the permanent policy — still deferred, held per your earlier instruction.

V12 remains encoded as a **warning**, not a blocking failure, even though its business rule is now confirmed — this is intentional (per your instruction), so a genuinely unexpected future pattern still surfaces for review instead of being silently forced into the confirmed rule.
