-- ============================================================================
-- 0020 · Sprint 18.4: inactive properties stop receiving new work items.
--
-- properties.active (0013) has had zero downstream effect anywhere in the
-- app or the sync engine. This migration fixes the synchronization half of
-- that gap (the frontend half — hiding existing inactive-property rows from
-- Master Work Items — is a query-layer change, not a DB change):
--
-- 1) sync_preview no longer proposes 'add' rows for property-scoped templates
--    on an inactive property. Rename/metadata/due preview for a property's
--    EXISTING work items is untouched — only the "would create a brand new
--    item" case is gated, per the sprint's explicit v1 choice: retain and
--    allow updates to existing rows for audit consistency, but never grow
--    new work on a property that's been deactivated.
-- 2) instantiate_transition_work_items (the function apply_transition_sync's
--    p_add branch actually calls) gets the identical "and p.active" guard on
--    its property-scoped insert, so preview and apply agree — exactly the
--    failure mode the last several sprints kept finding when preview and
--    apply disagreed about what counts.
--
-- Explicitly unchanged: archived-template retention (still literal, still
-- 'archived' category, still never auto-removes anything), rename/metadata/
-- due for existing inactive-property work items, transition-scope (shared)
-- items (property_id is null, never gated by this), instantiate_property_
-- work_items (dead code — no frontend caller; not touched).
-- ============================================================================

create or replace function public.sync_preview(p_transition_id uuid)
returns table(code text, property_id uuid, scope_type text, change_type text,
              field text, old_value text, new_value text, work_item_id uuid, completed boolean, template_id uuid)
language sql stable security definer set search_path = public as $$
  with params as (select target_go_live_date as gl from public.transitions where id = p_transition_id),
  tmpl as (select * from public.work_item_templates where not archived),
  props as (select id, active from public.properties where transition_id = p_transition_id),
  defr as (select template_id, change_type, fingerprint from public.transition_sync_deferrals where transition_id = p_transition_id),
  expected as (
    select t.id as template_id, t.code, null::uuid as property_id, t.scope_type, t.description,
           t.completion_standard, t.workstream,
           t.phase, t.priority, t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days,
           t.phase_order, t.stage, t.sort_order, true as property_active
      from tmpl t where t.scope_type = 'transition'
    union all
    select t.id, t.code, p.id, t.scope_type, t.description, t.completion_standard, t.workstream, t.phase, t.priority,
           t.responsible_party, t.go_live_gate, t.critical_path, t.depends_on_code, t.due_offset_days,
           t.phase_order, t.stage, t.sort_order, p.active
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
  -- ADD (never for an inactive property — existing rows for one are still retained and still sync via rename/metadata/due below)
  select e.code, e.property_id, e.scope_type::text, 'add', null, null, e.description, null::uuid, false, e.template_id
    from expected e
    where not exists (select 1 from wi w where w.template_id = e.template_id and w.property_id is not distinct from e.property_id)
      and e.property_active
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
  -- METADATA (per field; active only; not deferred).
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
  -- SKIP (completed with any methodology delta -> protected).
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
  -- never touched — unchanged by this migration).
  select w.code, w.property_id, w.scope_type::text, 'archived', null, null,
         (case when t.id is null
            then 'Methodology item deleted — existing transition work retained.'
            else 'Methodology item archived — existing transition work retained.' end),
         w.id, (w.status='Complete'), w.template_id
    from wi w left join public.work_item_templates t on t.id = w.template_id
    where t.id is null or t.archived;
$$;

-- ---------- instantiate_transition_work_items: no new work items on an inactive property ----------
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
     t.workstream, t.sub_workstream, t.description, t.completion_standard,
     coalesce(t.default_owner, public.current_user_display()),
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
     t.workstream, t.sub_workstream, t.description, t.completion_standard,
     coalesce(t.default_owner, public.current_user_display()),
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  cross join public.properties p
  where t.scope_type = 'property' and not t.archived and p.transition_id = p_transition_id
    and p.active   -- NEW: never instantiate a new work item on an inactive property
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id = p.id and w.template_id = t.id);
  get diagnostics m = row_count;

  if v_id is not null then
    update public.transitions set methodology_version_id = v_id where id = p_transition_id;
  end if;
  return n + m;
end $$;
revoke execute on function public.instantiate_transition_work_items(uuid) from public;
