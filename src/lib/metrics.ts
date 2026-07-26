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

// Highest-priority open items for a leadership "what's blocking progress" view:
// overdue and on the critical path or a go-live gate. Ranked by operational
// importance — items blocking both a gate and the critical path outrank
// items blocking only one — with due date (most overdue first) as the
// tiebreaker, not the primary sort. Non-mutating; tolerates missing/invalid
// due dates via isOverdue's own guard.
export function computePriorityItems(items: WorkItem[], limit = 5): WorkItem[] {
  const safeItems = Array.isArray(items) ? items : [];
  const severity = (w: WorkItem) => (w.criticalPath ? 1 : 0) + (w.goLiveGate ? 1 : 0);
  return safeItems
    .filter((w) => isOverdue(w) && (w.criticalPath === true || w.goLiveGate === true))
    .slice()
    .sort((a, b) => severity(b) - severity(a) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, limit);
}

export interface OwnerExposure {
  owner: string;
  overdueCount: number;
}

// Owners whose overdue load is a genuine pattern worth leadership attention —
// not a leaderboard of everyone with an open item. `minCount` filters out
// isolated one-offs; only owners at or above it are concentration, not noise.
// Sorted highest exposure first, capped at `limit`. Items with no owner are
// excluded — there's no one for leadership to check in with.
export function computeOwnerExposure(items: WorkItem[], minCount = 2, limit = 5): OwnerExposure[] {
  const safeItems = Array.isArray(items) ? items : [];
  const counts = new Map<string, number>();
  for (const w of safeItems) {
    if (!isOverdue(w)) continue;
    const owner = (w.owner ?? "").trim();
    if (!owner) continue;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([owner, overdueCount]) => ({ owner, overdueCount }))
    .filter((o) => o.overdueCount >= minCount)
    .sort((a, b) => b.overdueCount - a.overdueCount)
    .slice(0, limit);
}

// Workstreams with zero completion — real exposure, not every empty row.
// `minTotal` keeps a two-item workstream from reading as equivalent to a
// fifty-item one; both are "not started," but only one is actually a risk.
export function computeStalledWorkstreams(workstreams: WorkstreamProgress[], minTotal = 5, limit = 4): WorkstreamProgress[] {
  return workstreams
    .filter((w) => w.percent === 0 && w.total >= minTotal)
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
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
