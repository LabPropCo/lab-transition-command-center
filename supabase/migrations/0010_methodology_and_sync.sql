-- ============================================================================
-- 0010 · Methodology Library & Transition Synchronization + versioning.
-- Additive. Requires 0004-0009.
--
-- Identity model: the immutable work_item_templates.id (uuid) is the join key
-- for provisioning, synchronization, and version diffs. `code` is an editable
-- human identifier and is NOT used for matching. work_items.template_id carries
-- that immutable link.
-- ============================================================================

-- 1) Template fields: due-date logic + archive.
alter table public.work_item_templates add column if not exists due_offset_days integer;   -- days from go-live
alter table public.work_item_templates add column if not exists archived boolean not null default false;
create index if not exists wit_archived_idx on public.work_item_templates(archived);

-- 2) Distinguish methodology-derived due dates from manual overrides (#6).
alter table public.work_items add column if not exists due_date_source text not null default 'methodology';
alter table public.work_items drop constraint if exists work_items_due_source_chk;
alter table public.work_items add constraint work_items_due_source_chk
  check (due_date_source in ('methodology','manual'));

-- 3) Methodology versioning (immutable snapshots + stored change counts, #5).
create table if not exists public.methodology_versions (
  id            uuid primary key default gen_random_uuid(),
  seq           integer generated always as identity,
  label         text not null,
  note          text,                 -- release notes
  is_current    boolean not null default false,
  added_count   integer not null default 0,
  changed_count integer not null default 0,
  removed_count integer not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  created_by_email text
);

-- Snapshot keyed by the immutable template id; NO FK to templates, so deleting a
-- template never erases history. Versions are immutable (no client write path).
create table if not exists public.methodology_version_items (
  version_id uuid not null references public.methodology_versions(id) on delete cascade,
  template_id uuid not null,
  code text, description text, completion_standard text, scope_type public.scope_type,
  workstream text, sub_workstream text, phase text, phase_order integer,
  priority text, default_owner text, responsible_party text,
  go_live_gate boolean, critical_path boolean, stage text,
  depends_on_code text, due_offset_days integer, sort_order integer, archived boolean,
  primary key (version_id, template_id)
);

alter table public.transitions add column if not exists methodology_version_id uuid references public.methodology_versions(id);

-- 4) Instantiation: dedup on template_id, honor archive, set due-date + source,
-- stamp the current version.
create or replace function public.instantiate_transition_work_items(p_transition_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer := 0; v_id uuid; v_go_live date;
begin
  select id into v_id from public.methodology_versions where is_current limit 1;
  select target_go_live_date into v_go_live from public.transitions where id = p_transition_id;

  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, due_date, due_date_source, status)
  select p_transition_id, null, t.id, t.code, 'transition', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard, t.default_owner,
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  where t.scope_type = 'transition' and not t.archived
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id is null and w.template_id = t.id);
  get diagnostics n = row_count;

  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, due_date, due_date_source, status)
  select p_transition_id, p.id, t.id, t.code, 'property', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard, t.default_owner,
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  cross join public.properties p
  where t.scope_type = 'property' and not t.archived and p.transition_id = p_transition_id
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id = p.id and w.template_id = t.id);
  get diagnostics m = row_count;

  if v_id is not null then
    update public.transitions set methodology_version_id = v_id where id = p_transition_id;
  end if;
  return n + m;
end $$;
revoke execute on function public.instantiate_transition_work_items(uuid) from public;

create or replace function public.instantiate_property_work_items(p_property_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; t_id uuid; v_go_live date;
begin
  select transition_id into t_id from public.properties where id = p_property_id;
  select target_go_live_date into v_go_live from public.transitions where id = t_id;
  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, due_date, due_date_source, status)
  select t_id, p_property_id, t.id, t.code, 'property', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard, t.default_owner,
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  where t.scope_type = 'property' and not t.archived
    and not exists (select 1 from public.work_items w where w.property_id = p_property_id and w.template_id = t.id);
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.instantiate_property_work_items(uuid) from public;

