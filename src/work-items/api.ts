import { supabase } from "../lib/supabase";
import type { WorkItem, WorkItemPatch } from "./types";
import type { WorkOwner } from "../types";
import { DEMO_MODE } from "../demo/config";

const COLS =
  "id,transition_id,property_id,scope_type,code,sort_order,phase,phase_order,workstream,sub_workstream," +
  "description,completion_standard,owner,responsible_party,priority,go_live_gate,critical_path,stage," +
  "gate_group,depends_on_code,start_date,due_date,status,notes,dropbox_link,completed_at,updated_at,updated_by," +
  "property_active";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): WorkItem {
  return {
    id: r.id, transitionId: r.transition_id, propertyId: r.property_id, propertyActive: r.property_active ?? true,
    scopeType: r.scope_type,
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
// Reads from the work_items_with_property_status view (0021), which left-joins
// properties and exposes property_active (always true for shared/transition-
// scoped items, since property_id is null there). Default (no opts, or
// excludeInactiveProperties omitted/false) returns every row, unchanged from
// before this view existed — Dashboard, Roadmap, and any future caller keep
// seeing the complete data set unless they explicitly opt in to hiding
// inactive-property rows. Only Master Work Items passes excludeInactiveProperties,
// gated behind its own "Show inactive properties" toggle.
export async function listWorkItems(
  transitionId: string,
  opts?: { excludeInactiveProperties?: boolean },
): Promise<WorkItem[]> {
  if (DEMO_MODE) {
    const s = await import("../demo/store");
    return s.demoList(transitionId, opts?.excludeInactiveProperties ?? false);
  }
  if (!supabase) return [];
  let query = supabase
    .from("work_items_with_property_status")
    .select(COLS)
    .eq("transition_id", transitionId);
  if (opts?.excludeInactiveProperties) query = query.eq("property_active", true);
  const { data, error } = await query.order("sort_order");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

// Work items across every listed transition, in one round trip — for My
// Actions, which (per its own header) aggregates "across active
// transitions" rather than the single currently-selected one every other
// screen uses. RLS (can_access_work_item) still applies per row, so this
// only ever returns items the caller could already see one transition at a
// time; it's a convenience for fetching them together, not a wider grant.
export async function listWorkItemsForTransitions(transitionIds: string[]): Promise<WorkItem[]> {
  if (transitionIds.length === 0) return [];
  if (DEMO_MODE) {
    const s = await import("../demo/store");
    const lists = await Promise.all(transitionIds.map((id) => s.demoList(id)));
    return lists.flat();
  }
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("work_items").select(COLS).in("transition_id", transitionIds).order("sort_order");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

// The exact string My Actions must match against `work_items.owner` to find
// "my" items. Calls the same server-side function
// (current_user_display = coalesce(profiles.full_name, profiles.email))
// migration 0011 uses to default a new item's owner — so the client's
// matching logic can never drift from what the server would have assigned.
// Returns null if there's no profile row / no auth context; callers should
// treat that as "nothing can be matched," not as an error.
export async function getCurrentUserDisplayName(): Promise<string | null> {
  if (DEMO_MODE) {
    const s = await import("../demo/store");
    return s.demoOwners().find((o) => o.active)?.displayName ?? null;
  }
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("current_user_display");
  if (error) throw error;
  return (data as string | null) ?? null;
}

// Active owners for the Owner dropdown (Work Items + Methodology templates).
// Readable by any authenticated user (RLS: work_owners_read, 0015).
export async function listActiveOwners(): Promise<WorkOwner[]> {
  if (DEMO_MODE) { const s = await import("../demo/store"); return s.demoOwners().filter((o) => o.active); }
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("work_owners").select("id,display_name,active,sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });
  if (error) throw error;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => ({ id: r.id, displayName: r.display_name, active: r.active, sortOrder: r.sort_order }));
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
