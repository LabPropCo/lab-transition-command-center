-- ============================================================================
-- 0018 · Follow-up to 0016: two more sync fixes identified by the field-
-- coverage investigation.
--
-- 1) phase_order, stage, and sort_order were already written by
--    apply_transition_sync's metadata SET clause, but never compared by
--    sync_preview, sync_fp, or apply_transition_sync's WHERE clause — so a
--    template edit touching only one of these three fields was invisible
--    to preview and never actually applied, even though the SET clause
--    would have written it had the row been matched. Confirmed via a full
--    live scan of Arkansas (286 work items) that this has not yet produced
--    a live discrepancy — it is a latent gap, not the reported symptom.
--    Folded into the existing 'metadata' category; no new category.
--
-- 2) Wording only, no behavior change: the 'skip' (completed-protected) and
--    'archived' (template archived/deleted) preview rows previously carried
--    generic or null text. They now say plainly what changed, why it's
--    being held back, and how to release it — completed-item protection
--    and archived-work retention themselves are unchanged (still on by
--    default, still never auto-remove anything).
-- ============================================================================

-- ---------- sync_fp: 'metadata' now covers phase_order, stage, sort_order ----------
create or replace function public.sync_fp(p_change_type text, p_template_id uuid, p_go_live date)
returns text language sql stable security definer set search_path = public as $$
  select case p_change_type
    when 'rename'   then md5(concat_ws('|', coalesce(t.description,''), coalesce(t.completion_standard,'')))
    when 'metadata' then md5(concat_ws('|', coalesce(t.workstream,''), coalesce(t.phase,''),
      coalesce(t.priority,''), coalesce(t.responsible_party,''), t.go_live_gate::text,
      t.critical_path::text, coalesce(t.depends_on_code,''),
      coalesce(t.phase_order::text,''), coalesce(t.stage,''), coalesce(t.sort_order::text,'')))
    when 'due'      then md5(coalesce((p_go_live + t.due_offset_days)::text,''))
    else '' end
  from public.work_item_templates t where t.id = p_template_id;
$$;

-- ---------- sync_preview: metadata comparison widened; skip/archived reworded ----------
create or replace function public.sync_preview(p_transition_id uuid)
returns table(code text, property_id uuid, scope_type text, change_type text,
              field text, old_value text, new_value text, work_item_id uuid, completed boolean, template_id uuid)
language sql stable security definer set search_path = public as $$
  with params as (select target_go_live_date as gl from public.transitions where id = p_transition_id),
  tmpl as (select * from public.work_item_templates where not archived),
  props as (select id from public.properties where transition_id = p_transition_id),
  defr as (select template_id, change_type, fingerprint from public.transition_sync_deferrals where transition_id = p_transition_id),
  expected as (
    select t.id as template_id, t.code, null::uuid as property_id, t.scope_type, t.description,
           t.completion_standard, t.workstream,
           t.phase, t.priority, t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days,
           t.phase_order, t.stage, t.sort_order
      from tmpl t where t.scope_type = 'transition'
    union all
    select t.id, t.code, p.id, t.scope_type, t.description, t.completion_standard, t.workstream, t.phase, t.priority,
           t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days,
           t.phase_order, t.stage, t.sort_order
      from tmpl t cross join props p where t.scope_type = 'property'
  ),
  wi as (select * from public.work_items where transition_id = p_transition_id),
  matched as (
    select e.*, w.id as wid, w.description w_desc, w.completion_standard w_cs, w.workstream w_ws, w.phase w_phase, w.priority w_pri,
           w.responsible_party w_rp, w.go_live_gate w_gate, w.critical_path w_cp, w.depends_on_code w_dep,
           w.due_date w_due, w.due_date_source w_dsrc, w.status w_status,
           w.phase_order w_po, w.stage w_stage, w.sort_order w_so
    from expected e join wi w on w.template_id = e.template_id and w.property_id is not distinct from e.property_id
  )
  -- ADD
  select e.code, e.property_id, e.scope_type::text, 'add', null, null, e.description, null::uuid, false, e.template_id
    from expected e
    where not exists (select 1 from wi w where w.template_id = e.template_id and w.property_id is not distinct from e.property_id)
  union all
  -- RENAME / CONTENT (template-authored text — description and completion
  -- standard; active only; not deferred). One row per differing field.
  select m.code, m.property_id, m.scope_type::text, 'rename', f.field, f.oldv, f.newv, m.wid, false, m.template_id
    from matched m, lateral (values
      ('description', m.w_desc, m.description),
      ('completion_standard', m.w_cs, m.completion_standard)
    ) f(field, oldv, newv)
    where f.oldv is distinct from f.newv and m.w_status <> 'Complete'
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'rename' and d.fingerprint = public.sync_fp('rename', m.template_id, (select gl from params)))
  union all
  -- METADATA (per field; active only; not deferred). phase_order, stage,
  -- and sort_order are now compared here alongside the original seven —
  -- previously editable (sort_order) or template-authored (phase_order,
  -- stage) but never actually reachable by sync.
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
  -- DUE (methodology-sourced only; manual overrides protected; not deferred)
  select m.code, m.property_id, m.scope_type::text, 'due', 'due_date', m.w_due::text,
         ((select gl from params) + m.due_offset_days)::text, m.wid, false, m.template_id
    from matched m
    where m.due_offset_days is not null and (select gl from params) is not null
      and m.w_dsrc = 'methodology' and m.w_status <> 'Complete'
      and m.w_due is distinct from ((select gl from params) + m.due_offset_days)
      and not exists (select 1 from defr d where d.template_id = m.template_id and d.change_type = 'due' and d.fingerprint = public.sync_fp('due', m.template_id, (select gl from params)))
  union all
  -- SKIP (completed with any methodology delta -> protected). One row per
  -- item (counts still mean "N items protected", not "N field diffs"),
  -- but the row now names every field that actually differs and spells
  -- out why nothing was applied and how to release it. Uses the same
  -- field set as rename + metadata combined, so nothing silently drops
  -- out of view just because the item happens to be Complete.
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
      ('sort_order', m.w_so::text, m.sort_order::text)
    ) f(field, oldv, newv)
    where m.w_status = 'Complete' and f.oldv is distinct from f.newv
    group by m.code, m.property_id, m.scope_type, m.wid, m.template_id
  union all
  -- CONFLICT (scope mismatch for same immutable template)
  select t.code, w.property_id, t.scope_type::text, 'conflict', 'scope_type',
         (case when w.property_id is null then 'transition' else 'property' end), t.scope_type::text, w.id, (w.status='Complete'), t.id
    from tmpl t join wi w on w.template_id = t.id
    where (t.scope_type = 'transition' and w.property_id is not null)
       or (t.scope_type = 'property'   and w.property_id is null)
  union all
  -- ARCHIVED / ORPHANED (template archived or deleted; work retained,
  -- never touched). Wording now states plainly that the transition work
  -- item was kept, not lost — this is retention, never a failure.
  select w.code, w.property_id, w.scope_type::text, 'archived', null, null,
         (case when t.id is null
            then 'Methodology item deleted — existing transition work retained.'
            else 'Methodology item archived — existing transition work retained.' end),
         w.id, (w.status='Complete'), w.template_id
    from wi w left join public.work_item_templates t on t.id = w.template_id
    where t.id is null or t.archived;
$$;

-- ---------- apply_transition_sync: metadata change-detection widened ----------
-- (SET clause already wrote phase_order/stage/sort_order since 0010 —
-- confirmed unchanged below, no duplicate logic added, only the WHERE
-- clause that decides whether a row needs the update at all.)
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
