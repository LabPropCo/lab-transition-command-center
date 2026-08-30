// The Lab's executive-assessment engine. Turns raw transition data into the
// briefing a chief of staff would hand an executive before a meeting: a
// derived status, an executive-voice narrative, and a recommended focus —
// every word traceable back to a real, computed fact, never fabricated and
// never manually selected.
//
// This module is intentionally decoupled from the Dashboard screen and from
// React: it takes plain data in and returns plain data out. That's so the
// same engine can eventually summarize a Property Dashboard, a Portfolio
// Dashboard, or a weekly executive report — anywhere a transition (or a
// portfolio of them) needs to be turned into an executive-ready assessment,
// not just this one screen.
import type { WorkItem } from "../work-items/types";
import { isOverdue, type DashboardMetrics, type OwnerExposure, type WorkstreamProgress } from "./metrics";

export type AssessmentStatus = "On Track" | "Needs Attention" | "At Risk" | "Critical";

export interface ContributingFactor {
  text: string;
  positive: boolean; // true = reassuring (a future ✓), false = a concern (a future ⚠)
}

export interface ExecutiveAssessment {
  status: AssessmentStatus;
  narrative: string;               // the full briefing paragraph, ready to render as-is
  recommendedFocus: string | null; // isolated from the narrative for future standalone use
  factors: ContributingFactor[];   // real, structured — computed now, not yet rendered anywhere
  confidence: number;              // 0-100: how complete the underlying data is, not a prediction
  blockingOverdueCount: number;    // the primary driver behind `status`
}

export interface AssessmentInput {
  items: WorkItem[];
  metrics: DashboardMetrics;
  ownerExposure: OwnerExposure[];
  stalledWorkstreams: WorkstreamProgress[];
  goLiveDays: number | null;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function numberToWords(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return String(n);
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return TENS[tens] + (ones ? "-" + ONES[ones] : "");
  }
  return String(n); // beyond realistic scale for a single transition — fall back rather than guess
}
// How much of the data this assessment depends on is actually present. This
// is NOT a predictive confidence — there's no historical accuracy record to
// calibrate one against. It's a plain completeness measure: an assessment
// built on a transition with no target date and half its items unassigned
// deserves less trust than one where the underlying data is all there.
function computeConfidence(items: WorkItem[], goLiveDays: number | null): number {
  let score = 100;
  if (goLiveDays === null) score -= 30;
  if (items.length > 0) {
    const dueDateCoverage = items.filter((w) => w.dueDate).length / items.length;
    score -= Math.round((1 - dueDateCoverage) * 30);
    const ownerCoverage = items.filter((w) => (w.owner ?? "").trim()).length / items.length;
    score -= Math.round((1 - ownerCoverage) * 20);
  }
  return Math.max(0, Math.min(100, score));
}

// The recommended-focus clause: who (or what) leadership should look at this
// week, and why — isolated so a future screen could render it on its own.
// Owner concentration takes priority over stalled workstreams as a focus,
// since a specific person is more actionable than a whole workstream.
function buildRecommendedFocus(
  status: AssessmentStatus,
  ownerExposure: OwnerExposure[],
  totalOverdue: number,
  stalledWorkstreams: WorkstreamProgress[],
): string | null {
  const topOwner = ownerExposure[0];
  const secondOwner = ownerExposure[1];

  // "Require(s) immediate attention" needs subject-verb agreement with
  // whatever names precede it; the two "should be" phrasings are modal and
  // agreement-free regardless of a singular or plural subject.
  const urgencyClause = (plural: boolean): string => {
    if (status === "Critical") return plural ? "require immediate attention" : "requires immediate attention";
    if (status === "At Risk") return "should be the primary focus over the coming week";
    return "should be checked in with this week";
  };

  if (topOwner) {
    // Same "clearly leads the pack" test used to decide whether to name one
    // owner or two — a shared concentration shouldn't single one person out.
    const shareWithSecond = Boolean(secondOwner && topOwner.overdueCount < secondOwner.overdueCount * 1.5);
    const names = shareWithSecond ? `${topOwner.owner} and ${secondOwner!.owner}` : topOwner.owner;
    const relevantCount = shareWithSecond ? topOwner.overdueCount + secondOwner!.overdueCount : topOwner.overdueCount;
    const share = totalOverdue > 0 ? relevantCount / totalOverdue : 0;

    const verb = shareWithSecond ? "own" : "owns";
    const ownershipClause = share > 0.5
      ? `${verb} the majority of overdue work`
      : share > 0.25
        ? `${verb} a significant share of overdue work`
        : `${shareWithSecond ? "carry" : "carries"} ${relevantCount} overdue item${relevantCount === 1 ? "" : "s"}`;

    return `${names} currently ${ownershipClause} and ${urgencyClause(shareWithSecond)}.`;
  }

  if (stalledWorkstreams.length > 0) {
    const names = stalledWorkstreams.map((w) => w.workstream).join(" and ");
    const verb = stalledWorkstreams.length === 1 ? "has" : "have";
    return `${names} ${verb} not started and ${urgencyClause(stalledWorkstreams.length > 1)}.`;
  }

  return null;
}

