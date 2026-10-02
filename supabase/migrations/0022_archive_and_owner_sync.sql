-- ============================================================================
-- 0022 · Sprint 18.5: archived work items actually hide, owner actually syncs.
--
-- PART 1 — root cause: the 'archived' preview category was informational
-- only. apply_transition_sync never had a branch for it — archiving a
-- template updated work_item_templates.archived and nothing else. Master
-- Work Items has no concept of "work item archived" at all (only "property
-- inactive", from 0020/0021 — a different, unrelated flag). So an archived
-- template's already-instantiated work items stayed fully visible forever.
-- Fix: a real archived_at timestamp on work_items, two new ACTIONABLE preview
-- categories ('archive' / 'restore'), and query-layer default exclusion
-- (frontend, see work-items/api.ts) — same shape as 0020/0021's inactive-
-- property fix, but archived work items are hidden EVERYWHERE by default
-- (Dashboard, Roadmap, Master Work Items) unless a screen opts in, per this
-- sprint's explicit instruction — the reverse default from inactive
-- properties, which only Master Work Items opts into hiding.
--
-- PART 2 — root cause: 'owner' (work_items.owner / templates.default_owner)
-- was never a sync_preview comparison field and never appeared in
-- apply_transition_sync's metadata SET clause. Migration 0011 designed it as
-- a one-time instantiation default ("existing assignments are never
-- overwritten") — correct at the time, but the product now needs ongoing
-- sync of who's responsible. Verified live: work_item_templates.default_owner
-- is plain unconstrained text (0015's own comment: "does NOT touch
-- work_items.owner or work_item_templates.default_owner: those remain plain,
-- unconstrained text"), matched against work_owners.display_name only for the
-- UI dropdown — there is no foreign key, no owner_source column, no per-
-- transition override mechanism of any kind. Per the sprint's own fallback
-- instruction for exactly this case, the new 'owner' category synchronizes
-- default_owner -> owner directly (comparing the only value that exists: the
-- free-text name), gated by the same completed-item protection and the same
-- per-item "Ignore" deferral every other content category already has.
-- owner_conflicts is always 0 in the apply response — there is no override
-- state to conflict with; documented here rather than silently omitted.
-- ============================================================================

-- ---------- schema: archived_at on work_items ----------
alter table public.work_items add column if not exists archived_at timestamptz;

-- Re-resolve the view's column list now that work_items has a new column —
-- `select w.*` freezes its expansion at (re)definition time in Postgres, so
-- this must be replaced, not left alone, for archived_at to reach the client.
-- CREATE OR REPLACE can only append trailing columns, and the new
-- archived_at column lands in the middle of the star-expansion (before the
-- existing trailing property_active), so the view must be dropped and
-- recreated rather than replaced in place. Nothing else in the schema
-- references this view, so this is safe.
drop view if exists public.work_items_with_property_status;
create view public.work_items_with_property_status
with (security_invoker = true) as
  select w.*, coalesce(p.active, true) as property_active
  from public.work_items w
  left join public.properties p on p.id = w.property_id;

grant select on public.work_items_with_property_status to authenticated;

-- ---------- transition_sync_deferrals: widen change_type to allow 'owner' ----------
alter table public.transition_sync_deferrals drop constraint if exists transition_sync_deferrals_change_type_check;
alter table public.transition_sync_deferrals add constraint transition_sync_deferrals_change_type_check
  check (change_type in ('rename','metadata','due','owner'));

-- ---------- sync_fp: add 'owner' fingerprint ----------
create or replace function public.sync_fp(p_change_type text, p_template_id uuid, p_go_live date)
returns text language sql stable security definer set search_path = public as $$
  select case p_change_type
    when 'rename'   then md5(concat_ws('|', coalesce(t.description,''), coalesce(t.completion_standard,'')))
    when 'metadata' then md5(concat_ws('|', coalesce(t.workstream,''), coalesce(t.phase,''),
      coalesce(t.priority,''), coalesce(t.responsible_party,''), t.go_live_gate::text,
      t.critical_path::text, coalesce(t.depends_on_code,''),
      coalesce(t.phase_order::text,''), coalesce(t.stage,''), coalesce(t.sort_order::text,'')))
    when 'due'      then md5(coalesce((p_go_live + t.due_offset_days)::text,''))
    when 'owner'    then md5(coalesce(t.default_owner,''))
    else '' end
  from public.work_item_templates t where t.id = p_template_id;
$$;

-- ---------- sync_preview: 'archive'/'restore' actionable, 'owner' actionable ----------
create or replace function public.sync_preview(p_transition_id uuid)
returns table(code text, property_id uuid, scope_type text, change_type text,
              field text, old_value text, new_value text, work_item_id uuid, completed boolean, template_id uuid)
language sql stable security definer set search_path = public as $$
  with params as (select target_go_live_date as gl from public.transitions where id = p_transition_id),
  tmpl as (select * from public.work_item_templates where not archived),
  all_tmpl as (select * from public.work_item_templates),
  props as (select id, active from public.properties where transition_id = p_transition_id),
  defr as (select template_id, change_type, fingerprint from public.transition_sync_deferrals where transition_id = p_transition_id),
  expected as (
    select t.id as template_id, t.code, null::uuid as property_id, t.scope_type, t.description,
           t.completion_standard, t.workstream,
           t.phase, t.priority, t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days,
           t.phase_order, t.stage, t.sort_order, true as property_active, t.default_owner
      from tmpl t where t.scope_type = 'transition'
    union all
    select t.id, t.code, p.id, t.scope_type, t.description, t.completion_standard, t.workstream, t.phase, t.priority,
           t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days,
           t.phase_order, t.stage, t.sort_order, p.active, t.default_owner
      from tmpl t cross join props p where t.scope_type = 'property'
  ),
  wi as (select * from public.work_items where transition_id = p_transition_id),
  matched as (
    select e.*, w.id as wid, w.description w_desc, w.completion_standard w_cs, w.workstream w_ws, w.phase w_phase, w.priority w_pri,
           w.responsible_party w_rp, w.go_live_gate w_gate, w.critical_path w_cp, w.depends_on_code w_dep,
           w.due_date w_due, w.due_date_source w_dsrc, w.status w_status,
           w.phase_order w_po, w.stage w_stage, w.sort_order w_so, w.owner w_owner, w.archived_at w_archived_at
    from expected e join wi w on w.template_id = e.template_id and w.property_id is not distinct from e.property_id
  )
  -- ADD (never for an inactive property)
  select e.code, e.property_id, e.scope_type::text, 'add', null, null, e.description, null::uuid, false, e.template_id
    from expected e
    where not exists (select 1 from wi w where w.template_id = e.template_id and w.property_id is not distinct from e.property_id)
      and e.property_active
  union all
  -- RENAME / CONTENT
  select m.code, m.property_id, m.scope_type::text, 'rename', f.field, f.oldv, f.newv, m.wid, false, m.template_id
    from matched m, lateral (values
      ('description', m.w_desc, m.description),
      ('completion_standard', m.w_cs, m.completion_standard)
    ) f(field, oldv, newv)
    where f.oldv is distinct from f.newv and m.w_status <> 'Complete'
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'rename' and d.fingerprint = public.sync_fp('rename', m.template_id, (select gl from params)))
  union all
  -- METADATA
  select m.code, m.property_id, m.scope_type::text, 'metadata', f.field, f.oldv, f.newv, m.wid, false, m.template_id
    from matched m, lateral (values
      ('workstream', m.w_ws, m.workstream),
      ('phase', m.w_phase, m.phase),
      ('priority', m.w_pri, m.priority),
      ('responsible_party', m.w_rp, m.responsible_party),
      ('go_live_gate', m.w_gate::text, m.go_live_gate::text),
      ('critical_path', m.w_cp::text, m.critical_path::text),
      ('depends_on_code', m.w_dep, m.depends_on_code),
      ('phase_order', m.w_po::text, m.phase_order::text),
      ('stage', m.w_stage, m.stage),
      ('sort_order', m.w_so::text, m.sort_order::text)
    ) f(field, oldv, newv)
    where f.oldv is distinct from f.newv and m.w_status <> 'Complete'
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'metadata' and d.fingerprint = public.sync_fp('metadata', m.template_id, (select gl from params)))
  union all
  -- OWNER (default_owner -> owner; only when the methodology actually names one)
  select m.code, m.property_id, m.scope_type::text, 'owner', 'owner', m.w_owner, m.default_owner, m.wid, false, m.template_id
    from matched m
    where m.default_owner is not null and m.w_owner is distinct from m.default_owner and m.w_status <> 'Complete'
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'owner' and d.fingerprint = public.sync_fp('owner', m.template_id, (select gl from params)))
  union all
  -- DUE
  select m.code, m.property_id, m.scope_type::text, 'due', 'due_date', m.w_due::text,
         ((select gl from params) + m.due_offset_days)::text, m.wid, false, m.template_id
    from matched m
    where m.due_offset_days is not null and (select gl from params) is not null
      and m.w_dsrc = 'methodology' and m.w_status <> 'Complete'
      and m.w_due is distinct from ((select gl from params) + m.due_offset_days)
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'due' and d.fingerprint = public.sync_fp('due', m.template_id, (select gl from params)))
  union all
  -- ARCHIVE (template archived or deleted; work item not yet archived — actionable, default-on)
  select w.code, w.property_id, w.scope_type::text, 'archive', null, null,
         'Archived — hidden from Master Work Items by default.', w.id, (w.status='Complete'), w.template_id
    from wi w left join all_tmpl t on t.id = w.template_id
    where w.archived_at is null and (t.id is null or t.archived)
  union all
  -- RESTORE (template active again; work item still marked archived from before — actionable, default-on)
  select w.code, w.property_id, w.scope_type::text, 'restore', null, null,
         'Restored — will reappear in Master Work Items.', w.id, (w.status='Complete'), w.template_id
    from wi w join all_tmpl t on t.id = w.template_id
    where w.archived_at is not null and not t.archived
  union all
  -- SKIP (completed with any methodology delta -> protected)
  select m.code, m.property_id, m.scope_type::text, 'skip',
         string_agg(f.field, ', ' order by f.field), null,
         'Methodology has changed but this item is marked Complete, so it is protected — uncheck "Protect completed work" to apply it.',
         m.wid, true, m.template_id
    from matched m, lateral (values
      ('description', m.w_desc, m.description),
      ('completion_standard', m.w_cs, m.completion_standard),
      ('workstream', m.w_ws, m.workstream),
      ('phase', m.w_phase, m.phase),
      ('priority', m.w_pri, m.priority),
      ('responsible_party', m.w_rp, m.responsible_party),
      ('go_live_gate', m.w_gate::text, m.go_live_gate::text),
      ('critical_path', m.w_cp::text, m.critical_path::text),
      ('depends_on_code', m.w_dep, m.depends_on_code),
      ('phase_order', m.w_po::text, m.phase_order::text),
      ('stage', m.w_stage, m.stage),
      ('sort_order', m.w_so::text, m.sort_order::text),
      ('owner', m.w_owner, m.default_owner)
    ) f(field, oldv, newv)
    where m.w_status = 'Complete' and f.oldv is distinct from f.newv
    group by m.code, m.property_id, m.scope_type, m.wid, m.template_id
  union all
  -- CONFLICT (scope mismatch for same immutable template)
  select t.code, w.property_id, t.scope_type::text, 'conflict', 'scope_type',
         (case when w.property_id is null then 'transition' else 'property' end), t.scope_type::text, w.id, (w.status='Complete'), t.id
    from tmpl t join wi w on w.template_id = t.id
    where (t.scope_type = 'transition' and w.property_id is not null)
       or (t.scope_type = 'property'   and w.property_id is null);
