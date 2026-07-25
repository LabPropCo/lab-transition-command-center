-- ============================================================================
-- BEST-EFFORT structural rollback of 0004 + 0005.
-- Prefer restoring a pre-migration backup / PITR snapshot instead of this.
-- This is LOSSY: it discards the second (placeholder) property, its work items,
-- and any transition-level audit rows. TEST ON A COPY FIRST.
-- ============================================================================
begin;

-- 1) Collapse back to one property per transition (keep earliest-created).
--    Delete work items belonging to any non-primary property.
with primary_prop as (
  select distinct on (transition_id) transition_id, id as prop_id
  from public.properties order by transition_id, created_at
)
delete from public.work_items w
using public.properties p
where w.property_id = p.id
  and p.id not in (select prop_id from primary_prop);

-- Re-point transition-level items back onto the primary property.
update public.work_items w
set property_id = pp.prop_id, scope_type = 'property'
from (select distinct on (transition_id) transition_id, id as prop_id
      from public.properties order by transition_id, created_at) pp
where w.transition_id = pp.transition_id and w.property_id is null;

-- Remove non-primary properties.
delete from public.properties p
where p.id not in (select distinct on (transition_id) id
                   from public.properties order by transition_id, created_at);

-- 2) Recreate property_members and restore old helper functions.
create table if not exists public.property_members (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'transition_team',
  created_at timestamptz not null default now(),
  primary key (property_id, user_id)
);
insert into public.property_members (property_id, user_id, role)
select pp.prop_id, tm.user_id, tm.role
from public.transition_members tm
join (select distinct on (transition_id) transition_id, id as prop_id
      from public.properties order by transition_id, created_at) pp
  on pp.transition_id = tm.transition_id
on conflict do nothing;

create or replace function public.has_property_access(p_property_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.property_members where property_id=p_property_id and user_id=auth.uid());
$$;
create or replace function public.has_property_write(p_property_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.property_members where property_id=p_property_id and user_id=auth.uid() and role<>'read_only');
$$;

-- 3) Restore property-scoped RLS on work_items / properties / audit_log.
alter table public.property_members enable row level security;
drop policy if exists members_read on public.property_members;
create policy members_read on public.property_members
  for select using (user_id=auth.uid() or public.is_platform_admin());
drop policy if exists members_admin_write on public.property_members;
create policy members_admin_write on public.property_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists wi_read on public.work_items;
drop policy if exists wi_insert on public.work_items;
drop policy if exists wi_update on public.work_items;
drop policy if exists wi_delete on public.work_items;
create policy wi_read on public.work_items for select using (public.has_property_access(property_id));
create policy wi_insert on public.work_items for insert with check (public.has_property_write(property_id));
create policy wi_update on public.work_items for update using (public.has_property_write(property_id)) with check (public.has_property_write(property_id));
create policy wi_delete on public.work_items for delete using (public.has_property_write(property_id));

drop policy if exists properties_read on public.properties;
drop policy if exists properties_admin_write on public.properties;
create policy properties_read on public.properties for select using (public.has_property_access(id));
create policy properties_admin_write on public.properties for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select using (public.has_property_access(property_id));

-- 4) Drop the transition model. Drop tables (and their RLS policies, via CASCADE)
--    BEFORE the helper functions those policies depend on.
drop table if exists public.transition_member_properties cascade;
drop table if exists public.transition_members cascade;
drop table if exists public.transitions cascade;      -- also drops transitions_* policies

alter table public.work_items drop column if exists transition_id;
alter table public.work_items drop column if exists scope_type;
alter table public.audit_log  drop column if exists transition_id;
alter table public.work_item_templates drop column if exists scope_type;
alter table public.properties drop column if exists transition_id;

drop function if exists public.can_access_work_item(uuid,uuid);
drop function if exists public.can_write_work_item(uuid,uuid);
drop function if exists public.has_transition_access(uuid);
drop function if exists public.has_transition_write(uuid);
drop function if exists public.instantiate_transition_work_items(uuid);
drop type if exists public.scope_type;

-- Restore the pre-0004 property-only provisioning function.
create or replace function public.instantiate_property_work_items(p_property_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  insert into public.work_items
    (property_id, template_id, code, sort_order, phase, phase_order, workstream, sub_workstream,
     description, completion_standard, owner, responsible_party, priority, go_live_gate,
     critical_path, stage, depends_on_code, status)
  select p_property_id, t.id, t.code, t.sort_order, t.phase, t.phase_order, t.workstream, t.sub_workstream,
     t.description, t.completion_standard, t.default_owner, t.responsible_party, t.priority, t.go_live_gate,
     t.critical_path, t.stage, t.depends_on_code, 'Not Started'
  from public.work_item_templates t
  where not exists (select 1 from public.work_items w where w.property_id=p_property_id and w.code=t.code);
  get diagnostics n = row_count; return n;
end $$;

commit;