-- 5) methodology_diff — current templates vs a version snapshot, keyed by template_id.
create or replace function public.methodology_diff(p_from uuid)
returns table(code text, change_type text, field text, old_value text, new_value text)
language sql stable security definer set search_path = public as $$
  with snap as (select * from public.methodology_version_items where version_id = p_from),
       cur  as (select * from public.work_item_templates)
  select c.code, 'added', null, null, c.description
    from cur c left join snap s on s.template_id = c.id
    where s.template_id is null and not c.archived
  union all
  select s.code, 'removed', null, s.description, null
    from snap s left join cur c on c.id = s.template_id
    where c.id is null or c.archived
  union all
  select c.code, 'changed', f.field, f.oldv, f.newv
  from cur c join snap s on s.template_id = c.id and not c.archived,
  lateral (values
    ('description', s.description, c.description),
    ('code', s.code, c.code),
    ('scope_type', s.scope_type::text, c.scope_type::text),
    ('workstream', s.workstream, c.workstream),
    ('phase', s.phase, c.phase),
    ('priority', s.priority, c.priority),
    ('responsible_party', s.responsible_party, c.responsible_party),
    ('go_live_gate', s.go_live_gate::text, c.go_live_gate::text),
    ('critical_path', s.critical_path::text, c.critical_path::text),
    ('depends_on_code', s.depends_on_code, c.depends_on_code),
    ('due_offset_days', s.due_offset_days::text, c.due_offset_days::text)
  ) as f(field, oldv, newv)
  where f.oldv is distinct from f.newv;
$$;
grant execute on function public.methodology_diff(uuid) to authenticated;

