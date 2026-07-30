-- ============================================================================
-- 0030 · LabOS, part 7: Row-Level Security
--
-- Reuses public.is_platform_admin() exactly as built for the Admin module —
-- no new permission model invented for Milestone 1. Every labos.* table is
-- read-gated to platform admins; there is no client INSERT/UPDATE/DELETE
-- policy anywhere in this schema — all writes happen through the Sync Run
-- job using the service-role key (same bypass-RLS pattern the invite-user
-- Edge Function already uses), never from the browser. A finer-grained
-- "LabOS user" role distinct from platform admin is a real future need, but
-- not invented ahead of there being more than one person who needs read
-- access.
-- ============================================================================

alter table labos.properties            enable row level security;
alter table labos.floorplans            enable row level security;
alter table labos.units                 enable row level security;
alter table labos.sync_runs             enable row level security;
alter table labos.source_files          enable row level security;
alter table labos.validation_results    enable row level security;
alter table labos.leasing_transactions  enable row level security;
alter table labos.exposure_records      enable row level security;
alter table labos.traffic_leads         enable row level security;
alter table labos.operational_memory    enable row level security;
alter table labos.weekly_kpi_snapshots  enable row level security;

create policy labos_read_platform_admin on labos.properties           for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.floorplans            for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.units                 for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.sync_runs             for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.source_files          for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.validation_results    for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.leasing_transactions  for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.exposure_records      for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.traffic_leads         for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.operational_memory    for select using (public.is_platform_admin());
create policy labos_read_platform_admin on labos.weekly_kpi_snapshots  for select using (public.is_platform_admin());

grant usage on schema labos to authenticated, service_role;
grant select on all tables in schema labos to authenticated;   -- filtered by RLS above
grant all on all tables in schema labos to service_role;       -- Sync Run job only
