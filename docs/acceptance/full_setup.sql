-- ============================================================
-- The Lab · Transition Command Center — full DB setup (M1 + M2)
-- Paste into the Supabase SQL Editor and Run. Idempotent: safe to
-- re-run. Applies auth/properties + work-items schema, the 106-item
-- template library, and seeds the 'Arkansas (sample)' property.
-- NOTE: re-running the seed clears the audit_log — don't re-run it
-- after you begin the edit/audit checks.
-- ============================================================
-- AUTHORITATIVE UPGRADE PATH: the numbered files in supabase/migrations/
-- (0001..0014) are the single source of truth for schema changes. This
-- full_setup.sql is a convenience for standing up a CLEAN environment only;
-- it is kept in sync with those migrations and must NOT be used as a second,
-- competing migration mechanism on an existing database.
-- ============================================================


-- ==================== migrations/0001_auth_and_properties.sql ====================

-- ============================================================================
-- M1 · Auth & property scoping
-- Tables: profiles, properties, property_members
-- Authorization: Row-Level Security is THE boundary. Deny-by-default.
-- Recursion-safety: RLS policies call SECURITY DEFINER helpers so a policy on
-- property_members never queries property_members through RLS (a classic loop).
-- ============================================================================

-- ---------- Roles ----------
do $$ begin
  create type public.member_role as enum
    ('admin','regional_manager','property_manager','accounting','transition_team','read_only');
