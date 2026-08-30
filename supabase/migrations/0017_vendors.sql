-- ============================================================================
-- 0017 · Vendors module (Sprint 18).
--
-- Vendors are onboarded once into Yardi per transition, regardless of which
-- property's spreadsheet they originated from — one row per vendor company
-- per transition, never per property. Property is provenance only
-- (vendor_sources), never a scope the onboarding workflow depends on.
--
-- RLS uses the existing transition-level helpers (has_transition_access /
-- has_transition_write, 0004) — not property-level access.
-- ============================================================================

-- ============================================================================
-- vendor_types — global lookup, same architectural pattern as work_owners (0015).
-- ============================================================================
create table if not exists public.vendor_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vendor_types_active_name_uq
  on public.vendor_types (lower(trim(name))) where active;

create or replace function public.vendor_types_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_vendor_types_touch on public.vendor_types;
create trigger trg_vendor_types_touch before update on public.vendor_types
  for each row execute function public.vendor_types_touch();

create or replace function public.vendor_types_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text;
begin
  select email into actor_em from public.profiles where id = actor;
  if tg_op = 'INSERT' then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('vendor_type', new.id, actor, actor_em, 'created', null, new.name);
    return new;
  end if;
  if new.name is distinct from old.name then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('vendor_type', new.id, actor, actor_em, 'name', old.name, new.name);
  end if;
  if new.active is distinct from old.active then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('vendor_type', new.id, actor, actor_em, 'active', old.active::text, new.active::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_vendor_types_audit on public.vendor_types;
create trigger trg_vendor_types_audit after insert or update on public.vendor_types
  for each row execute function public.vendor_types_audit();

alter table public.vendor_types enable row level security;
drop policy if exists vendor_types_read on public.vendor_types;
create policy vendor_types_read on public.vendor_types
  for select using (auth.uid() is not null);
drop policy if exists vendor_types_admin_write on public.vendor_types;
create policy vendor_types_admin_write on public.vendor_types
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select on public.vendor_types to authenticated;
grant insert, update on public.vendor_types to authenticated; -- gated by RLS to admins; no delete (deactivate, don't delete)
grant all on public.vendor_types to service_role;

insert into public.vendor_types (name, sort_order) values
  ('Landscaping', 1), ('Pest Control', 2), ('Waste', 3), ('Internet', 4),
  ('Laundry', 5), ('Pool', 6), ('Fire & Life Safety', 7), ('Security', 8),
  ('Cleaning', 9), ('HVAC', 10), ('Plumbing', 11), ('Electrical', 12),
  ('Painting', 13), ('Roofing', 14), ('General Contractor', 15), ('Other', 16)
on conflict (lower(trim(name))) where active do nothing;

-- ============================================================================
-- vendors — one row per vendor company per transition.
-- ============================================================================
create table if not exists public.vendors (
  id                       uuid primary key default gen_random_uuid(),
  transition_id            uuid not null references public.transitions(id) on delete cascade,
  name                     text not null,

  vendor_type_id           uuid references public.vendor_types(id),

  primary_contact          text,
  phone                    text,
  email                    text,

  onboarding_path          text not null default 'Unreviewed',
  not_using_reason         text,

  w9_status                text not null default 'Not Requested',
  coi_status               text not null default 'Not Requested',
  coi_na_reason            text,

  yardi_vendor_created     boolean not null default false,
  yardi_vendor_id          text,
  yardi_verified_by        uuid references auth.users(id),
  yardi_verified_at        timestamptz,

  contract_exists          text not null default 'Unknown',
  contract_copy_received   text not null default 'Unknown',
  contract_uploaded_dropbox text not null default 'Unknown',
  dropbox_link             text,

  blocked                  boolean not null default false,
  blocked_reason           text,
  waiting_on_party         text,
  blocked_since            timestamptz,

  notes                    text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id),

  constraint vendors_onboarding_path_chk check (onboarding_path in
    ('Unreviewed','Needs Onboarding','Already in Yardi','Not Using')),
  constraint vendors_not_using_reason_chk check (not_using_reason is null or not_using_reason in
    ('Replaced by preferred vendor','Service no longer needed','Duplicate','Corporate vendor or contract','Other')),
  constraint vendors_w9_status_chk check (w9_status in
    ('Not Requested','Requested','Received','Uploaded to Yardi')),
  constraint vendors_coi_status_chk check (coi_status in
    ('Not Requested','Requested','Received','Uploaded to Yardi','N/A')),
  constraint vendors_contract_exists_chk check (contract_exists in ('Unknown','Yes','No')),
  constraint vendors_contract_copy_chk check (contract_copy_received in ('Unknown','Yes','No')),
  constraint vendors_contract_dropbox_chk check (contract_uploaded_dropbox in ('Unknown','Yes','No'))
);
create index if not exists vendors_transition_idx on public.vendors(transition_id);
create index if not exists vendors_transition_name_idx on public.vendors(transition_id, lower(trim(name)));

-- Bookkeeping: updated_at/by, and blocked_since lifecycle (mechanical — tied
-- only to the blocked boolean itself). The rule "blocked clears when
-- onboarding_path becomes Unreviewed or Not Using" is deliberately NOT here —
-- it's application logic per the implementation brief, not a DB constraint.
create or replace function public.vendors_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.blocked and not old.blocked then
    new.blocked_since := now();
  elsif not new.blocked then
    new.blocked_since := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_vendors_before_update on public.vendors;
create trigger trg_vendors_before_update
  before update on public.vendors
  for each row execute function public.vendors_before_update();

-- Audit: one row per changed meaningful field (mirrors work_items_audit, 0002/0004).
create or replace function public.vendors_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text;
begin
  select email into actor_em from public.profiles where id = actor;
  if new.onboarding_path is distinct from old.onboarding_path then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','onboarding_path',old.onboarding_path,new.onboarding_path); end if;
  if new.not_using_reason is distinct from old.not_using_reason then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','not_using_reason',old.not_using_reason,new.not_using_reason); end if;
  if new.vendor_type_id is distinct from old.vendor_type_id then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','vendor_type_id',old.vendor_type_id::text,new.vendor_type_id::text); end if;
  if new.primary_contact is distinct from old.primary_contact then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','primary_contact',old.primary_contact,new.primary_contact); end if;
  if new.phone is distinct from old.phone then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','phone',old.phone,new.phone); end if;
  if new.email is distinct from old.email then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','email',old.email,new.email); end if;
  if new.w9_status is distinct from old.w9_status then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','w9_status',old.w9_status,new.w9_status); end if;
  if new.coi_status is distinct from old.coi_status then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','coi_status',old.coi_status,new.coi_status); end if;
  if new.coi_na_reason is distinct from old.coi_na_reason then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','coi_na_reason',old.coi_na_reason,new.coi_na_reason); end if;
  if new.yardi_vendor_created is distinct from old.yardi_vendor_created then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','yardi_vendor_created',old.yardi_vendor_created::text,new.yardi_vendor_created::text); end if;
  if new.yardi_vendor_id is distinct from old.yardi_vendor_id then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','yardi_vendor_id',old.yardi_vendor_id,new.yardi_vendor_id); end if;
  if new.yardi_verified_by is distinct from old.yardi_verified_by then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','yardi_verified_by',old.yardi_verified_by::text,new.yardi_verified_by::text); end if;
  if new.contract_exists is distinct from old.contract_exists then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','contract_exists',old.contract_exists,new.contract_exists); end if;
  if new.contract_copy_received is distinct from old.contract_copy_received then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','contract_copy_received',old.contract_copy_received,new.contract_copy_received); end if;
  if new.contract_uploaded_dropbox is distinct from old.contract_uploaded_dropbox then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','contract_uploaded_dropbox',old.contract_uploaded_dropbox,new.contract_uploaded_dropbox); end if;
  if new.dropbox_link is distinct from old.dropbox_link then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','dropbox_link',old.dropbox_link,new.dropbox_link); end if;
  if new.blocked is distinct from old.blocked then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','blocked',old.blocked::text,new.blocked::text); end if;
  if new.blocked_reason is distinct from old.blocked_reason then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','blocked_reason',old.blocked_reason,new.blocked_reason); end if;
  if new.notes is distinct from old.notes then
    insert into public.vendor_audit_log(transition_id,vendor_id,actor_id,actor_email,action,field,old_value,new_value)
    values (new.transition_id,new.id,actor,actor_em,'update','notes',old.notes,new.notes); end if;
  return new;
end $$;
drop trigger if exists trg_vendors_audit on public.vendors;
create trigger trg_vendors_audit
  after update on public.vendors
  for each row execute function public.vendors_audit();

alter table public.vendors enable row level security;
drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors
  for select using (public.has_transition_access(transition_id));
drop policy if exists vendors_insert on public.vendors;
create policy vendors_insert on public.vendors
  for insert with check (public.has_transition_write(transition_id));
drop policy if exists vendors_update on public.vendors;
create policy vendors_update on public.vendors
  for update using (public.has_transition_write(transition_id)) with check (public.has_transition_write(transition_id));

grant select, insert, update on public.vendors to authenticated;
grant all on public.vendors to service_role;

-- ============================================================================
-- vendor_sources — import provenance only. Never read by onboarding workflow.
-- ============================================================================
create table if not exists public.vendor_sources (
  id                     uuid primary key default gen_random_uuid(),
  vendor_id              uuid not null references public.vendors(id) on delete cascade,
  property_id            uuid references public.properties(id) on delete set null,
  source_label           text,
  original_imported_name text not null,
  imported_by            uuid references auth.users(id),
  import_date            timestamptz not null default now(),
  created_at             timestamptz not null default now()
);
create index if not exists vendor_sources_vendor_idx on public.vendor_sources(vendor_id);
create index if not exists vendor_sources_property_idx on public.vendor_sources(property_id);

alter table public.vendor_sources enable row level security;
drop policy if exists vendor_sources_read on public.vendor_sources;
create policy vendor_sources_read on public.vendor_sources
  for select using (exists (
    select 1 from public.vendors v where v.id = vendor_sources.vendor_id and public.has_transition_access(v.transition_id)
  ));
drop policy if exists vendor_sources_insert on public.vendor_sources;
create policy vendor_sources_insert on public.vendor_sources
  for insert with check (exists (
    select 1 from public.vendors v where v.id = vendor_sources.vendor_id and public.has_transition_write(v.transition_id)
  ));
-- No update/delete policy — provenance rows are append-only, same immutability
-- posture as an audit log.

grant select, insert on public.vendor_sources to authenticated;
grant all on public.vendor_sources to service_role;

-- ============================================================================
-- vendor_audit_log — transition + vendor keyed field-diff trail (mirrors
-- audit_log / work_items_audit exactly). Client never writes directly —
-- only the SECURITY DEFINER trigger inserts.
-- ============================================================================
create table if not exists public.vendor_audit_log (
  id            bigint generated always as identity primary key,
  transition_id uuid not null references public.transitions(id) on delete cascade,
  vendor_id     uuid references public.vendors(id) on delete set null,
  actor_id      uuid references auth.users(id),
  actor_email   text,
  action        text not null,
  field         text,
  old_value     text,
  new_value     text,
  created_at    timestamptz not null default now()
);
create index if not exists vendor_audit_log_vendor_idx on public.vendor_audit_log(vendor_id, created_at desc);
create index if not exists vendor_audit_log_transition_idx on public.vendor_audit_log(transition_id, created_at desc);

alter table public.vendor_audit_log enable row level security;
drop policy if exists vendor_audit_read on public.vendor_audit_log;
create policy vendor_audit_read on public.vendor_audit_log
  for select using (public.has_transition_access(transition_id));

grant select on public.vendor_audit_log to authenticated;
grant all on public.vendor_audit_log to service_role;
