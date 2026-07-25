import { supabase } from "../lib/supabase";
import type { Template, TemplatePatch, MethodologyVersion, SyncRow, DiffRow, SyncResult } from "./types";
import { DEMO_MODE } from "../demo/config";

const COLS =
  "id,code,sort_order,phase,phase_order,workstream,sub_workstream,description,completion_standard," +
  "default_owner,responsible_party,priority,go_live_gate,critical_path,stage,depends_on_code," +
  "scope_type,due_offset_days,archived,updated_at";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapT(r: any): Template {
  return {
    id: r.id, code: r.code, sortOrder: r.sort_order, phase: r.phase, phaseOrder: r.phase_order,
    workstream: r.workstream, subWorkstream: r.sub_workstream, description: r.description,
    completionStandard: r.completion_standard, defaultOwner: r.default_owner,
    responsibleParty: r.responsible_party, priority: r.priority, goLiveGate: r.go_live_gate,
    criticalPath: r.critical_path, stage: r.stage, dependsOnCode: r.depends_on_code,
    scopeType: r.scope_type, dueOffsetDays: r.due_offset_days, archived: r.archived, updatedAt: r.updated_at,
  };
}

function guard() {
  if (DEMO_MODE) throw new Error("Methodology editing needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
}
function friendly(e: any): Error {
  const msg = String(e?.message ?? e);
  if (e?.code === "23505" || /duplicate key/i.test(msg)) return new Error("That template ID is already in use.");
  if (e?.code === "23503" || e?.code === "23001" || /foreign key/i.test(msg) || /Archive it instead/i.test(msg))
    return new Error("This item is referenced by a transition or version history — archive it instead of deleting.");
  if (e?.code === "42501" || /permission denied/i.test(msg)) return new Error("Permission denied — platform-admin only, and grants (0007–0010) must be applied.");
  return e instanceof Error ? e : new Error(msg);
}

export async function listTemplates(includeArchived = true): Promise<Template[]> {
  if (DEMO_MODE || !supabase) return [];
  let q = supabase.from("work_item_templates").select(COLS).order("sort_order");
  if (!includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) throw friendly(error);
  return (data ?? []).map(mapT);
}

export async function createTemplate(patch: TemplatePatch): Promise<Template> {
  guard();
  const { data, error } = await supabase!.from("work_item_templates").insert(patch).select(COLS).single();
  if (error) throw friendly(error);
  return mapT(data);
}

export async function updateTemplate(id: string, patch: TemplatePatch): Promise<Template> {
  guard();
  const { data, error } = await supabase!.from("work_item_templates").update(patch).eq("id", id).select(COLS).single();
  if (error) throw friendly(error);
  return mapT(data);
}

export async function deleteTemplate(id: string): Promise<void> {
  guard();
  const { error } = await supabase!.from("work_item_templates").delete().eq("id", id);
  if (error) throw friendly(error);
}

export async function setArchived(ids: string[], archived: boolean): Promise<void> {
  guard();
  const { error } = await supabase!.from("work_item_templates").update({ archived }).in("id", ids);
  if (error) throw friendly(error);
}

export async function duplicateTemplate(t: Template, existingCodes: Set<string>): Promise<Template> {
  guard();
  let code = `${t.code}-COPY`;
  let n = 2;
  while (existingCodes.has(code)) code = `${t.code}-COPY${n++}`;
  const patch: TemplatePatch = {
    code, description: `${t.description} (copy)`, completion_standard: t.completionStandard,
    workstream: t.workstream, sub_workstream: t.subWorkstream, phase: t.phase, phase_order: t.phaseOrder,
    priority: t.priority, default_owner: t.defaultOwner, responsible_party: t.responsibleParty,
    go_live_gate: t.goLiveGate, critical_path: t.criticalPath, stage: t.stage,
    depends_on_code: t.dependsOnCode, scope_type: t.scopeType, due_offset_days: t.dueOffsetDays,
    sort_order: (t.sortOrder ?? 0) + 1, archived: false,
  };
  return createTemplate(patch);
}

// Swap sort_order with a neighbor to move an item up/down.
export async function swapOrder(a: Template, b: Template): Promise<void> {
  guard();
  const av = a.sortOrder ?? 0, bv = b.sortOrder ?? 0;
  const e1 = await supabase!.from("work_item_templates").update({ sort_order: bv }).eq("id", a.id);
  const e2 = await supabase!.from("work_item_templates").update({ sort_order: av }).eq("id", b.id);
  if (e1.error) throw friendly(e1.error);
  if (e2.error) throw friendly(e2.error);
}

// ---- Versions ----
function mapV(r: any): MethodologyVersion {
  return { id: r.id, seq: r.seq, label: r.label, note: r.note, isCurrent: r.is_current,
    addedCount: r.added_count ?? 0, changedCount: r.changed_count ?? 0, removedCount: r.removed_count ?? 0,
    createdByEmail: r.created_by_email ?? null, createdAt: r.created_at };
}
export async function listVersions(): Promise<MethodologyVersion[]> {
  if (DEMO_MODE || !supabase) return [];
  const { data, error } = await supabase.from("methodology_versions")
    .select("id,seq,label,note,is_current,added_count,changed_count,removed_count,created_by_email,created_at").order("seq", { ascending: false });
  if (error) throw friendly(error);
  return (data ?? []).map(mapV);
}
export async function publishVersion(label: string, note: string | null): Promise<void> {
  guard();
  const { error } = await supabase!.rpc("publish_methodology_version", { p_label: label, p_note: note });
  if (error) throw friendly(error);
}
export async function methodologyDiff(fromVersionId: string): Promise<DiffRow[]> {
  guard();
  const { data, error } = await supabase!.rpc("methodology_diff", { p_from: fromVersionId });
  if (error) throw friendly(error);
  return (data ?? []).map((r: any) => ({ code: r.code, changeType: r.change_type, field: r.field, oldValue: r.old_value, newValue: r.new_value }));
}

// ---- Synchronization ----
export async function syncPreview(transitionId: string): Promise<SyncRow[]> {
  guard();
  const { data, error } = await supabase!.rpc("sync_preview", { p_transition_id: transitionId });
  if (error) throw friendly(error);
  return (data ?? []).map((r: any) => ({
    code: r.code, propertyId: r.property_id, scopeType: r.scope_type, changeType: r.change_type,
    field: r.field, oldValue: r.old_value, newValue: r.new_value, workItemId: r.work_item_id, completed: r.completed, templateId: r.template_id,
  }));
}
export async function applySync(transitionId: string, opts: { add: boolean; rename: boolean; metadata: boolean; due: boolean; skipCompleted: boolean; }): Promise<SyncResult> {
  guard();
  const { data, error } = await supabase!.rpc("apply_transition_sync", {
    p_transition_id: transitionId, p_add: opts.add, p_rename: opts.rename,
    p_metadata: opts.metadata, p_due: opts.due, p_skip_completed: opts.skipCompleted,
  });
  if (error) throw friendly(error);
  return { added: data?.added ?? 0, renamed: data?.renamed ?? 0, updated: data?.updated ?? 0, due: data?.due ?? 0 };
}

export async function deferSyncChange(transitionId: string, templateId: string, changeType: "rename" | "metadata" | "due"): Promise<void> {
  guard();
  const { error } = await supabase!.rpc("defer_sync_change", { p_transition_id: transitionId, p_template_id: templateId, p_change_type: changeType });
  if (error) throw friendly(error);
}
export async function undeferSyncChange(transitionId: string, templateId: string, changeType: "rename" | "metadata" | "due"): Promise<void> {
  guard();
  const { error } = await supabase!.rpc("undefer_sync_change", { p_transition_id: transitionId, p_template_id: templateId, p_change_type: changeType });
  if (error) throw friendly(error);
}
