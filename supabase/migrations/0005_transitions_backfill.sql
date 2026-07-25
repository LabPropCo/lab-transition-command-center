-- ============================================================================
-- 0005 · Multi-property Transitions — classification, non-destructive backfill,
-- access migration, RLS swap, and the two-property Arkansas structure.
-- Preserves users, the 106 templates, existing work items, and audit history.
-- ============================================================================

-- 1) Classify templates by scope (see docs/TEMPLATE-SCOPE-MAP.md).
-- Template scope classification (see docs/TEMPLATE-SCOPE-MAP.md).
-- Transition-level templates:
update public.work_item_templates set scope_type='transition' where code in ('T001', 'T002', 'T003', 'T004', 'T005', 'T006', 'T007', 'T008', 'T009', 'T010', 'T013', 'T023', 'T025', 'T036', 'T049', 'T055', 'T057', 'T058', 'T059', 'T060', 'T061', 'T062', 'T063', 'T064', 'T066', 'T068', 'T069', 'T070', 'T071', 'T072', 'T077', 'T088', 'T099', 'T104', 'T105');
-- Property-level templates (explicit for clarity; default is already 'property'):
update public.work_item_templates set scope_type='property' where code in ('T011', 'T012', 'T014', 'T015', 'T016', 'T017', 'T018', 'T019', 'T020', 'T021', 'T022', 'T024', 'T026', 'T027', 'T028', 'T029', 'T030', 'T031', 'T032', 'T033', 'T034', 'T035', 'T037', 'T038', 'T039', 'T040', 'T041', 'T042', 'T043', 'T044', 'T045', 'T046', 'T047', 'T048', 'T050', 'T051', 'T052', 'T053', 'T054', 'T056', 'T065', 'T067', 'T073', 'T074', 'T075', 'T076', 'T078', 'T079', 'T080', 'T081', 'T082', 'T083', 'T084', 'T085', 'T086', 'T087', 'T089', 'T090', 'T091', 'T092', 'T093', 'T094', 'T095', 'T096', 'T097', 'T098', 'T100', 'T101', 'T102', 'T103', 'T106');

-- 2) Backfill existing live data into a default Transition (idempotent).
do $$
declare t_id uuid; prop_count integer; second_prop uuid;
begin
  if exists (select 1 from public.properties where transition_id is null) then
    insert into public.transitions (name, ownership_group, target_go_live_date, current_phase, overall_status)
    values ('Arkansas Portfolio Transition', 'Larkspur Capital Partners', '2026-08-01', 'Transition Week', 'On Track')
    returning id into t_id;

    -- Attach currently-unattached properties to the default transition.
    update public.properties set transition_id = t_id where transition_id is null;

    -- Backfill work_items.transition_id and align scope_type with the template.
    update public.work_items w set transition_id = p.transition_id
      from public.properties p where w.property_id = p.id and w.transition_id is null;
    update public.work_items w set scope_type = t.scope_type
      from public.work_item_templates t where w.template_id = t.id;

    -- Convert transition-level items to transition scope (null property_id).
    -- Safe only when the transition has a single property (no duplicates to merge);
    -- the current live state has exactly one seeded property.
    select count(*) into prop_count from public.properties where transition_id = t_id;
    if prop_count <= 1 then
      update public.work_items set property_id = null
        where transition_id = t_id and scope_type = 'transition';
    else
      raise notice 'Transition % has % properties; skipping auto-collapse of transition-level items. Review manually.', t_id, prop_count;
    end if;

    -- 3) Migrate access: property_members -> transition_members (unrestricted,
    -- since the single existing property == full transition access).
    insert into public.transition_members (transition_id, user_id, role)
    select distinct t_id, pm.user_id, pm.role
    from public.property_members pm join public.properties p on p.id = pm.property_id
    where p.transition_id = t_id
    on conflict (transition_id, user_id) do nothing;

    -- 4) Arkansas as two properties: add a placeholder Property B and instantiate
    -- its property-level items. (Existing property is Property A.)
    insert into public.properties (name, client, transition_date, go_live, units, transition_id)
    values ('Property B (placeholder)', 'Larkspur Capital Partners', '2026-06-01', '2026-08-01', null, t_id)
    returning id into second_prop;
    perform public.instantiate_property_work_items(second_prop);
  end if;
end $$;

-- Enforce that every property belongs to a transition (after backfill).
do $$ begin
  if not exists (select 1 from public.properties where transition_id is null) then
    alter table public.properties alter column transition_id set not null;
  end if;
end $$;

-- ============================================================================
-- 5) RLS swap: transition-scoped policies replace property-scoped ones.
-- ============================================================================
alter table public.transitions                 enable row level security;
alter table public.transition_members          enable row level security;
alter table public.transition_member_properties enable row level security;

-- transitions
drop policy if exists transitions_read on public.transitions;
create policy transitions_read on public.transitions
  for select using (public.has_transition_access(id));
drop policy if exists transitions_admin_write on public.transitions;
create policy transitions_admin_write on public.transitions
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- transition_members / restrictions
drop policy if exists tmembers_read on public.transition_members;
create policy tmembers_read on public.transition_members
  for select using (user_id = auth.uid() or public.is_platform_admin());
drop policy if exists tmembers_admin_write on public.transition_members;
create policy tmembers_admin_write on public.transition_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists tmemberprops_read on public.transition_member_properties;
create policy tmemberprops_read on public.transition_member_properties
  for select using (user_id = auth.uid() or public.is_platform_admin());
drop policy if exists tmemberprops_admin_write on public.transition_member_properties;
create policy tmemberprops_admin_write on public.transition_member_properties
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- properties: visible if you can access the transition (respecting property limits)
drop policy if exists properties_read on public.properties;
drop policy if exists properties_admin_write on public.properties;
create policy properties_read on public.properties
  for select using (public.can_access_work_item(transition_id, id));
create policy properties_admin_write on public.properties
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- work_items: scope-aware read/write
drop policy if exists wi_read on public.work_items;
drop policy if exists wi_insert on public.work_items;
drop policy if exists wi_update on public.work_items;
drop policy if exists wi_delete on public.work_items;
create policy wi_read on public.work_items
  for select using (public.can_access_work_item(transition_id, property_id));
create policy wi_insert on public.work_items
  for insert with check (public.can_write_work_item(transition_id, property_id));
create policy wi_update on public.work_items
  for update using (public.can_write_work_item(transition_id, property_id))
             with check (public.can_write_work_item(transition_id, property_id));
create policy wi_delete on public.work_items
  for delete using (public.can_write_work_item(transition_id, property_id));

-- audit_log: readable with transition access
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select using (public.has_transition_access(transition_id));

-- ============================================================================
-- 6) Drop the superseded property-scoped access model.
-- ============================================================================
drop policy if exists members_read on public.property_members;
drop policy if exists members_admin_write on public.property_members;
drop table if exists public.property_members;
drop function if exists public.has_property_access(uuid);
drop function if exists public.has_property_write(uuid);
