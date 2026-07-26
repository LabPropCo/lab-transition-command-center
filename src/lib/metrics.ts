// Dashboard derived metrics. Pure functions only: every value here is computed
// fresh from WorkItem[] and never stored, so it can never drift from the work
// items themselves (see ARCHITECTURE.md §7). Inputs are never mutated.
import type { WorkItem } from "../work-items/types";

export interface GroupSummary {
  total: number;       // raw count in this group (all statuses, including Not Applicable)
  completed: number;   // status === "Complete"
  outstanding: number; // total - completed
  percent: number;     // completed / (total - notApplicable), 0 when the denominator is 0
}

export interface WorkstreamProgress extends GroupSummary {
  workstream: string; // "Unassigned" when the source item has no workstream
}

export interface DashboardMetrics {
  totalCount: number;
  completedCount: number;
  notApplicableCount: number;
  readinessPercent: number; // completedCount / (totalCount - notApplicableCount), 0-100
  overdueCount: number;
  goLiveGate: GroupSummary;
  criticalPath: GroupSummary;
  workstreams: WorkstreamProgress[];
}

const UNASSIGNED_WORKSTREAM = "Unassigned";

// completed / total, excluding Not Applicable items from the denominator (an
// N/A item can never become Complete, so it shouldn't depress readiness).
// Guards divide-by-zero; never throws.
function pct(completed: number, total: number, notApplicable: number): number {
  const denom = total - notApplicable;
  if (denom <= 0) return 0;
  return Math.round((completed / denom) * 100);
}

function summarize(items: WorkItem[]): GroupSummary {
  const total = items.length;
  let completed = 0;
  let notApplicable = 0;
  for (const w of items) {
    if (w.status === "Complete") completed++;
    else if (w.status === "Not Applicable") notApplicable++;
  }
  return { total, completed, outstanding: total - completed, percent: pct(completed, total, notApplicable) };
}

// Same overdue definition WorkItems.tsx uses: no due date, Complete, or Not
// Applicable items are never overdue. Tolerates a missing/invalid due date
// string without throwing.
export function isOverdue(w: WorkItem): boolean {
  if (!w.dueDate || w.status === "Complete" || w.status === "Not Applicable") return false;
  const due = new Date(w.dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return false; // unparsable due_date — treat as not overdue, never crash
  return due < new Date(new Date().toDateString());
}

const UNASSIGNED_PHASE = "Unassigned";

export interface PhaseMilestone extends GroupSummary {
  phase: string;
  phaseOrder: number;
  gateItems: WorkItem[]; // go-live-gate items in this phase — the milestone markers
}

// Groups by phase, ordered by phase_order (not first-seen order — a roadmap
// reads as a timeline, so the declared phase sequence matters more than
// insertion order). Items with no phase collect under "Unassigned" last.
export function computePhaseMilestones(items: WorkItem[]): PhaseMilestone[] {
  const safeItems = Array.isArray(items) ? items : [];
  const groups = new Map<string, { order: number; items: WorkItem[] }>();
  for (const w of safeItems) {
    const key = (w.phase ?? "").trim() || UNASSIGNED_PHASE;
    if (!groups.has(key)) groups.set(key, { order: w.phaseOrder ?? Number.MAX_SAFE_INTEGER, items: [] });
    groups.get(key)!.items.push(w);
  }
  return Array.from(groups.entries())
    .map(([phase, g]) => ({
      phase,
      phaseOrder: g.order,
      gateItems: g.items.filter((w) => w.goLiveGate === true),
      ...summarize(g.items),
    }))
    .sort((a, b) => a.phaseOrder - b.phaseOrder);
}

export function computeDashboardMetrics(items: WorkItem[]): DashboardMetrics {
  const safeItems = Array.isArray(items) ? items : [];

  const { total: totalCount, completed: completedCount, percent: readinessPercent } = summarize(safeItems);
  const notApplicableCount = safeItems.reduce((n, w) => n + (w.status === "Not Applicable" ? 1 : 0), 0);
  const overdueCount = safeItems.reduce((n, w) => n + (isOverdue(w) ? 1 : 0), 0);

  const goLiveGate = summarize(safeItems.filter((w) => w.goLiveGate === true));
  const criticalPath = summarize(safeItems.filter((w) => w.criticalPath === true));

  // Group by workstream, preserving first-seen order (items already arrive
  // sorted by sort_order from listWorkItems, so this reads top-to-bottom).
  const order: string[] = [];
  const groups = new Map<string, WorkItem[]>();
  for (const w of safeItems) {
    const key = (w.workstream ?? "").trim() || UNASSIGNED_WORKSTREAM;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(w);
  }
  const workstreams: WorkstreamProgress[] = order.map((workstream) => ({
    workstream,
    ...summarize(groups.get(workstream)!),
  }));

  return {
    totalCount,
    completedCount,
    notApplicableCount,
    readinessPercent,
    overdueCount,
    goLiveGate,
    criticalPath,
    workstreams,
  };
}
