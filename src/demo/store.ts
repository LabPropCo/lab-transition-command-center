// In-memory demo store (loaded only via dynamic import from DEMO_MODE branches,
// so it never enters production bundles). Edits are session-only.
import { DEMO_TRANSITION, DEMO_PROPERTIES, DEMO_WORK_ITEMS } from "./fixtures";
import type { WorkItem, WorkItemPatch } from "../work-items/types";
import type { Transition, Property } from "../types";

const items: WorkItem[] = DEMO_WORK_ITEMS.map((w) => ({ ...w }));

export function demoTransitions(): Transition[] { return [DEMO_TRANSITION]; }
export function demoProperties(transitionId: string): Property[] {
  return DEMO_PROPERTIES.filter((p) => p.transitionId === transitionId);
}
export function demoList(transitionId: string): WorkItem[] {
  return items.filter((w) => w.transitionId === transitionId).map((w) => ({ ...w }));
}
export function demoUpdate(id: string, patch: WorkItemPatch): WorkItem {
  const idx = items.findIndex((w) => w.id === id);
  if (idx < 0) throw new Error("Demo item not found");
  const cur = items[idx];
  const next: WorkItem = { ...cur };
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
  return { ...next };
}
