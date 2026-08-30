// In-memory demo store (loaded only via dynamic import from DEMO_MODE branches,
// so it never enters production bundles). Edits are session-only.
import { DEMO_TRANSITION, DEMO_PROPERTIES, DEMO_WORK_ITEMS, DEMO_OWNERS } from "./fixtures";
import type { WorkItem, WorkItemPatch } from "../work-items/types";
import type { Transition, Property, WorkOwner } from "../types";
import type { TransitionSettingsPatch } from "../admin/api";

const items: Omit<WorkItem, "propertyActive" | "archivedAt">[] = DEMO_WORK_ITEMS.map((w) => ({ ...w }));
// Mutable so Transition Settings edits genuinely persist for the session
// (mirrors `items` above) instead of silently no-opping. Resets on a full
// reload, same as every other demo-store record — no browser storage.
let transitionRecord: Transition = { ...DEMO_TRANSITION };

export function demoTransitions(): Transition[] { return [{ ...transitionRecord }]; }
export function demoUpdateTransition(patch: TransitionSettingsPatch): Transition {
  const next: Transition = { ...transitionRecord };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.company_name !== undefined) next.companyName = patch.company_name;
  if (patch.target_go_live_date !== undefined) next.targetGoLive = patch.target_go_live_date;
  if (patch.overall_status !== undefined) next.overallStatus = patch.overall_status;
  if (patch.current_phase !== undefined) next.currentPhase = patch.current_phase;
  if (patch.community_director_id !== undefined) next.communityDirectorId = patch.community_director_id;
  if (patch.community_director_name !== undefined) next.communityDirectorName = patch.community_director_name;
  if (patch.transition_manager !== undefined) next.transitionManager = patch.transition_manager;
  if (patch.regional_manager !== undefined) next.regionalManager = patch.regional_manager;
  if (patch.default_property_id !== undefined) next.defaultPropertyId = patch.default_property_id;
  if (patch.primary_color !== undefined) next.primaryColor = patch.primary_color;
  if (patch.secondary_color !== undefined) next.secondaryColor = patch.secondary_color;
  if (patch.logo_url !== undefined) next.logoUrl = patch.logo_url;
  if (patch.notes !== undefined) next.notes = patch.notes;
  transitionRecord = next;
  return { ...next };
}
export function demoProperties(transitionId: string): Property[] {
  return DEMO_PROPERTIES.filter((p) => p.transitionId === transitionId);
}
export function demoOwners(): WorkOwner[] { return DEMO_OWNERS.map((o) => ({ ...o })); }
// Demo mode has no archived-work-item concept (no fixture models it), so
// includeArchived is accepted for signature parity but never changes results —
// every demo item's archivedAt is always null.
export function demoList(transitionId: string, excludeInactiveProperties = false, _includeArchived = false): WorkItem[] {
  const inactivePropertyIds = new Set(DEMO_PROPERTIES.filter((p) => !p.active).map((p) => p.id));
  return items
    .filter((w) => w.transitionId === transitionId)
    .filter((w) => !excludeInactiveProperties || w.propertyId === null || !inactivePropertyIds.has(w.propertyId))
    .map((w) => ({ ...w, propertyActive: w.propertyId === null || !inactivePropertyIds.has(w.propertyId), archivedAt: null }));
}
export function demoUpdate(id: string, patch: WorkItemPatch): WorkItem {
  const idx = items.findIndex((w) => w.id === id);
  if (idx < 0) throw new Error("Demo item not found");
  const cur = items[idx];
  const next: Omit<WorkItem, "propertyActive" | "archivedAt"> = { ...cur };
  if (patch.status !== undefined) {
    next.status = patch.status;
    if (patch.status === "Complete" && cur.status !== "Complete") next.completedAt = new Date().toISOString();
    else if (patch.status !== "Complete") next.completedAt = null;
  }
  if (patch.owner !== undefined) next.owner = patch.owner;
  if (patch.responsible_party !== undefined) next.responsibleParty = patch.responsible_party;
  if (patch.due_date !== undefined) next.dueDate = patch.due_date;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.dropbox_link !== undefined) next.dropboxLink = patch.dropbox_link;
  next.updatedAt = new Date().toISOString();
  items[idx] = next;
  const inactivePropertyIds = new Set(DEMO_PROPERTIES.filter((p) => !p.active).map((p) => p.id));
  return { ...next, propertyActive: next.propertyId === null || !inactivePropertyIds.has(next.propertyId), archivedAt: null };
}
