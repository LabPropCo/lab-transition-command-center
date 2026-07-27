-- ============================================================================
-- 0021 · Sprint 18.4: query-layer support for hiding inactive-property work
-- items from Master Work Items by default.
--
-- Master Work Items currently fetches straight from work_items and filters
-- client-side against a separately-fetched `properties` array — exactly the
-- "stale client state" pattern this sprint calls out. A plain PostgREST
-- embedded-resource select (`work_items.select("...,properties(active)")`)
-- can't express "keep the row if property_id is null OR the joined property
-- is active" without switching to `!inner`, which would silently drop every
-- transition-scoped (property_id is null) row — the one thing this sprint
-- explicitly requires stays untouched. So: a thin view that does the left
-- join and the null-safe coalesce once, in SQL, and is queried directly.
--
-- security_invoker = true (Postgres 15+, which this project runs) makes the
-- view enforce RLS as the calling user against the underlying work_items
-- table exactly as if they'd queried it directly — it adds no new access,
-- only a precomputed `property_active` column to filter on.
-- ============================================================================

create or replace view public.work_items_with_property_status
with (security_invoker = true) as
  select w.*, coalesce(p.active, true) as property_active
  from public.work_items w
  left join public.properties p on p.id = w.property_id;

grant select on public.work_items_with_property_status to authenticated;