exception when duplicate_object then null; end $$;

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text,
  -- Director of Operations / backup: sees & manages every property.
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Auto-create a profile whenever an auth user is created (invite or seed).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- properties (one row per transition) ----------
create table if not exists public.properties (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  client          text,
  transition_date date,
  go_live         date,
  units           integer,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

-- ---------- property_members (user × property × role) ----------
create table if not exists public.property_members (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.member_role not null default 'transition_team',
  created_at  timestamptz not null default now(),
  primary key (property_id, user_id)
);
create index if not exists property_members_user_idx on public.property_members(user_id);

-- ---------- Authorization helpers (SECURITY DEFINER = bypass RLS internally) ----------
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.has_property_access(p_property_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_platform_admin()
      or exists (
           select 1 from public.property_members
           where property_id = p_property_id and user_id = auth.uid()
         );
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.properties       enable row level security;
alter table public.property_members enable row level security;

-- profiles: read own or (admin) all; update only own row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- No client INSERT/DELETE: profiles are created by trigger; admin flag set server-side.

-- properties: members & admins read; only platform admins write from the client.
drop policy if exists properties_read on public.properties;
create policy properties_read on public.properties
  for select using (public.has_property_access(id));

drop policy if exists properties_admin_write on public.properties;
create policy properties_admin_write on public.properties
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- property_members: read own memberships or (admin) all; only admins write from client.
-- (The invite Edge Function uses the service-role key and bypasses RLS entirely.)
drop policy if exists members_read on public.property_members;
create policy members_read on public.property_members
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists members_admin_write on public.property_members;
create policy members_admin_write on public.property_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ==================== migrations/0002_work_items.sql ====================

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

-- ==================== migrations/0003_seed_work_item_templates.sql ====================

-- M2 · Reusable Work Item template library (106 items). Data migration.
insert into public.work_item_templates
  (code, sort_order, phase, phase_order, workstream, sub_workstream, description,
   completion_standard, default_owner, responsible_party, priority, go_live_gate,
   critical_path, stage, depends_on_code) values
  ('T001',1,'Contract Execution',0,'Executive & Legal','Executive','Execute management agreement','Fully signed agreement countersigned and filed in the deal folder.','Marcus Vidal','Shared','Critical',false,true,NULL,NULL),
  ('T002',2,'Contract Execution',0,'Executive & Legal','Executive','Confirm transition team & assign owners','Every workstream has a named owner in this workbook.','Priya Anand','The Lab','High',false,false,NULL,NULL),
  ('T003',3,'Contract Execution',0,'Executive & Legal','Executive','Hold transition kickoff call','Kickoff held; notes and 60-day plan distributed to all parties.','Priya Anand','Shared','High',false,false,NULL,NULL),
  ('T004',4,'60+ Days Before',1,'Executive & Legal','Executive','Build transition timeline & critical path','Dated plan approved by RM covering contract through 90 days.','Priya Anand','The Lab','High',false,false,NULL,NULL),
  ('T005',5,'60+ Days Before',1,'Executive & Legal','Executive','Establish weekly transition cadence','Recurring meeting scheduled with standing agenda.','Marcus Vidal','The Lab','Medium',false,false,NULL,NULL),
  ('T006',6,'Go Live',6,'Executive & Legal','Executive','Go-live confirmation & team standup','All go-live gates confirmed green; team briefed on day-one plan.','Priya Anand','The Lab','Critical',true,true,NULL,NULL),
  ('T007',7,'First 30 Days',8,'Executive & Legal','Executive','30-day stabilization review with ownership','Report delivered; open items assigned with dates.','Marcus Vidal','The Lab','High',false,false,'Stabilization',NULL),
  ('T008',8,'First 90 Days',9,'Executive & Legal','Executive','90-day operating review & handoff to standard ops','Property accepted into standard operations; transition closed.','Marcus Vidal','The Lab','High',false,false,'Operational Review',NULL),
  ('T009',9,'60+ Days Before',1,'Executive & Legal','Legal & Compliance','Obtain prior management agreement & termination notice','Prior agreement and dated termination on file.','Priya Anand','Client','High',false,false,NULL,NULL),
  ('T010',10,'60+ Days Before',1,'Executive & Legal','Legal & Compliance','Confirm entity registration & good standing','State registration and good-standing certificate saved.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T011',11,'30 Days Before',2,'Compliance','Legal & Compliance','Verify business licenses & rental permits','All required licenses current and copies stored.','Dana Whitfield','Shared','High',false,false,NULL,NULL),
  ('T012',12,'30 Days Before',2,'Compliance','Legal & Compliance','Fair housing & policy acknowledgments signed','All site staff signed acknowledgments on file.','Priya Anand','The Lab','Medium',false,false,NULL,NULL),
  ('T013',13,'14 Days Before',3,'Executive & Legal','Legal & Compliance','Review active litigation & eviction files','Open legal matters logged with counsel and status.','Priya Anand','Prior Manager','High',false,false,NULL,NULL),
  ('T014',14,'30 Days Before',2,'Compliance','Legal & Compliance','Confirm ADA & habitability compliance status','Known compliance items documented with remediation plan.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T015',15,'30 Days Before',2,'Accounting & Banking','Banking & Treasury','Open operating bank account','Operating account open with dual-control signers.','Theo Bianchi','The Lab','Critical',true,true,NULL,NULL),
  ('T016',16,'30 Days Before',2,'Accounting & Banking','Banking & Treasury','Open security deposit trust account','Segregated deposit trust account open per state law.','Theo Bianchi','The Lab','Critical',true,false,NULL,NULL),
  ('T017',17,'14 Days Before',3,'Accounting & Banking','Banking & Treasury','Complete bank signature cards','Signature cards executed for all authorized signers.','Theo Bianchi','Shared','High',false,false,NULL,NULL),
  ('T018',18,'14 Days Before',3,'Accounting & Banking','Banking & Treasury','Configure ACH & lockbox for rent','Resident payment rails tested end to end.','Theo Bianchi','The Lab','Critical',true,false,NULL,'T016'),
  ('T019',19,'7 Days Before',4,'Accounting & Banking','Banking & Treasury','Set positive pay & fraud controls','Positive pay and account alerts enabled.','Theo Bianchi','The Lab','High',false,false,NULL,NULL),
  ('T020',20,'Transition Week',5,'Accounting & Banking','Banking & Treasury','Fund initial operating float','Operating account funded per approved budget.','Marcus Vidal','Client','High',false,false,NULL,NULL),
  ('T021',21,'14 Days Before',3,'Accounting & Banking','Banking & Treasury','Transfer / re-establish merchant accounts','Card processing active under new entity.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T022',22,'60+ Days Before',1,'Accounting & Banking','Accounting','Set up property in Yardi','Entity, GL, and chart of accounts configured.','Theo Bianchi','The Lab','Critical',false,true,NULL,NULL),
  ('T023',23,'60+ Days Before',1,'Accounting & Banking','Accounting','Load approved operating budget','Board-approved budget entered and locked.','Theo Bianchi','The Lab','High',false,false,NULL,NULL),
  ('T024',24,'30 Days Before',2,'Accounting & Banking','Accounting','Obtain trailing-12 financials from prior manager','T-12 received and reconciled to bank statements.','Theo Bianchi','Prior Manager','High',false,false,NULL,NULL),
  ('T025',25,'14 Days Before',3,'Accounting & Banking','Accounting','Establish AP workflow & approval matrix','AP routing and approval thresholds live in Yardi.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T026',26,'Transition Week',5,'Accounting & Banking','Accounting','Load beginning balances','Opening trial balance posted and tied out.','Theo Bianchi','The Lab','Critical',true,true,NULL,'T022'),
  ('T027',27,'First 30 Days',8,'Accounting & Banking','Accounting','Complete first month-end close','First close completed within 5 business days; owner package sent.','Theo Bianchi','The Lab','High',false,false,'Stabilization',NULL),
  ('T028',28,'30 Days Before',2,'Accounting & Banking','Accounting','Set up utility & recovery billing (RUBS)','Utility billing configured and test-billed.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T029',29,'14 Days Before',3,'Accounting & Banking','Accounting','Reconcile security deposit ledger','Deposit liability matches trust balance to the dollar.','Theo Bianchi','Prior Manager','Critical',false,true,NULL,NULL),
  ('T030',30,'14 Days Before',3,'Accounting & Banking','Accounting','Transfer security deposit funds to trust','Deposits received into The Lab trust account.','Theo Bianchi','Client','Critical',true,false,NULL,'T029'),
  ('T031',31,'7 Days Before',4,'Accounting & Banking','Accounting','Document deposit disposition compliance','State timelines and interest rules documented.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T032',32,'14 Days Before',3,'Accounting & Banking','Accounting','Reconcile resident ledgers & prepaid rent','All resident balances match prior manager export.','Theo Bianchi','Client','Critical',false,true,NULL,NULL),
  ('T033',33,'7 Days Before',4,'Accounting & Banking','Accounting','Import resident balances into Yardi','Balances imported and verified against source.','Theo Bianchi','The Lab','High',false,false,NULL,NULL),
  ('T034',34,'7 Days Before',4,'Accounting & Banking','Accounting','Reconcile prepaid rent & concessions','Prepaids and concessions posted accurately.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T035',35,'14 Days Before',3,'Accounting & Banking','Accounting','Obtain delinquency & payment-plan files','Active delinquencies and plans transferred with balances.','Dana Whitfield','Prior Manager','High',false,false,NULL,NULL),
  ('T036',36,'7 Days Before',4,'Executive & Legal','Legal & Compliance','Transfer active eviction cases','Eviction files handed to counsel with next dates.','Priya Anand','Prior Manager','High',false,false,NULL,NULL),
  ('T037',37,'30 Days Before',2,'Property Operations','Operations','Obtain full lease files & addenda','100% of executed leases received and inventoried.','Dana Whitfield','Prior Manager','High',false,true,NULL,NULL),
  ('T038',38,'14 Days Before',3,'Property Operations','Operations','Audit lease data vs. system of record','Lease terms, rents, and dates verified in Yardi.','Rosa Marin','The Lab','Medium',false,false,NULL,NULL),
  ('T039',39,'14 Days Before',3,'Property Operations','Operations','Digitize & index resident files','All files scanned and filed in document system.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T040',40,'7 Days Before',4,'Property Operations','Operations','Build current & accurate rent roll','Rent roll certified and matches ledgers.','Theo Bianchi','The Lab','High',false,false,NULL,'T038'),
  ('T041',41,'30 Days Before',2,'Vendors & Utilities','Operations','Inventory all utility accounts','Every meter and account identified with provider.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T042',42,'14 Days Before',3,'Vendors & Utilities','Operations','Transfer utilities into management name','Accounts transferred without service interruption.','Dana Whitfield','Shared','High',false,false,NULL,NULL),
  ('T043',43,'14 Days Before',3,'Vendors & Utilities','Operations','Register utility online portals','Portal access confirmed for all accounts.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T044',44,'7 Days Before',4,'Vendors & Utilities','Operations','Set up utility auto-pay','Auto-pay configured from operating account.','Theo Bianchi','The Lab','Medium',false,false,NULL,'T043'),
  ('T045',45,'7 Days Before',4,'Vendors & Utilities','Operations','Confirm master-metered / trash / cable contracts','Bulk service contracts identified and assigned.','Dana Whitfield','The Lab','Low',false,false,NULL,NULL),
  ('T046',46,'60+ Days Before',1,'Vendors & Utilities','Vendor Transition','Collect existing vendor list & contracts','All active contracts received from prior manager.','Priya Anand','Prior Manager','High',false,false,NULL,NULL),
  ('T047',47,'30 Days Before',2,'Vendors & Utilities','Vendor Transition','Make retain / replace / terminate decisions','Every vendor has a documented disposition.','Dana Whitfield','The Lab','High',false,false,NULL,NULL),
  ('T048',48,'14 Days Before',3,'Vendors & Utilities','Vendor Transition','Issue vendor termination notices','Notices sent per contract terms with dates logged.','Priya Anand','The Lab','Medium',false,false,NULL,NULL),
  ('T049',49,'14 Days Before',3,'Vendors & Utilities','Vendor Transition','Onboard new vendors (W-9 / COI / ACH)','New vendors fully documented and payment-ready.','Priya Anand','The Lab','High',false,false,NULL,NULL),
  ('T050',50,'7 Days Before',4,'Vendors & Utilities','Vendor Transition','Assign or novate retained contracts','Retained contracts assigned to new entity.','Priya Anand','Shared','Medium',false,false,NULL,NULL),
  ('T051',51,'30 Days Before',2,'Vendors & Utilities','Vendor Transition','Secure life-safety vendor coverage','Fire, elevator, and alarm vendors confirmed active.','Dana Whitfield','The Lab','High',false,false,NULL,NULL),
  ('T052',52,'7 Days Before',4,'Vendors & Utilities','Vendor Transition','Confirm landscaping & pool service continuity','No lapse in grounds or amenity service at transfer.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T053',53,'30 Days Before',2,'Compliance','Legal & Compliance','Bind property & liability insurance','Coverage bound effective go-live date.','Theo Bianchi','Client','Critical',true,true,NULL,NULL),
  ('T054',54,'14 Days Before',3,'Compliance','Legal & Compliance','Verify certificates & additional insured','COIs list correct entities as additional insured.','Theo Bianchi','Vendor','High',false,false,NULL,NULL),
  ('T055',55,'7 Days Before',4,'Compliance','Legal & Compliance','Confirm flood / earthquake / umbrella as required','Special coverages bound where lender requires.','Theo Bianchi','The Lab','Medium',false,false,NULL,NULL),
  ('T056',56,'7 Days Before',4,'Compliance','Legal & Compliance','Document claims history & open claims','Open claims transferred with adjuster contacts.','Priya Anand','Prior Manager','Medium',false,false,NULL,NULL),
  ('T057',57,'60+ Days Before',1,'Technology & Systems','Technology','Provision Microsoft 365 accounts','Email, Teams, and drives live for site team.','IT Support','The Lab','High',false,false,NULL,NULL),
  ('T058',58,'60+ Days Before',1,'Technology & Systems','Technology','Configure Yardi user access & roles','Role-based access granted; least privilege verified.','IT Support','The Lab','High',false,false,NULL,NULL),
  ('T059',59,'30 Days Before',2,'Technology & Systems','Technology','Configure RentCafe resident portal','Portal live for payments, requests, and statements.','IT Support','The Lab','High',true,false,NULL,NULL),
  ('T060',60,'30 Days Before',2,'Technology & Systems','Technology','Set up CRM / leasing platform (Knock)','CRM migrated with lead history intact.','Rosa Marin','The Lab','Medium',false,false,NULL,NULL),
  ('T061',61,'14 Days Before',3,'Technology & Systems','Technology','Provision BlueMoon lease forms access','State-specific lease forms available and tested.','Rosa Marin','The Lab','Medium',false,false,NULL,NULL),
  ('T062',62,'14 Days Before',3,'Technology & Systems','Technology','Migrate maintenance / work-order system','Open work orders imported with history.','Dana Whitfield','Prior Manager','High',false,false,NULL,NULL),
  ('T063',63,'7 Days Before',4,'Technology & Systems','Technology','Test payment processing end to end','Live test transaction settles successfully.','IT Support','The Lab','Critical',true,true,NULL,'T018'),
  ('T064',64,'7 Days Before',4,'Technology & Systems','Technology','Configure phone system & call routing','Property line and after-hours routing verified.','IT Support','The Lab','Medium',false,false,NULL,NULL),
  ('T065',65,'14 Days Before',3,'Technology & Systems','Technology','Transfer access control & camera systems','Gate, cameras, and access admin under our control.','Dana Whitfield','Vendor','High',false,false,NULL,NULL),
  ('T066',66,'7 Days Before',4,'Technology & Systems','Technology','Set up data backup & retention','Automated backups verified for key systems.','IT Support','The Lab','Low',false,false,NULL,NULL),
  ('T067',67,'30 Days Before',2,'Human Resources','HR & Payroll','Make site-team retention / hiring decisions','Staffing plan approved; offers or notices issued.','Marcus Vidal','The Lab','High',false,false,NULL,NULL),
  ('T068',68,'30 Days Before',2,'Human Resources','HR & Payroll','Complete onboarding & I-9 / E-Verify','All new hires cleared to work before go-live.','Marcus Vidal','The Lab','High',false,false,NULL,NULL),
  ('T069',69,'30 Days Before',2,'Human Resources','HR & Payroll','Configure payroll & timekeeping','Payroll runs a successful test cycle.','Marcus Vidal','The Lab','High',true,false,NULL,NULL),
  ('T070',70,'30 Days Before',2,'Human Resources','HR & Payroll','Enroll staff in benefits','Benefits elections completed with effective dates.','Marcus Vidal','The Lab','Medium',false,false,NULL,NULL),
  ('T071',71,'14 Days Before',3,'Human Resources','HR & Payroll','Set up employee housing & concessions','Employee unit agreements and concessions documented.','Dana Whitfield','The Lab','Low',false,false,NULL,NULL),
  ('T072',72,'14 Days Before',3,'Human Resources','HR & Payroll','Deliver policy & safety training','Team completed core policy and safety modules.','Marcus Vidal','The Lab','Medium',false,false,NULL,NULL),
  ('T073',73,'60+ Days Before',1,'Marketing & Leasing','Marketing & Leasing','Photography & brand asset refresh','New photo set and branded collateral delivered.','Dana Whitfield','The Lab','Low',false,false,NULL,NULL),
  ('T074',74,'30 Days Before',2,'Marketing & Leasing','Marketing & Leasing','Launch website & complete domain transfer','Site live under our control; DNS cut over.','IT Support','Client','Medium',false,false,NULL,'T073'),
  ('T075',75,'30 Days Before',2,'Marketing & Leasing','Marketing & Leasing','Claim & update Google Business + ILS listings','All listings accurate and under our accounts.','Dana Whitfield','The Lab','Low',false,false,NULL,NULL),
  ('T076',76,'14 Days Before',3,'Marketing & Leasing','Marketing & Leasing','Configure revenue management / pricing','Pricing engine live with approved parameters.','Marcus Vidal','The Lab','Medium',false,false,NULL,NULL),
  ('T077',77,'14 Days Before',3,'Marketing & Leasing','Marketing & Leasing','Set concession & renewal strategy','Renewal and concession playbook approved.','Marcus Vidal','The Lab','Medium',false,false,NULL,NULL),
  ('T078',78,'14 Days Before',3,'Marketing & Leasing','Marketing & Leasing','Train leasing team on tour & application flow','Team certified on tour path and screening.','Rosa Marin','The Lab','Medium',false,false,NULL,NULL),
  ('T079',79,'7 Days Before',4,'Marketing & Leasing','Marketing & Leasing','Configure application & screening criteria','Screening thresholds live and compliant.','Rosa Marin','The Lab','Medium',false,false,NULL,NULL),
  ('T080',80,'30 Days Before',2,'Property Operations','Maintenance & Physical','Complete full property condition walk','Every building and amenity walked and documented.','Dana Whitfield','The Lab','High',false,false,NULL,NULL),
  ('T081',81,'30 Days Before',2,'Property Operations','Maintenance & Physical','Complete unit condition audit','Occupied and vacant units documented with photos.','Dana Whitfield','The Lab','High',false,false,NULL,NULL),
  ('T082',82,'14 Days Before',3,'Property Operations','Maintenance & Physical','Audit & re-key master key system','Key inventory reconciled; masters secured.','Dana Whitfield','The Lab','High',false,false,NULL,NULL),
  ('T083',83,'14 Days Before',3,'Property Operations','Maintenance & Physical','Inventory tools, equipment & golf carts','Asset inventory completed and tagged.','Dana Whitfield','The Lab','Low',false,false,NULL,NULL),
  ('T084',84,'14 Days Before',3,'Property Operations','Maintenance & Physical','Assess open & deferred work orders','Backlog triaged with priority and cost estimate.','Dana Whitfield','Prior Manager','High',false,false,NULL,NULL),
  ('T085',85,'7 Days Before',4,'Property Operations','Maintenance & Physical','Confirm life-safety systems operational','Fire panel, extinguishers, and alarms tested.','Dana Whitfield','The Lab','Critical',true,false,NULL,NULL),
  ('T086',86,'7 Days Before',4,'Property Operations','Maintenance & Physical','Test pool, gate, and amenity operations','All amenities safe and functional for day one.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T087',87,'Transition Week',5,'Property Operations','Maintenance & Physical','Take possession of keys & site access','Physical and system access fully handed over.','Dana Whitfield','Shared','Critical',true,true,NULL,NULL),
  ('T088',88,'14 Days Before',3,'Resident Experience','Resident Communications','Draft & approve resident welcome letter','Letter approved; explains what changes and what does not.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T089',89,'7 Days Before',4,'Resident Experience','Resident Communications','Send transition announcement to residents','Announcement delivered via mail, email, and portal.','Dana Whitfield','The Lab','High',false,false,NULL,'T087'),
  ('T090',90,'7 Days Before',4,'Resident Experience','Resident Communications','Send portal registration & payment instructions','Residents have clear steps to pay on day one.','Dana Whitfield','The Lab','High',true,false,NULL,'T059'),
  ('T091',91,'Transition Week',5,'Resident Experience','Resident Communications','Post signage & update on-site notices','New management signage and notices posted.','Dana Whitfield','The Lab','Medium',false,false,NULL,NULL),
  ('T092',92,'Week 1',7,'Resident Experience','Resident Communications','Host resident welcome / office hours','Welcome event held; feedback captured.','Rosa Marin','The Lab','Low',false,false,'Stabilization',NULL),
  ('T093',93,'Week 1',7,'Resident Experience','Resident Communications','Stand up resident feedback channel','Survey and response process operating.','Dana Whitfield','The Lab','Low',false,false,'Stabilization',NULL),
  ('T094',94,'Go Live',6,'Property Operations','Operations','Day-one systems verification','Payments, portal, phones, and access confirmed live.','IT Support','The Lab','Critical',true,false,NULL,'T065'),
  ('T095',95,'Week 1',7,'Property Operations','Operations','Daily standups & issue triage','Daily huddle running; issues logged and owned.','Dana Whitfield','The Lab','Medium',false,false,'Stabilization',NULL),
  ('T096',96,'Week 1',7,'Property Operations','Operations','Resolve inherited open work orders','Inherited backlog cleared or scheduled with dates.','Dana Whitfield','The Lab','High',false,false,'Stabilization',NULL),
  ('T097',97,'Week 1',7,'Accounting & Banking','Accounting','Confirm 100% resident payment migration','All residents transacting on the new portal.','Theo Bianchi','The Lab','High',false,false,'Stabilization',NULL),
  ('T098',98,'First 30 Days',8,'Human Resources','HR & Payroll','Complete site-team training & certifications','All required training complete and logged.','Marcus Vidal','The Lab','Medium',false,false,'Stabilization',NULL),
  ('T099',99,'First 30 Days',8,'Marketing & Leasing','Marketing & Leasing','Renewal strategy & pricing review','Renewal program launched with measured targets.','Marcus Vidal','The Lab','Medium',false,false,'Optimization',NULL),
  ('T100',100,'First 30 Days',8,'Marketing & Leasing','Marketing & Leasing','Marketing & lead-source performance review','Spend reallocated to best-performing sources.','Dana Whitfield','The Lab','Medium',false,false,'Optimization',NULL),
  ('T101',101,'First 30 Days',8,'Vendors & Utilities','Vendor Transition','Vendor scorecard & rebids','Underperforming vendors rebid or replaced.','Priya Anand','The Lab','Medium',false,false,'Optimization',NULL),
  ('T102',102,'First 30 Days',8,'Property Operations','Maintenance & Physical','Preventive maintenance program live','PM calendar built and running in the system.','Dana Whitfield','The Lab','Medium',false,false,'Optimization',NULL),
  ('T103',103,'First 90 Days',9,'Accounting & Banking','Accounting','90-day financial variance review','Actuals vs. budget explained; reforecast issued.','Theo Bianchi','The Lab','High',false,false,'Operational Review',NULL),
  ('T104',104,'First 90 Days',9,'Executive & Legal','Executive','Owner stabilization report','Formal report delivered and accepted by ownership.','Marcus Vidal','The Lab','High',false,false,'Operational Review',NULL),
  ('T105',105,'First 90 Days',9,'Executive & Legal','Executive','Transition retrospective & playbook update','Lessons captured; this workbook improved for next time.','Priya Anand','The Lab','Medium',false,false,'Operational Review',NULL),
  ('T106',106,'First 90 Days',9,'Property Operations','Operations','Confirm all systems at standard operations','Every workstream signed off as fully operational.','Dana Whitfield','The Lab','High',false,false,'Operational Review',NULL)
on conflict (code) do nothing;

-- ==================== seed.sql ====================

-- Dev seed. Applied by `supabase db reset`. Safe to delete for production.
insert into public.properties (id, name, client, transition_date, go_live, units)
values ('00000000-0000-0000-0000-000000000001', 'Arkansas (sample)', 'Larkspur Capital Partners', '2026-06-01', '2026-08-01', 284)
on conflict (id) do nothing;

-- Dev seed overlay: realistic demo state for the sample property. Dev-only.
do $$
declare p_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  perform public.instantiate_property_work_items(p_id);
  update public.work_items set status='Complete', start_date='2026-05-24', due_date='2026-06-01' where property_id=p_id and code='T001';
  update public.work_items set status='Complete', start_date='2026-05-25', due_date='2026-06-02' where property_id=p_id and code='T002';
  update public.work_items set status='Complete', start_date='2026-05-26', due_date='2026-06-03' where property_id=p_id and code='T003';
  update public.work_items set status='Complete', start_date='2026-06-08', due_date='2026-06-16' where property_id=p_id and code='T004';
  update public.work_items set status='Complete', start_date='2026-06-09', due_date='2026-06-17' where property_id=p_id and code='T005';
  update public.work_items set status='Not Started', start_date='2026-07-24', due_date='2026-08-01' where property_id=p_id and code='T006';
  update public.work_items set status='Not Started', start_date='2026-08-18', due_date='2026-08-26' where property_id=p_id and code='T007';
  update public.work_items set status='Not Started', start_date='2026-09-12', due_date='2026-09-20' where property_id=p_id and code='T008';
  update public.work_items set status='Complete', start_date='2026-06-10', due_date='2026-06-18' where property_id=p_id and code='T009';
  update public.work_items set status='Complete', start_date='2026-06-11', due_date='2026-06-19' where property_id=p_id and code='T010';
  update public.work_items set status='In Progress', start_date='2026-06-24', due_date='2026-07-02' where property_id=p_id and code='T011';
  update public.work_items set status='Complete', start_date='2026-06-25', due_date='2026-07-03' where property_id=p_id and code='T012';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-08', due_date='2026-07-16' where property_id=p_id and code='T013';
  update public.work_items set status='Not Started', start_date='2026-06-26', due_date='2026-07-04' where property_id=p_id and code='T014';
  update public.work_items set status='Complete', start_date='2026-06-27', due_date='2026-07-05' where property_id=p_id and code='T015';
  update public.work_items set status='Complete', start_date='2026-06-28', due_date='2026-07-06' where property_id=p_id and code='T016';
  update public.work_items set status='In Progress', start_date='2026-07-09', due_date='2026-07-17' where property_id=p_id and code='T017';
  update public.work_items set status='Not Started', start_date='2026-07-10', due_date='2026-07-18' where property_id=p_id and code='T018';
  update public.work_items set status='Not Started', start_date='2026-07-16', due_date='2026-07-24' where property_id=p_id and code='T019';
  update public.work_items set status='Not Started', start_date='2026-07-21', due_date='2026-07-29' where property_id=p_id and code='T020';
  update public.work_items set status='Not Started', start_date='2026-07-11', due_date='2026-07-19' where property_id=p_id and code='T021';
  update public.work_items set status='Complete', start_date='2026-06-12', due_date='2026-06-20' where property_id=p_id and code='T022';
  update public.work_items set status='Complete', start_date='2026-06-13', due_date='2026-06-21' where property_id=p_id and code='T023';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-06-29', due_date='2026-07-07' where property_id=p_id and code='T024';
  update public.work_items set status='Not Started', start_date='2026-07-12', due_date='2026-07-20' where property_id=p_id and code='T025';
  update public.work_items set status='Not Started', start_date='2026-07-22', due_date='2026-07-30' where property_id=p_id and code='T026';
  update public.work_items set status='Not Started', start_date='2026-08-19', due_date='2026-08-27' where property_id=p_id and code='T027';
  update public.work_items set status='Not Started', start_date='2026-06-30', due_date='2026-07-08' where property_id=p_id and code='T028';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-13', due_date='2026-07-21' where property_id=p_id and code='T029';
  update public.work_items set status='Not Started', start_date='2026-07-14', due_date='2026-07-22' where property_id=p_id and code='T030';
  update public.work_items set status='Not Started', start_date='2026-07-17', due_date='2026-07-25' where property_id=p_id and code='T031';
  update public.work_items set status='Waiting on Client', start_date='2026-07-15', due_date='2026-07-23' where property_id=p_id and code='T032';
  update public.work_items set status='Not Started', start_date='2026-07-18', due_date='2026-07-26' where property_id=p_id and code='T033';
  update public.work_items set status='Not Started', start_date='2026-07-19', due_date='2026-07-27' where property_id=p_id and code='T034';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-16', due_date='2026-07-24' where property_id=p_id and code='T035';
  update public.work_items set status='Not Started', start_date='2026-07-20', due_date='2026-07-28' where property_id=p_id and code='T036';
  update public.work_items set status='Waiting on Prior Manager', start_date='2026-07-01', due_date='2026-07-09' where property_id=p_id and code='T037';
  update public.work_items set status='Not Started', start_date='2026-07-17', due_date='2026-07-25' where property_id=p_id and code='T038';
  update public.work_items set status='In Progress', start_date='2026-07-18', due_date='2026-07-26' where property_id=p_id and code='T039';
  update public.work_items set status='Not Started', start_date='2026-07-21', due_date='2026-07-29' where property_id=p_id and code='T040';
  update public.work_items set status='In Progress', start_date='2026-07-02', due_date='2026-07-10' where property_id=p_id and code='T041';
  update public.work_items set status='Not Started', start_date='2026-07-19', due_date='2026-07-27' where property_id=p_id and code='T042';
  update public.work_items set status='Not Started', start_date='2026-07-20', due_date='2026-07-28' where property_id=p_id and code='T043';
  update public.work_items set status='Not Started', start_date='2026-07-22', due_date='2026-07-30' where property_id=p_id and code='T044';
  update public.work_items set status='Not Started', start_date='2026-07-23', due_date='2026-07-31' where property_id=p_id and code='T045';
  update public.work_items set status='Complete', start_date='2026-06-14', due_date='2026-06-22' where property_id=p_id and code='T046';
  update public.work_items set status='In Progress', start_date='2026-07-03', due_date='2026-07-11' where property_id=p_id and code='T047';
  update public.work_items set status='Not Started', start_date='2026-07-21', due_date='2026-07-29' where property_id=p_id and code='T048';
  update public.work_items set status='In Progress', start_date='2026-07-22', due_date='2026-07-30' where property_id=p_id and code='T049';
  update public.work_items set status='Not Started', start_date='2026-07-24', due_date='2026-08-01' where property_id=p_id and code='T050';
  update public.work_items set status='Not Started', start_date='2026-07-04', due_date='2026-07-12' where property_id=p_id and code='T051';
  update public.work_items set status='Not Started', start_date='2026-07-25', due_date='2026-08-02' where property_id=p_id and code='T052';
  update public.work_items set status='In Progress', start_date='2026-07-05', due_date='2026-07-13' where property_id=p_id and code='T053';
  update public.work_items set status='Waiting on Vendor', start_date='2026-07-23', due_date='2026-07-31' where property_id=p_id and code='T054';
  update public.work_items set status='Not Started', start_date='2026-07-26', due_date='2026-08-03' where property_id=p_id and code='T055';
  update public.work_items set status='Not Started', start_date='2026-07-27', due_date='2026-08-04' where property_id=p_id and code='T056';
  update public.work_items set status='Complete', start_date='2026-06-15', due_date='2026-06-23' where property_id=p_id and code='T057';
  update public.work_items set status='Complete', start_date='2026-06-16', due_date='2026-06-24' where property_id=p_id and code='T058';
  update public.work_items set status='Complete', start_date='2026-07-06', due_date='2026-07-14' where property_id=p_id and code='T059';
  update public.work_items set status='Complete', start_date='2026-07-07', due_date='2026-07-15' where property_id=p_id and code='T060';
  update public.work_items set status='Waiting on Vendor', start_date='2026-07-24', due_date='2026-08-01' where property_id=p_id and code='T061';
  update public.work_items set status='Not Started', start_date='2026-07-25', due_date='2026-08-02' where property_id=p_id and code='T062';
  update public.work_items set status='Not Started', start_date='2026-07-28', due_date='2026-08-05' where property_id=p_id and code='T063';
  update public.work_items set status='Not Started', start_date='2026-07-29', due_date='2026-08-06' where property_id=p_id and code='T064';
  update public.work_items set status='Waiting on Vendor', start_date='2026-07-26', due_date='2026-08-03' where property_id=p_id and code='T065';
  update public.work_items set status='Not Started', start_date='2026-07-30', due_date='2026-08-07' where property_id=p_id and code='T066';
  update public.work_items set status='Complete', start_date='2026-07-08', due_date='2026-07-16' where property_id=p_id and code='T067';
  update public.work_items set status='In Progress', start_date='2026-07-09', due_date='2026-07-17' where property_id=p_id and code='T068';
  update public.work_items set status='Complete', start_date='2026-07-10', due_date='2026-07-18' where property_id=p_id and code='T069';
  update public.work_items set status='Complete', start_date='2026-07-11', due_date='2026-07-19' where property_id=p_id and code='T070';
  update public.work_items set status='Not Started', start_date='2026-07-27', due_date='2026-08-04' where property_id=p_id and code='T071';
  update public.work_items set status='Not Started', start_date='2026-07-28', due_date='2026-08-05' where property_id=p_id and code='T072';
  update public.work_items set status='Complete', start_date='2026-06-17', due_date='2026-06-25' where property_id=p_id and code='T073';
  update public.work_items set status='Blocked', start_date='2026-07-12', due_date='2026-07-20' where property_id=p_id and code='T074';
  update public.work_items set status='Not Started', start_date='2026-07-13', due_date='2026-07-21' where property_id=p_id and code='T075';
  update public.work_items set status='Not Started', start_date='2026-07-29', due_date='2026-08-06' where property_id=p_id and code='T076';
  update public.work_items set status='Not Started', start_date='2026-07-30', due_date='2026-08-07' where property_id=p_id and code='T077';
  update public.work_items set status='Not Started', start_date='2026-07-31', due_date='2026-08-08' where property_id=p_id and code='T078';
  update public.work_items set status='Not Started', start_date='2026-07-31', due_date='2026-08-08' where property_id=p_id and code='T079';
  update public.work_items set status='In Progress', start_date='2026-07-14', due_date='2026-07-22' where property_id=p_id and code='T080';
  update public.work_items set status='In Progress', start_date='2026-07-15', due_date='2026-07-23' where property_id=p_id and code='T081';
  update public.work_items set status='Not Started', start_date='2026-08-01', due_date='2026-08-09' where property_id=p_id and code='T082';
  update public.work_items set status='Not Started', start_date='2026-08-02', due_date='2026-08-10' where property_id=p_id and code='T083';
  update public.work_items set status='Not Started', start_date='2026-08-03', due_date='2026-08-11' where property_id=p_id and code='T084';
  update public.work_items set status='Not Started', start_date='2026-08-01', due_date='2026-08-09' where property_id=p_id and code='T085';
  update public.work_items set status='Not Started', start_date='2026-08-02', due_date='2026-08-10' where property_id=p_id and code='T086';
  update public.work_items set status='Not Started', start_date='2026-07-23', due_date='2026-07-31' where property_id=p_id and code='T087';
  update public.work_items set status='In Progress', start_date='2026-08-04', due_date='2026-08-12' where property_id=p_id and code='T088';
  update public.work_items set status='Not Started', start_date='2026-08-03', due_date='2026-08-11' where property_id=p_id and code='T089';
  update public.work_items set status='Not Started', start_date='2026-08-04', due_date='2026-08-12' where property_id=p_id and code='T090';
  update public.work_items set status='Not Started', start_date='2026-07-24', due_date='2026-08-01' where property_id=p_id and code='T091';
  update public.work_items set status='Not Started', start_date='2026-07-28', due_date='2026-08-05' where property_id=p_id and code='T092';
  update public.work_items set status='Not Started', start_date='2026-07-29', due_date='2026-08-06' where property_id=p_id and code='T093';
  update public.work_items set status='Not Started', start_date='2026-07-25', due_date='2026-08-02' where property_id=p_id and code='T094';
  update public.work_items set status='Not Started', start_date='2026-07-30', due_date='2026-08-07' where property_id=p_id and code='T095';
  update public.work_items set status='Not Started', start_date='2026-07-31', due_date='2026-08-08' where property_id=p_id and code='T096';
  update public.work_items set status='Not Started', start_date='2026-08-01', due_date='2026-08-09' where property_id=p_id and code='T097';
  update public.work_items set status='Not Started', start_date='2026-08-20', due_date='2026-08-28' where property_id=p_id and code='T098';
  update public.work_items set status='Not Started', start_date='2026-08-21', due_date='2026-08-29' where property_id=p_id and code='T099';
  update public.work_items set status='Not Started', start_date='2026-08-22', due_date='2026-08-30' where property_id=p_id and code='T100';
  update public.work_items set status='Not Started', start_date='2026-08-23', due_date='2026-08-31' where property_id=p_id and code='T101';
  update public.work_items set status='Not Started', start_date='2026-08-24', due_date='2026-09-01' where property_id=p_id and code='T102';
  update public.work_items set status='Not Started', start_date='2026-09-13', due_date='2026-09-21' where property_id=p_id and code='T103';
  update public.work_items set status='Not Started', start_date='2026-09-14', due_date='2026-09-22' where property_id=p_id and code='T104';
  update public.work_items set status='Not Started', start_date='2026-09-15', due_date='2026-09-23' where property_id=p_id and code='T105';
  update public.work_items set status='Not Started', start_date='2026-09-16', due_date='2026-09-24' where property_id=p_id and code='T106';
end $$;

-- Reset audit trail after seeding so testers see only their own actions.
delete from public.audit_log;


-- ==================== migrations/0014_template_responsible_party_check.sql ====================
-- Controlled responsible_party vocabulary on work_item_templates, matching
-- work_items_resp_chk exactly. Clean environments seed only valid values, so this
-- adds without coercion. Numbered migration 0014 remains the authoritative path.
alter table public.work_item_templates drop constraint if exists work_item_templates_resp_chk;
alter table public.work_item_templates
  add constraint work_item_templates_resp_chk
  check (responsible_party is null or responsible_party in
    ('The Lab','Client','Prior Manager','Vendor','Shared'));
