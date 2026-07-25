import { supabase } from "../lib/supabase";
import type { WorkItem, WorkItemPatch } from "./types";
import { DEMO_MODE } from "../demo/config";

const COLS =
  "id,transition_id,property_id,scope_type,code,sort_order,phase,phase_order,workstream,sub_workstream," +
  "description,completion_standard,owner,responsible_party,priority,go_live_gate,critical_path,stage," +
  "gate_group,depends_on_code,start_date,due_date,status,notes,dropbox_link,completed_at,updated_at,updated_by";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): WorkItem {
  return {
    id: r.id, transitionId: r.transition_id, propertyId: r.property_id, scopeType: r.scope_type,
    code: r.code, sortOrder: r.sort_order, phase: r.phase, phaseOrder: r.phase_order,
    workstream: r.workstream, subWorkstream: r.sub_workstream, description: r.description,
    completionStandard: r.completion_standard, owner: r.owner, responsibleParty: r.responsible_party,
    priority: r.priority, goLiveGate: r.go_live_gate, criticalPath: r.critical_path, stage: r.stage,
    gateGroup: r.gate_group, dependsOnCode: r.depends_on_code, startDate: r.start_date, dueDate: r.due_date,
    status: r.status, notes: r.notes, dropboxLink: r.dropbox_link, completedAt: r.completed_at,
    updatedAt: r.updated_at, updatedBy: r.updated_by,
  };
}

// List all work items in a transition (RLS scopes to what the user may see).
export async function listWorkItems(transitionId: string): Promise<WorkItem[]> {
  if (DEMO_MODE) { const s = await import("../demo/store"); return s.demoList(transitionId); }
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("work_items").select(COLS).eq("transition_id", transitionId).order("sort_order");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function updateWorkItem(id: string, patch: WorkItemPatch): Promise<WorkItem> {
  // A user-set due date is a manual override and is protected from methodology sync.
  if (Object.prototype.hasOwnProperty.call(patch, "due_date")) patch = { ...patch, due_date_source: "manual" };
  if (DEMO_MODE) { const s = await import("../demo/store"); return s.demoUpdate(id, patch); }
  if (!supabase) throw new Error("Backend not configured");
  const { data, error } = await supabase
    .from("work_items").update(patch).eq("id", id).select(COLS).single();
  if (error) throw error;
  return mapRow(data);
}
