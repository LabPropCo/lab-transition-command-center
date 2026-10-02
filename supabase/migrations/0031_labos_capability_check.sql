-- ============================================================================
-- 0031 · LabOS, part 8: ingestion capability preflight
--
-- Answers "can THIS caller actually run a Sync Run?" using Postgres's own
-- privilege-introspection functions (has_schema_privilege/has_table_privilege)
-- against current_user — i.e. the real, live grant/RLS state at call time,
-- not a guess based on which API key was used. Deliberately NOT security
-- definer: has_*_privilege must evaluate the ACTUAL calling role's
-- privileges, not this function owner's — a security definer wrapper would
-- silently always report "authorized" regardless of who's really calling it,
-- which defeats the entire point.
--
-- Required privileges this checks (see docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md
-- for why each one is needed): schema usage; select/insert/update on
-- sync_runs (the lineage anchor — if this fails, nothing else matters);
-- insert on leasing_transactions (representative entity table) and
-- operational_memory (the one table whose content must never be silently
-- unwritable, given its immutability guarantee is only meaningful if writes
-- actually succeed in the first place).
-- ============================================================================

create or replace function labos.check_ingestion_capability()
returns table(check_name text, granted boolean)
language sql
stable
as $$
  select 'schema_usage', has_schema_privilege(current_user, 'labos', 'usage')
  union all
  select 'sync_runs_select', has_table_privilege(current_user, 'labos.sync_runs', 'select')
  union all
  select 'sync_runs_insert', has_table_privilege(current_user, 'labos.sync_runs', 'insert')
  union all
  select 'sync_runs_update', has_table_privilege(current_user, 'labos.sync_runs', 'update')
  union all
  select 'leasing_transactions_insert', has_table_privilege(current_user, 'labos.leasing_transactions', 'insert')
  union all
  select 'operational_memory_insert', has_table_privilege(current_user, 'labos.operational_memory', 'insert')
$$;

-- Granted broadly on purpose — an authenticated (non-service-role) caller
-- MUST be able to run this and get an honest "not authorized" answer; that's
-- the whole mechanism by which a misconfigured browser client fails clearly
-- instead of discovering the problem mid-write.
grant execute on function labos.check_ingestion_capability() to authenticated, service_role;