// Generates the full executive assessment. Never manually selected, never
// based primarily on overall percent complete — critical-path and go-live-
// gate overdue counts, owner concentration, and runway drive the status;
// percent complete isn't a factor at all (it's an unweighted count across
// every item regardless of importance — see the "Complete" stat's own
// naming history — not a reliable readiness signal).
//
// The status model is a plain, explainable escalation, not a black-box
// weighted score: a base severity from blocking overdue work and owner
// concentration, which time pressure can only push up, never down.
export function generateExecutiveAssessment(input: AssessmentInput): ExecutiveAssessment {
  const { items, metrics, ownerExposure, stalledWorkstreams, goLiveDays } = input;
  const safeItems = Array.isArray(items) ? items : [];

  const overdueCritical = safeItems.filter((w) => isOverdue(w) && w.criticalPath === true).length;
  const overdueGates = safeItems.filter((w) => isOverdue(w) && w.goLiveGate === true).length;
  const blockingOverdueCount = safeItems.filter((w) => isOverdue(w) && (w.criticalPath === true || w.goLiveGate === true)).length;

  const topOwner = ownerExposure[0];
  const severeConcentration = (topOwner?.overdueCount ?? 0) >= 5;
  const gatesRemaining = metrics.goLiveGate.total - metrics.goLiveGate.completed;

  let status: AssessmentStatus;
  if (blockingOverdueCount === 0) {
    status = "On Track";
  } else if (blockingOverdueCount <= 3 && !severeConcentration) {
    status = "Needs Attention";
  } else {
    status = "At Risk";
  }

  // Time pressure only escalates — it never pulls a status back down.
  const outOfRunway = goLiveDays !== null && goLiveDays <= 0 && gatesRemaining > 0;
  const criticallyTight = goLiveDays !== null && goLiveDays > 0 && goLiveDays <= 7 && gatesRemaining > 0;
  if (outOfRunway || blockingOverdueCount >= 10) {
    status = "Critical";
  } else if (criticallyTight && status !== "On Track") {
    status = "Critical";
  } else if (criticallyTight && gatesRemaining > 0) {
    status = "At Risk";
  }

  const recommendedFocus = buildRecommendedFocus(status, ownerExposure, metrics.overdueCount, stalledWorkstreams);

  let lead: string;
  switch (status) {
    case "On Track":
      lead = "The transition remains firmly on track, with no critical-path or go-live-gate items overdue.";
      break;
    case "Needs Attention":
      lead = `The planned go-live remains on track, though ${numberToWords(blockingOverdueCount)} critical-path or go-live-gate item${blockingOverdueCount === 1 ? "" : "s"} now ${blockingOverdueCount === 1 ? "requires" : "require"} attention.`;
      break;
    case "At Risk":
      lead = `The planned go-live remains achievable; however, ${numberToWords(blockingOverdueCount)} overdue critical-path and go-live-gate item${blockingOverdueCount === 1 ? "" : "s"} now ${blockingOverdueCount === 1 ? "requires" : "require"} immediate attention.`;
      break;
    case "Critical":
      lead = `The planned go-live is unlikely to be achieved without executive intervention${goLiveDays !== null && goLiveDays > 0 ? `, with only ${goLiveDays} day${goLiveDays === 1 ? "" : "s"} remaining` : ""}.`;
      break;
  }

  const narrative = recommendedFocus ? `${lead} ${recommendedFocus}` : lead;

  const factors: ContributingFactor[] = [];
  factors.push(overdueCritical === 0
    ? { text: "No critical-path items overdue", positive: true }
    : { text: `${overdueCritical} critical-path item${overdueCritical === 1 ? "" : "s"} overdue`, positive: false });
  factors.push(overdueGates === 0
    ? { text: "No go-live gates overdue", positive: true }
    : { text: `${overdueGates} go-live gate${overdueGates === 1 ? "" : "s"} overdue`, positive: false });
  factors.push({ text: `${metrics.goLiveGate.completed}/${metrics.goLiveGate.total} go-live gates complete`, positive: gatesRemaining === 0 });
  if (topOwner) {
    factors.push({ text: `${topOwner.owner} owns ${topOwner.overdueCount} overdue item${topOwner.overdueCount === 1 ? "" : "s"}`, positive: !severeConcentration });
  }
  if (goLiveDays !== null) {
    factors.push({ text: `${Math.max(goLiveDays, 0)} day${Math.abs(goLiveDays) === 1 ? "" : "s"} remaining until go-live`, positive: !criticallyTight && !outOfRunway });
  }

  return {
    status,
    narrative,
    recommendedFocus,
    factors,
    confidence: computeConfidence(safeItems, goLiveDays),
    blockingOverdueCount,
  };
}
