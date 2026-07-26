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

// ---------------------------------------------------------------------------
// My Actions — a personal view of Master Work Items, not a parallel task
// system. Every function here reads existing fields only (owner, status,
// due_date, critical_path, go_live_gate); nothing is stored or invented.
// ---------------------------------------------------------------------------

// "Active" mirrors the definition already used everywhere else in this app
// (isOverdue's own exclusion, the Dashboard's supporting-evidence stats):
// everything except Complete and Not Applicable.
export function isActiveStatus(w: WorkItem): boolean {
  return w.status !== "Complete" && w.status !== "Not Applicable";
}

export function isBlocked(w: WorkItem): boolean {
  return w.status === "Blocked";
}

// Case-insensitive, whitespace-trimmed match against the owner text field —
// the only linkage that exists between an authenticated user and a work
// item today (see src/work-items/api.ts getCurrentUserDisplayName). An
// empty owner or empty display name never matches anything.
export function isAssignedTo(w: WorkItem, displayName: string): boolean {
  const owner = (w.owner ?? "").trim().toLowerCase();
  const me = displayName.trim().toLowerCase();
  return owner.length > 0 && me.length > 0 && owner === me;
}

// Days a due date has been in the past. Only meaningful for items isOverdue()
// has already confirmed are actually overdue.
function daysPastDue(dueDate: string): number {
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date(new Date().toDateString());
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

// The end of "this week," defined as the coming Sunday (a Monday-through-
// Sunday week) — if `today` already is Sunday, the week ends today. This is
// the one place that definition lives; change it here only.
function endOfWeek(today: Date): Date {
  const d = new Date(today);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d;
}

function isDueThisWeek(w: WorkItem, today: Date, weekEnd: Date): boolean {
  if (!w.dueDate) return false;
  const due = new Date(w.dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return false;
  return due >= today && due <= weekEnd;
}

const MY_ACTIONS_PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

// The residual sort within a My Actions section. Which of the seven
// sections an item lands in (see computeMyActions) already encodes
// go-live-gate / critical-path / blocked / executive-priority, so none of
// those need to be sort keys here — every item in a given section already
// ties on them. What's left to break ties: (1) most overdue, (2) earliest
// due date, (3) the priority field (sections other than Executive
// Attention Required can still mix Critical/High/Medium/Low), (4) title
// alphabetically, so the order is always fully deterministic.
function compareMyActions(a: WorkItem, b: WorkItem): number {
  const overdueA = isOverdue(a) && a.dueDate ? daysPastDue(a.dueDate) : 0;
  const overdueB = isOverdue(b) && b.dueDate ? daysPastDue(b.dueDate) : 0;
  if (overdueA !== overdueB) return overdueB - overdueA;

  // Items with no due date sort after every dated item within a section.
  const dueA = a.dueDate ?? "9999-99-99";
  const dueB = b.dueDate ?? "9999-99-99";
  if (dueA !== dueB) return dueA.localeCompare(dueB);

  const prA = MY_ACTIONS_PRIORITY_RANK[a.priority ?? ""] ?? 99;
  const prB = MY_ACTIONS_PRIORITY_RANK[b.priority ?? ""] ?? 99;
  if (prA !== prB) return prA - prB;

  return a.description.localeCompare(b.description);
}

export interface MyActionsCounts {
  overdue: number;
  dueThisWeek: number;
  criticalPath: number;
  blocked: number;
}

// Seven sections, in operational-importance order — not date order. Every
// active assigned item lands in exactly one, decided by the first test it
// matches, top to bottom: an item that's both Critical-priority and
// overdue shows up under Executive Attention Required, not Overdue,
// because that's the more useful place for it to surface. `counts` are
// each section's own length (not an independent re-filter), so a stat can
// never disagree with the section it scrolls to.
export interface MyActionsGroups {
  executiveAttention: WorkItem[]; // priority === "Critical"
  criticalPath: WorkItem[];       // critical_path, not already above
  goLiveGates: WorkItem[];        // go_live_gate, not already above
  blocked: WorkItem[];            // status === "Blocked", not already above
  overdue: WorkItem[];            // isOverdue(), not already above
  dueThisWeek: WorkItem[];        // due today through the end of this week, not already above
  everythingElse: WorkItem[];     // everything else active; items with no due date sort to the bottom
  counts: MyActionsCounts;
}

// Filters to active items assigned to `displayName`, buckets them by
// business impact, and sorts each bucket. `now` is only a parameter so
// this stays testable without mocking the system clock; real callers omit
// it.
export function computeMyActions(items: WorkItem[], displayName: string, now: Date = new Date()): MyActionsGroups {
  const safeItems = Array.isArray(items) ? items : [];
  const today = new Date(now.toDateString());
  const weekEnd = endOfWeek(today);

  const mine = safeItems.filter((w) => isActiveStatus(w) && isAssignedTo(w, displayName));

  const executiveAttention: WorkItem[] = [];
  const criticalPath: WorkItem[] = [];
  const goLiveGates: WorkItem[] = [];
  const blocked: WorkItem[] = [];
  const overdue: WorkItem[] = [];
  const dueThisWeek: WorkItem[] = [];
  const everythingElse: WorkItem[] = [];

  for (const w of mine) {
    if (w.priority === "Critical") executiveAttention.push(w);
    else if (w.criticalPath === true) criticalPath.push(w);
    else if (w.goLiveGate === true) goLiveGates.push(w);
    else if (isBlocked(w)) blocked.push(w);
    else if (isOverdue(w)) overdue.push(w);
    else if (isDueThisWeek(w, today, weekEnd)) dueThisWeek.push(w);
    else everythingElse.push(w);
  }

  [executiveAttention, criticalPath, goLiveGates, blocked, overdue, dueThisWeek, everythingElse]
    .forEach((section) => section.sort(compareMyActions));

  return {
    executiveAttention,
    criticalPath,
    goLiveGates,
    blocked,
    overdue,
    dueThisWeek,
    everythingElse,
    counts: {
      overdue: overdue.length,
      dueThisWeek: dueThisWeek.length,
      criticalPath: criticalPath.length,
      blocked: blocked.length,
    },
  };
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
