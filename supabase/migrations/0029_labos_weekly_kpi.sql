-- ============================================================================
-- 0029 · LabOS, part 6: Weekly KPI Snapshot (derived)
--
-- Computed at normalization/load time from the entities in 0027 — never
-- hand-entered, never a second source of truth for the same counts.
-- Milestone 1 scope only: occupancy%, budget comparison, and 3-year-average
-- columns are deliberately absent, not nulled placeholders — they require
-- the Trend workbook, which is a later adapter's job. Adding them now would
-- create always-null columns implying data that doesn't exist yet.
-- ============================================================================

create table labos.weekly_kpi_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  sync_run_id             uuid not null references labos.sync_runs(id),
  property_id             uuid not null references labos.properties(id),
  reporting_week          date not null,
  new_rentals_count       int not null,        -- official — numbered Line rows only
  new_rentals_excluded_count int not null,     -- supplemental — non-numeric-Line rows, audit-only, never counted
  move_ins_count          int not null,
  move_outs_count         int not null,
  notices_count           int not null,
  renewals_count          int not null,
  cancels_denials_count   int not null,
  walk_ins_count          int not null,
  current_exposure_count  int not null,
  unique (sync_run_id)
);
