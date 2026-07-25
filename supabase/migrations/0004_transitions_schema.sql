-- ============================================================================
-- 0004 · Multi-property Transitions — schema, access helpers, provisioning.
-- Non-destructive: only adds tables/columns/functions. Backfill is in 0005.
-- The Transition becomes the primary operating unit; Properties belong to it.
-- Work items carry a scope: 'transition' (once) or 'property' (per property).
-- ============================================================================

-- Transition = the portfolio-level operating unit.
create table if not exists public.transitions (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  ownership_group      text,
  target_go_live_date  date,
  current_phase        text,
  overall_status       text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Properties belong to a Transition.
alter table public.properties add column if not exists transition_id uuid references public.transitions(id) on delete cascade;
create index if not exists properties_transition_idx on public.properties(transition_id);

-- Scope enum.
do $$ begin create type public.scope_type as enum ('transition','property');
exception when duplicate_object then null; end $$;

alter table public.work_item_templates add column if not exists scope_type public.scope_type not null default 'property';

-- Work items: transition_id + scope_type; property_id becomes nullable.
alter table public.work_items add column if not exists transition_id uuid references public.transitions(id) on delete cascade;
alter table public.work_items add column if not exists scope_type public.scope_type not null default 'property';
alter table public.work_items alter column property_id drop not null;
create index if not exists work_items_transition_idx on public.work_items(transition_id);

-- Replace the old unique(property_id,code) with scope-aware partial uniques:
--   property-level: unique per (property_id, code)
--   transition-level: unique per (transition_id, code) where property_id is null
alter table public.work_items drop constraint if exists work_items_property_id_code_key;
create unique index if not exists work_items_prop_code_uq  on public.work_items(property_id, code) where property_id is not null;
create unique index if not exists work_items_trans_code_uq on public.work_items(transition_id, code) where property_id is null;

-- Audit log: allow transition-level (null property) entries; add transition_id.
alter table public.audit_log add column if not exists transition_id uuid references public.transitions(id) on delete cascade;
alter table public.audit_log alter column property_id drop not null;

-- Transition-scoped access. A member is assigned to a Transition (sees all its
-- properties + shared work). Optionally restricted to specific properties.
create table if not exists public.transition_members (
  transition_id uuid not null references public.transitions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.member_role not null default 'transition_team',
  created_at    timestamptz not null default now(),
  primary key (transition_id, user_id)
);
create index if not exists transition_members_user_idx on public.transition_members(user_id);

-- Optional per-property restriction. Rows here mean "this member is limited to
-- these properties". No rows for a member = unrestricted (all properties).
create table if not exists public.transition_member_properties (
  transition_id uuid not null,
  user_id       uuid not null,
  property_id   uuid not null references public.properties(id) on delete cascade,
  primary key (transition_id, user_id, property_id),
  foreign key (transition_id, user_id)
    references public.transition_members(transition_id, user_id) on delete cascade
);

-- ---------- Access helpers (SECURITY DEFINER; avoid RLS recursion) ----------
create or replace function public.has_transition_access(p_transition_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.transition_members
                 where transition_id = p_transition_id and user_id = auth.uid());
$$;

create or replace function public.has_transition_write(p_transition_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.transition_members
                 where transition_id = p_transition_id and user_id = auth.uid() and role <> 'read_only');
$$;

-- Scope-aware access for a specific work item (respects optional property limits).
create or replace function public.can_access_work_item(p_transition_id uuid, p_property_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
    or (
      exists (select 1 from public.transition_members m
              where m.transition_id = p_transition_id and m.user_id = auth.uid())
      and (
        p_property_id is null
        or not exists (select 1 from public.transition_member_properties r
                       where r.transition_id = p_transition_id and r.user_id = auth.uid())
        or exists (select 1 from public.transition_member_properties r
                   where r.transition_id = p_transition_id and r.user_id = auth.uid() and r.property_id = p_property_id)
      )
    );
$$;

create or replace function public.can_write_work_item(p_transition_id uuid, p_property_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
    or (
      exists (select 1 from public.transition_members m
              where m.transition_id = p_transition_id and m.user_id = auth.uid() and m.role <> 'read_only')
      and (
        p_property_id is null
        or not exists (select 1 from public.transition_member_properties r
                       where r.transition_id = p_transition_id and r.user_id = auth.uid())
        or exists (select 1 from public.transition_member_properties r
                   where r.transition_id = p_transition_id and r.user_id = auth.uid() and r.property_id = p_property_id)
      )
    );
$$;

-- ---------- Provisioning ----------
-- Instantiate everything for a transition: one work item per transition-level
-- template, and one per property per property-level template. Idempotent.
create or replace function public.instantiate_transition_work_items(p_transition_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer := 0; m integer := 0;
begin
  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, status)
  select p_transition_id, null, t.id, t.code, 'transition', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard, t.default_owner,
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code, 'Not Started'
  from public.work_item_templates t
  where t.scope_type = 'transition'
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id is null and w.code = t.code);
  get diagnostics n = row_count;

  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, status)
  select p_transition_id, p.id, t.id, t.code, 'property', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard, t.default_owner,
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code, 'Not Started'
  from public.work_item_templates t
  cross join public.properties p
  where t.scope_type = 'property' and p.transition_id = p_transition_id
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id = p.id and w.code = t.code);
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke execute on function public.instantiate_transition_work_items(uuid) from public;

-- Add one property's property-level items (used when attaching a new property).
create or replace function public.instantiate_property_work_items(p_property_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer; t_id uuid;
begin
  select transition_id into t_id from public.properties where id = p_property_id;
  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, status)
  select t_id, p_property_id, t.id, t.code, 'property', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard, t.default_owner,
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code, 'Not Started'
  from public.work_item_templates t
  where t.scope_type = 'property'
    and not exists (select 1 from public.work_items w
                    where w.property_id = p_property_id and w.code = t.code);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.instantiate_property_work_items(uuid) from public;

-- ---------- Audit trigger: carry transition_id + nullable property_id ----------
create or replace function public.work_items_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text;
begin
  select email into actor_em from public.profiles where id = actor;
  if new.status is distinct from old.status then
    insert into public.audit_log(transition_id,property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.property_id,new.id,actor,actor_em,'update','status',old.status,new.status); end if;
  if new.owner is distinct from old.owner then
    insert into public.audit_log(transition_id,property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.property_id,new.id,actor,actor_em,'update','owner',old.owner,new.owner); end if;
  if new.responsible_party is distinct from old.responsible_party then
    insert into public.audit_log(transition_id,property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.property_id,new.id,actor,actor_em,'update','responsible_party',old.responsible_party,new.responsible_party); end if;
  if new.due_date is distinct from old.due_date then
    insert into public.audit_log(transition_id,property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.property_id,new.id,actor,actor_em,'update','due_date',old.due_date::text,new.due_date::text); end if;
  if new.notes is distinct from old.notes then
    insert into public.audit_log(transition_id,property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.property_id,new.id,actor,actor_em,'update','notes',old.notes,new.notes); end if;
  if new.dropbox_link is distinct from old.dropbox_link then
    insert into public.audit_log(transition_id,property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.property_id,new.id,actor,actor_em,'update','dropbox_link',old.dropbox_link,new.dropbox_link); end if;
  return new;
end $$;