-- 6) Publish a version: compute change counts vs the outgoing current version,
-- snapshot by template_id, mark current. Admin only. Snapshots are immutable.
create or replace function public.publish_methodology_version(p_label text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; prev uuid; a int := 0; c int := 0; r int := 0; em text;
begin
  if not public.is_platform_admin() then raise exception 'Only a platform admin may publish a methodology version'; end if;
  select email into em from public.profiles where id = auth.uid();
  select id into prev from public.methodology_versions where is_current limit 1;
  if prev is not null then
    select count(*) filter (where change_type='added'),
           count(distinct code) filter (where change_type='changed'),
           count(*) filter (where change_type='removed')
      into a, c, r from public.methodology_diff(prev);
  end if;

  update public.methodology_versions set is_current = false where is_current;
  insert into public.methodology_versions(label, note, is_current, created_by, created_by_email, added_count, changed_count, removed_count)
    values (p_label, p_note, true, auth.uid(), em, a, c, r) returning id into v_id;
  insert into public.methodology_version_items
    (version_id, template_id, code, description, completion_standard, scope_type, workstream, sub_workstream,
     phase, phase_order, priority, default_owner, responsible_party, go_live_gate, critical_path,
     stage, depends_on_code, due_offset_days, sort_order, archived)
  select v_id, id, code, description, completion_standard, scope_type, workstream, sub_workstream,
     phase, phase_order, priority, default_owner, responsible_party, go_live_gate, critical_path,
     stage, depends_on_code, due_offset_days, sort_order, archived
  from public.work_item_templates;
  return v_id;
end $$;
revoke execute on function public.publish_methodology_version(text,text) from public;
grant execute on function public.publish_methodology_version(text,text) to authenticated;

-- 7) Per-transition sync deferrals (#3): let an admin permanently dismiss a
-- rename/metadata/due delta for one transition so it stops re-appearing.
create table if not exists public.transition_sync_deferrals (
  transition_id uuid not null references public.transitions(id) on delete cascade,
  template_id   uuid not null,
  change_type   text not null check (change_type in ('rename','metadata','due')),
  fingerprint   text not null,                 -- hash of the SPECIFIC declined delta
  methodology_version_id uuid,                 -- version context at time of deferral
  created_at    timestamptz not null default now(),
  created_by    uuid,
  primary key (transition_id, template_id, change_type)
);
alter table public.transition_sync_deferrals enable row level security;
drop policy if exists tsd_read on public.transition_sync_deferrals;
create policy tsd_read  on public.transition_sync_deferrals for select using (public.is_platform_admin());
grant select on public.transition_sync_deferrals to authenticated;
grant all    on public.transition_sync_deferrals to service_role;

-- Fingerprint of a specific methodology delta, so a deferral tracks the exact
-- change that was declined. If the template changes again the fingerprint moves
-- and the new delta re-appears rather than being permanently suppressed.
create or replace function public.sync_fp(p_change_type text, p_template_id uuid, p_go_live date)
returns text language sql stable security definer set search_path = public as $$
  select case p_change_type
    when 'rename'   then md5(coalesce(t.description,''))
    when 'metadata' then md5(concat_ws('|', coalesce(t.workstream,''), coalesce(t.phase,''),
      coalesce(t.priority,''), coalesce(t.responsible_party,''), t.go_live_gate::text,
      t.critical_path::text, coalesce(t.depends_on_code,'')))
    when 'due'      then md5(coalesce((p_go_live + t.due_offset_days)::text,''))
    else '' end
  from public.work_item_templates t where t.id = p_template_id;
$$;
grant execute on function public.sync_fp(text,uuid,date) to authenticated;

create or replace function public.defer_sync_change(p_transition_id uuid, p_template_id uuid, p_change_type text)
returns void language plpgsql security definer set search_path = public as $$
declare v_gl date; v_fp text; v_ver uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only a platform admin may defer a sync change'; end if;
  select target_go_live_date into v_gl from public.transitions where id = p_transition_id;
  v_fp := public.sync_fp(p_change_type, p_template_id, v_gl);
  select id into v_ver from public.methodology_versions where is_current limit 1;
  insert into public.transition_sync_deferrals(transition_id, template_id, change_type, fingerprint, methodology_version_id, created_by)
    values (p_transition_id, p_template_id, p_change_type, v_fp, v_ver, auth.uid())
    on conflict (transition_id, template_id, change_type)
      do update set fingerprint = excluded.fingerprint, methodology_version_id = excluded.methodology_version_id,
                    created_at = now(), created_by = excluded.created_by;
end $$;
revoke execute on function public.defer_sync_change(uuid,uuid,text) from public;
grant execute on function public.defer_sync_change(uuid,uuid,text) to authenticated;

create or replace function public.undefer_sync_change(p_transition_id uuid, p_template_id uuid, p_change_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only a platform admin may undo a deferral'; end if;
  delete from public.transition_sync_deferrals
    where transition_id = p_transition_id and template_id = p_template_id and change_type = p_change_type;
end $$;
revoke execute on function public.undefer_sync_change(uuid,uuid,text) from public;
grant execute on function public.undefer_sync_change(uuid,uuid,text) to authenticated;

-- 8) Sync preview — delta between current methodology and a transition, keyed on
-- the immutable template_id. Categories: add, rename, metadata, due, conflict,
-- skip (completed/protected), archived (template archived or deleted). Deferred
-- rename/metadata/due deltas are suppressed. Read-only.
create or replace function public.sync_preview(p_transition_id uuid)
returns table(code text, property_id uuid, scope_type text, change_type text,
              field text, old_value text, new_value text, work_item_id uuid, completed boolean, template_id uuid)
language sql stable security definer set search_path = public as $$
  with params as (select target_go_live_date as gl from public.transitions where id = p_transition_id),
  tmpl as (select * from public.work_item_templates where not archived),
  props as (select id from public.properties where transition_id = p_transition_id),
  defr as (select template_id, change_type, fingerprint from public.transition_sync_deferrals where transition_id = p_transition_id),
  expected as (
    select t.id as template_id, t.code, null::uuid as property_id, t.scope_type, t.description, t.workstream,
           t.phase, t.priority, t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days
      from tmpl t where t.scope_type = 'transition'
    union all
    select t.id, t.code, p.id, t.scope_type, t.description, t.workstream, t.phase, t.priority,
           t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days
      from tmpl t cross join props p where t.scope_type = 'property'
  ),
  wi as (select * from public.work_items where transition_id = p_transition_id),
  matched as (
    select e.*, w.id as wid, w.description w_desc, w.workstream w_ws, w.phase w_phase, w.priority w_pri,
           w.responsible_party w_rp, w.go_live_gate w_gate, w.critical_path w_cp, w.depends_on_code w_dep,
           w.due_date w_due, w.due_date_source w_dsrc, w.status w_status
    from expected e join wi w on w.template_id = e.template_id and w.property_id is not distinct from e.property_id
  )
  -- ADD
  select e.code, e.property_id, e.scope_type::text, 'add', null, null, e.description, null::uuid, false, e.template_id
    from expected e
    where not exists (select 1 from wi w where w.template_id = e.template_id and w.property_id is not distinct from e.property_id)
  union all
  -- RENAME (active only; not deferred)
  select m.code, m.property_id, m.scope_type::text, 'rename', 'description', m.w_desc, m.description, m.wid, false, m.template_id
    from matched m
    where m.description is distinct from m.w_desc and m.w_status <> 'Complete'
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'rename' and d.fingerprint = public.sync_fp('rename', m.template_id, (select gl from params)))
  union all
  -- METADATA (per field; active only; not deferred)
  select m.code, m.property_id, m.scope_type::text, 'metadata', f.field, f.oldv, f.newv, m.wid, false, m.template_id
    from matched m, lateral (values
      ('workstream', m.w_ws, m.workstream),
      ('phase', m.w_phase, m.phase),
      ('priority', m.w_pri, m.priority),
      ('responsible_party', m.w_rp, m.responsible_party),
      ('go_live_gate', m.w_gate::text, m.go_live_gate::text),
      ('critical_path', m.w_cp::text, m.critical_path::text),
      ('depends_on_code', m.w_dep, m.depends_on_code)
    ) f(field, oldv, newv)
    where f.oldv is distinct from f.newv and m.w_status <> 'Complete'
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'metadata' and d.fingerprint = public.sync_fp('metadata', m.template_id, (select gl from params)))
  union all
  -- DUE (methodology-sourced only; manual overrides protected; not deferred)
  select m.code, m.property_id, m.scope_type::text, 'due', 'due_date', m.w_due::text,
         ((select gl from params) + m.due_offset_days)::text, m.wid, false, m.template_id
    from matched m
    where m.due_offset_days is not null and (select gl from params) is not null
      and m.w_dsrc = 'methodology' and m.w_status <> 'Complete'
      and m.w_due is distinct from ((select gl from params) + m.due_offset_days)
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'due' and d.fingerprint = public.sync_fp('due', m.template_id, (select gl from params)))
  union all
  -- SKIP (completed with any delta -> protected)
  select m.code, m.property_id, m.scope_type::text, 'skip', null, null, 'completed — protected', m.wid, true, m.template_id
    from matched m
    where m.w_status = 'Complete' and (
      m.description is distinct from m.w_desc or m.workstream is distinct from m.w_ws or
      m.phase is distinct from m.w_phase or m.priority is distinct from m.w_pri or
      m.responsible_party is distinct from m.w_rp or m.go_live_gate is distinct from m.w_gate or
      m.critical_path is distinct from m.w_cp or m.depends_on_code is distinct from m.w_dep)
  union all
  -- CONFLICT (scope mismatch for same immutable template)
  select t.code, w.property_id, t.scope_type::text, 'conflict', 'scope_type',
         (case when w.property_id is null then 'transition' else 'property' end), t.scope_type::text, w.id, (w.status='Complete'), t.id
    from tmpl t join wi w on w.template_id = t.id
    where (t.scope_type = 'transition' and w.property_id is not null)
       or (t.scope_type = 'property'   and w.property_id is null)
  union all
  -- ARCHIVED / ORPHANED (template archived or deleted; work retained, never touched) (#4)
  select w.code, w.property_id, w.scope_type::text, 'archived', null, null,
         (case when t.id is null then 'template deleted' else 'template archived' end), w.id, (w.status='Complete'), w.template_id
    from wi w left join public.work_item_templates t on t.id = w.template_id
    where t.id is null or t.archived;
$$;
grant execute on function public.sync_preview(uuid) to authenticated;

-- 9) Apply — additive; matches on template_id; respects deferrals; protects
-- status, owner, notes, dropbox, audit, and manual due dates; protects completed
-- work by default; never deletes. Renames/metadata/due apply only when chosen.
create or replace function public.apply_transition_sync(
  p_transition_id uuid,
  p_add boolean default true,
  p_rename boolean default false,
  p_metadata boolean default false,
  p_due boolean default false,
  p_skip_completed boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare added int := 0; renamed int := 0; updated int := 0; dued int := 0;
        actor uuid := auth.uid(); actor_em text; v_go_live date;
begin
  if not public.is_platform_admin() then raise exception 'Only a platform admin may synchronize a transition'; end if;
  select email into actor_em from public.profiles where id = actor;
  select target_go_live_date into v_go_live from public.transitions where id = p_transition_id;

  if p_add then
    select public.instantiate_transition_work_items(p_transition_id) into added;
  end if;

  if p_rename then
    with upd as (
      update public.work_items w set description = t.description
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and w.description is distinct from t.description
          and (not p_skip_completed or w.status <> 'Complete')
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'rename'
                            and d.fingerprint = public.sync_fp('rename', t.id, v_go_live))
        returning w.id)
    select count(*) into renamed from upd;
  end if;

  if p_metadata then
    with upd as (
      update public.work_items w
        set workstream = t.workstream, phase = t.phase, phase_order = t.phase_order,
            priority = t.priority, responsible_party = t.responsible_party,
            go_live_gate = t.go_live_gate, critical_path = t.critical_path,
            stage = t.stage, depends_on_code = t.depends_on_code, sort_order = t.sort_order
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and (not p_skip_completed or w.status <> 'Complete')
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'metadata'
                            and d.fingerprint = public.sync_fp('metadata', t.id, v_go_live))
          and (w.workstream is distinct from t.workstream or w.phase is distinct from t.phase
            or w.priority is distinct from t.priority or w.responsible_party is distinct from t.responsible_party
            or w.go_live_gate is distinct from t.go_live_gate or w.critical_path is distinct from t.critical_path
            or w.depends_on_code is distinct from t.depends_on_code)
        returning w.id)
    select count(*) into updated from upd;
  end if;

  if p_due and v_go_live is not null then
    with upd as (
      update public.work_items w set due_date = v_go_live + t.due_offset_days
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and t.due_offset_days is not null and w.due_date_source = 'methodology'   -- never manual overrides
          and (not p_skip_completed or w.status <> 'Complete')
          and w.due_date is distinct from (v_go_live + t.due_offset_days)
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'due'
                            and d.fingerprint = public.sync_fp('due', t.id, v_go_live))
        returning w.id)
    select count(*) into dued from upd;
  end if;

  update public.transitions
     set methodology_version_id = (select id from public.methodology_versions where is_current limit 1)
   where id = p_transition_id;

  -- Only record an audit entry when something actually changed; a no-op sync is silent.
  if (added + renamed + updated + dued) > 0 then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('transition_sync', p_transition_id, actor, actor_em, 'synchronize', null,
            format('added=%s renamed=%s updated=%s due=%s', added, renamed, updated, dued));
  end if;

  return jsonb_build_object('added', added, 'renamed', renamed, 'updated', updated, 'due', dued);
