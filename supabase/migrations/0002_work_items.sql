-- ============================================================================
-- M2 · Work Items engine
--   work_item_templates  reusable library (shared, not property-scoped)
--   work_items           property-scoped instances (RLS)
--   audit_log            append-only trail written by a SECURITY DEFINER trigger
-- Bookkeeping (updated_at/by, completed_at) and audit are enforced server-side
-- by triggers, so they hold regardless of what the client sends.
-- ============================================================================

-- Allowed value sets (CHECKed here; become admin-editable config_lists in M6).
create table if not exists public.work_item_templates (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,
  sort_order         integer,
  phase              text,
  phase_order        integer,
  workstream         text,
  sub_workstream     text,
  description        text not null,
  completion_standard text,
  default_owner      text,
  responsible_party  text,
  priority           text,
  go_live_gate       boolean not null default false,
  critical_path      boolean not null default false,
  stage              text,
  depends_on_code    text,
  created_at         timestamptz not null default now()
);

create table if not exists public.work_items (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references public.properties(id) on delete cascade,
  template_id        uuid references public.work_item_templates(id),
  code               text not null,
  sort_order         integer,
  phase              text,
  phase_order        integer,
  workstream         text,
  sub_workstream     text,
  description        text not null,
  completion_standard text,
  owner              text,
  responsible_party  text,
  priority           text,
  go_live_gate       boolean not null default false,
  critical_path      boolean not null default false,
  stage              text,
  gate_group         text,
  depends_on_code    text,
  start_date         date,
  due_date           date,
  status             text not null default 'Not Started',
  notes              text,
  dropbox_link       text,
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  unique (property_id, code),
  constraint work_items_status_chk check (status in
    ('Not Started','In Progress','Waiting on Client','Waiting on Prior Manager',
     'Waiting on Vendor','Blocked','Complete','Not Applicable')),
  constraint work_items_priority_chk check (priority is null or priority in
    ('Critical','High','Medium','Low')),
  constraint work_items_resp_chk check (responsible_party is null or responsible_party in
    ('The Lab','Client','Prior Manager','Vendor','Shared'))
);
create index if not exists work_items_property_idx on public.work_items(property_id);
create index if not exists work_items_property_status_idx on public.work_items(property_id, status);

create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  property_id  uuid not null references public.properties(id) on delete cascade,
  work_item_id uuid references public.work_items(id) on delete set null,
  actor_id     uuid references auth.users(id),
  actor_email  text,
  action       text not null,
  field        text,
  old_value    text,
  new_value    text,
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_property_idx on public.audit_log(property_id, created_at desc);

-- ---------- Write authorization helper (read uses has_property_access from 0001) ----------
create or replace function public.has_property_write(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.property_members
                 where property_id = p_property_id and user_id = auth.uid()
                   and role <> 'read_only');
$$;

-- ---------- Instantiate a property's work items from the template library ----------
-- Idempotent (skips codes already present). SECURITY DEFINER so seed/admin flows
-- can populate regardless of RLS. Not granted to client roles (see revoke below).
create or replace function public.instantiate_property_work_items(p_property_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.work_items
    (property_id, template_id, code, sort_order, phase, phase_order, workstream,
     sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, status)
  select p_property_id, t.id, t.code, t.sort_order, t.phase, t.phase_order, t.workstream,
     t.sub_workstream, t.description, t.completion_standard, t.default_owner, t.responsible_party,
     t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code, 'Not Started'
  from public.work_item_templates t
  where not exists (
    select 1 from public.work_items w
    where w.property_id = p_property_id and w.code = t.code
  );
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.instantiate_property_work_items(uuid) from public;

-- ---------- Bookkeeping: updated_at/by + completed_at lifecycle ----------
create or replace function public.work_items_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status = 'Complete' and (old.status is distinct from 'Complete') then
    new.completed_at := now();                 -- completing sets the stamp
  elsif new.status <> 'Complete' then
    new.completed_at := null;                  -- reopening clears it
  end if;
  return new;
end $$;

drop trigger if exists trg_work_items_before_update on public.work_items;
create trigger trg_work_items_before_update
  before update on public.work_items
  for each row execute function public.work_items_before_update();

-- ---------- Audit: one row per changed meaningful field ----------
create or replace function public.work_items_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text;
begin
  select email into actor_em from public.profiles where id = actor;
  if new.status is distinct from old.status then
    insert into public.audit_log(property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.property_id,new.id,actor,actor_em,'update','status',old.status,new.status);
  end if;
  if new.owner is distinct from old.owner then
    insert into public.audit_log(property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.property_id,new.id,actor,actor_em,'update','owner',old.owner,new.owner);
  end if;
  if new.responsible_party is distinct from old.responsible_party then
    insert into public.audit_log(property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.property_id,new.id,actor,actor_em,'update','responsible_party',old.responsible_party,new.responsible_party);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.audit_log(property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.property_id,new.id,actor,actor_em,'update','due_date',old.due_date::text,new.due_date::text);
  end if;
  if new.notes is distinct from old.notes then
    insert into public.audit_log(property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.property_id,new.id,actor,actor_em,'update','notes',old.notes,new.notes);
  end if;
  if new.dropbox_link is distinct from old.dropbox_link then
    insert into public.audit_log(property_id,work_item_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.property_id,new.id,actor,actor_em,'update','dropbox_link',old.dropbox_link,new.dropbox_link);
  end if;
  return new;
end $$;

drop trigger if exists trg_work_items_audit on public.work_items;
create trigger trg_work_items_audit
  after update on public.work_items
  for each row execute function public.work_items_audit();

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.work_item_templates enable row level security;
alter table public.work_items          enable row level security;
alter table public.audit_log           enable row level security;

-- templates: any authenticated user may read; only platform admins may write.
drop policy if exists tpl_read on public.work_item_templates;
create policy tpl_read on public.work_item_templates
  for select using (auth.uid() is not null);
drop policy if exists tpl_admin_write on public.work_item_templates;
create policy tpl_admin_write on public.work_item_templates
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- work_items: read if you can access the property; write if you're not read_only.
drop policy if exists wi_read on public.work_items;
create policy wi_read on public.work_items
  for select using (public.has_property_access(property_id));
drop policy if exists wi_insert on public.work_items;
create policy wi_insert on public.work_items
  for insert with check (public.has_property_write(property_id));
drop policy if exists wi_update on public.work_items;
create policy wi_update on public.work_items
  for update using (public.has_property_write(property_id))
             with check (public.has_property_write(property_id));
drop policy if exists wi_delete on public.work_items;
create policy wi_delete on public.work_items
  for delete using (public.has_property_write(property_id));

-- audit_log: readable with property access; NEVER writable by clients
-- (only the SECURITY DEFINER trigger inserts — no insert/update/delete policy).
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select using (public.has_property_access(property_id));
