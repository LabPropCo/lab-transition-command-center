-- ============================================================================
-- Rollback for 0015 · Master Work Owner roster.
-- Purely additive migration, so rollback is total: nothing else was touched.
-- work_items.owner and work_item_templates.default_owner are untouched by
-- both the migration and this rollback.
-- ============================================================================

drop trigger if exists trg_work_owners_audit on public.work_owners;
drop function if exists public.work_owners_audit();

drop trigger if exists trg_work_owners_touch on public.work_owners;
drop function if exists public.work_owners_touch();

drop policy if exists work_owners_admin_write on public.work_owners;
drop policy if exists work_owners_read on public.work_owners;

drop table if exists public.work_owners;