end $$;
revoke execute on function public.apply_transition_sync(uuid,boolean,boolean,boolean,boolean,boolean) from public;
grant execute on function public.apply_transition_sync(uuid,boolean,boolean,boolean,boolean,boolean) to authenticated;

-- 10) RLS + grants for versioning tables (read-only for clients; immutable).
alter table public.methodology_versions      enable row level security;
alter table public.methodology_version_items enable row level security;
drop policy if exists mv_read on public.methodology_versions;
create policy mv_read on public.methodology_versions for select using (auth.uid() is not null);
drop policy if exists mvi_read on public.methodology_version_items;
create policy mvi_read on public.methodology_version_items for select using (auth.uid() is not null);
grant select on public.methodology_versions      to authenticated;
grant select on public.methodology_version_items to authenticated;
revoke insert, update, delete on public.methodology_versions      from authenticated;
revoke insert, update, delete on public.methodology_version_items from authenticated;
grant all on public.methodology_versions      to service_role;
grant all on public.methodology_version_items to service_role;

-- 11) Baseline version v1.0 (direct insert; migration has no auth context).
do $$ declare v uuid; begin
  if not exists (select 1 from public.methodology_versions) then
    insert into public.methodology_versions(label, note, is_current) values ('v1.0','Initial methodology baseline', true) returning id into v;
    insert into public.methodology_version_items
      (version_id, template_id, code, description, completion_standard, scope_type, workstream, sub_workstream,
       phase, phase_order, priority, default_owner, responsible_party, go_live_gate, critical_path,
       stage, depends_on_code, due_offset_days, sort_order, archived)
    select v, id, code, description, completion_standard, scope_type, workstream, sub_workstream,
       phase, phase_order, priority, default_owner, responsible_party, go_live_gate, critical_path,
       stage, depends_on_code, due_offset_days, sort_order, archived
    from public.work_item_templates;
    update public.transitions set methodology_version_id = v where methodology_version_id is null;
  end if;
end $$;

-- 12) Protect historical lineage (#Q2): a template referenced by any transition
-- work item OR any published version snapshot cannot be hard-deleted — it must be
-- archived. Only genuinely unused, never-versioned templates can be deleted.
create or replace function public.prevent_used_template_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.work_items where template_id = old.id)
     or exists (select 1 from public.methodology_version_items where template_id = old.id) then
    raise exception 'Cannot delete methodology item %: it is referenced by transition work items or version history. Archive it instead.', old.code
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;
drop trigger if exists trg_prevent_used_template_delete on public.work_item_templates;
create trigger trg_prevent_used_template_delete before delete on public.work_item_templates
  for each row execute function public.prevent_used_template_delete();