$$;

-- ---------- apply_transition_sync: p_archive/p_restore/p_owner, default true ----------
create or replace function public.apply_transition_sync(
  p_transition_id uuid,
  p_add boolean default true,
  p_rename boolean default true,
  p_metadata boolean default true,
  p_due boolean default false,
  p_skip_completed boolean default true,
  p_archive boolean default true,
  p_restore boolean default true,
  p_owner boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare added int := 0; renamed int := 0; updated int := 0; dued int := 0;
        archived_n int := 0; restored_n int := 0; owners_updated int := 0;
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
      update public.work_items w set description = t.description, completion_standard = t.completion_standard
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and (w.description is distinct from t.description or w.completion_standard is distinct from t.completion_standard)
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
            or w.depends_on_code is distinct from t.depends_on_code
            or w.phase_order is distinct from t.phase_order or w.stage is distinct from t.stage
            or w.sort_order is distinct from t.sort_order)
        returning w.id)
    select count(*) into updated from upd;
  end if;

  if p_owner then
    with upd as (
      update public.work_items w set owner = t.default_owner
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and t.default_owner is not null and w.owner is distinct from t.default_owner
          and (not p_skip_completed or w.status <> 'Complete')
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'owner'
                            and d.fingerprint = public.sync_fp('owner', t.id, v_go_live))
        returning w.id)
    select count(*) into owners_updated from upd;
  end if;

  if p_due and v_go_live is not null then
    with upd as (
      update public.work_items w set due_date = v_go_live + t.due_offset_days
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and t.due_offset_days is not null and w.due_date_source = 'methodology'
          and (not p_skip_completed or w.status <> 'Complete')
          and w.due_date is distinct from (v_go_live + t.due_offset_days)
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'due'
                            and d.fingerprint = public.sync_fp('due', t.id, v_go_live))
        returning w.id)
    select count(*) into dued from upd;
  end if;

  if p_archive then
    with upd as (
      update public.work_items w set archived_at = now()
        where w.transition_id = p_transition_id and w.archived_at is null
          and (exists (select 1 from public.work_item_templates t where t.id = w.template_id and t.archived)
            or not exists (select 1 from public.work_item_templates t where t.id = w.template_id))
        returning w.id)
    select count(*) into archived_n from upd;
  end if;

  if p_restore then
    with upd as (
      update public.work_items w set archived_at = null
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and w.archived_at is not null and not t.archived
        returning w.id)
    select count(*) into restored_n from upd;
  end if;

  update public.transitions
     set methodology_version_id = (select id from public.methodology_versions where is_current limit 1)
   where id = p_transition_id;

  if (added + renamed + updated + dued + archived_n + restored_n + owners_updated) > 0 then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('transition_sync', p_transition_id, actor, actor_em, 'synchronize', null,
            format('added=%s renamed=%s updated=%s due=%s archived=%s restored=%s owners_updated=%s',
                   added, renamed, updated, dued, archived_n, restored_n, owners_updated));
  end if;

  return jsonb_build_object('added', added, 'renamed', renamed, 'updated', updated, 'due', dued,
                             'archived', archived_n, 'restored', restored_n,
                             'owners_updated', owners_updated, 'owner_conflicts', 0);
end $$;
