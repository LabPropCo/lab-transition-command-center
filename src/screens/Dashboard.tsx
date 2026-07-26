import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems } from "../work-items/api";
import type { WorkItem } from "../work-items/types";
import { SCREENS } from "../lib/nav";
import {
  computeDashboardMetrics,
  computePriorityItems,
  computeOwnerExposure,
  computeStalledWorkstreams,
  computeUpcomingMilestones,
  computeRecentProgress,
  isOverdue,
} from "../lib/metrics";
import "../styles/dashboard.css";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(new Date().toDateString());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// How many days an already-overdue item has been overdue. Only ever called on
// items isOverdue() has already confirmed have a valid, past due date.
function daysOverdue(iso: string): number {
  const due = new Date(iso + "T00:00:00");
  const today = new Date(new Date().toDateString());
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// A self-contained figure + label, never a fragment: whatever the sign of
// `d`, the pairing always reads as a complete statement on its own.
function goLiveCountdown(d: number): { value: number; label: string } {
  if (d > 0) return { value: d, label: d === 1 ? "Day until go-live" : "Days until go-live" };
  if (d === 0) return { value: 0, label: "Go-live is today" };
  const since = Math.abs(d);
  return { value: since, label: since === 1 ? "Day since go-live" : "Days since go-live" };
}

// Why a blocked item matters, from fields that already exist on it — never a
// fabricated priority score.
function stakes(w: WorkItem): string {
  if (w.criticalPath && w.goLiveGate) return "Critical path · Go-live gate";
  return w.criticalPath ? "Critical path" : "Go-live gate";
}

// An objective fill state from percent alone — never a risk judgment. "Not
// started" and "Complete" are facts; nothing here asserts whether that's on
// schedule.
function fillGlyph(percent: number): string {
  if (percent >= 100) return "●";
  if (percent <= 0) return "○";
  return "◐";
}
function fillState(percent: number): string {
  if (percent >= 100) return "Complete";
  if (percent <= 0) return "Not started";
  return "In progress";
}

// Spells small integers for the one prose sentence on the page — numerals
// stay everywhere else.
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
  return String(n); // beyond realistic scale for this app — fall back rather than guess
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function Dashboard() {
  const { selected, propertyFilter } = useTransition();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!selected) { setItems([]); setLoading(false); return; }
    let active = true;
    setLoading(true); setErr("");
    listWorkItems(selected.id)
      .then((rows) => { if (active) { setItems(rows); setLoading(false); } })
      .catch((e) => { if (active) { setErr(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { active = false; };
  }, [selected]);

  // Same property-scope semantics as the Work Items screen: "all" = every
  // item, "shared" = transition-level only, else a specific property id.
  const scoped = useMemo(() => items.filter((w) => {
    if (propertyFilter === "shared") return w.scopeType === "transition";
    if (propertyFilter !== "all") return w.propertyId === propertyFilter;
    return true;
  }), [items, propertyFilter]);

  const metrics = useMemo(() => computeDashboardMetrics(scoped), [scoped]);
  const priorityItems = useMemo(() => computePriorityItems(scoped, 5), [scoped]);
  const totalBlockers = useMemo(
    () => scoped.filter((w) => isOverdue(w) && (w.criticalPath === true || w.goLiveGate === true)).length,
    [scoped],
  );
  const ownerExposure = useMemo(() => computeOwnerExposure(scoped), [scoped]);
  const stalledWorkstreams = useMemo(() => computeStalledWorkstreams(metrics.workstreams), [metrics]);
  const upcomingMilestones = useMemo(() => computeUpcomingMilestones(scoped), [scoped]);
  const recentProgress = useMemo(() => computeRecentProgress(scoped), [scoped]);

  const goLiveDays = selected ? daysUntil(selected.targetGoLive) : null;
  const countdown = goLiveDays !== null ? goLiveCountdown(goLiveDays) : null;
  const ready = !loading && !err && metrics.totalCount > 0;
  const maxExposure = ownerExposure[0]?.overdueCount ?? 0;
  const completeDenominator = metrics.totalCount - metrics.notApplicableCount;

  // The one sentence leadership needs before the meeting — now standing in
  // for the standalone concept's fabricated "At Risk" verdict inside the
  // readiness panel. Picks the single most operationally significant true
  // pattern already computed above; never a fixed template, never a
  // judgment the data can't support.
  const focus = useMemo(() => {
    if (!ready) return null;
    const topOwner = ownerExposure[0];
    const secondOwner = ownerExposure[1];
    if (topOwner) {
      // Only name one owner when they clearly lead the pack — a 12-vs-10
      // split is still concentration, but it's shared, not one person's.
      const topIsDominant = !secondOwner || topOwner.overdueCount >= secondOwner.overdueCount * 1.5;
      if (topIsDominant) {
        return `${cap(numberToWords(topOwner.overdueCount))} overdue item${topOwner.overdueCount === 1 ? "" : "s"} ${topOwner.overdueCount === 1 ? "is" : "are"} concentrated with ${topOwner.owner}.`;
      }
      const combined = topOwner.overdueCount + secondOwner.overdueCount;
      return `${cap(numberToWords(combined))} overdue items are concentrated with ${topOwner.owner} and ${secondOwner.owner}.`;
    }
    if (stalledWorkstreams.length > 0) {
      const names = stalledWorkstreams.map((w) => w.workstream).join(" and ");
      const runway = goLiveDays !== null && goLiveDays > 0 ? ` with ${goLiveDays} day${goLiveDays === 1 ? "" : "s"} remaining` : "";
      return `${cap(numberToWords(stalledWorkstreams.length))} workstream${stalledWorkstreams.length === 1 ? "" : "s"} — ${names} — ${stalledWorkstreams.length === 1 ? "has" : "have"} not started${runway}.`;
    }
    if (metrics.overdueCount > 0) {
      return `${cap(numberToWords(metrics.overdueCount))} item${metrics.overdueCount === 1 ? "" : "s"} ${metrics.overdueCount === 1 ? "is" : "are"} overdue across the critical path and go-live gates.`;
    }
    return `${metrics.readinessPercent}% complete${goLiveDays !== null && goLiveDays > 0 ? ` with ${goLiveDays} day${goLiveDays === 1 ? "" : "s"} remaining` : ""}.`;
  }, [ready, ownerExposure, stalledWorkstreams, metrics, goLiveDays]);

  const goLiveDate = selected ? formatDate(selected.targetGoLive) : null;

  return (
    <section className="screen dash">
      <div className="dash__hero">
        <p className="dash__eyebrow">{selected?.name ?? "Leadership Brief"}</p>
        <h1 className="dash__title">{SCREENS.dashboard.title}.</h1>
        <p className="dash__deck">{SCREENS.dashboard.deck}</p>

        {selected && (goLiveDate || selected.transitionManager) && (
          <div className="dash__metarow">
            {goLiveDate && (
              <span className="dash__metaitem"><span className="dash__metalabel">Go-live</span> {goLiveDate}</span>
            )}
            {selected.transitionManager && (
              <span className="dash__metaitem"><span className="dash__metalabel">Lead</span> {selected.transitionManager}</span>
            )}
          </div>
        )}
      </div>

      {err && <p className="dash__err">{err}</p>}
      {loading && !err && <p className="dash__loading">Loading…</p>}

      {!loading && !err && metrics.totalCount === 0 && (
        <div className="dash__empty">
          <div className="dash__empty-head">No work items yet</div>
          <p className="dash__empty-body">
            {selected
              ? "This transition hasn't been provisioned with work items yet, or none match the current property filter."
              : "Select a transition to see its brief."}
          </p>
        </div>
      )}

      {ready && (
        <div className="dash__body">
          <div className="dash__statcluster">
            {countdown && (
              <div className="dash__statcol">
                <div className="dash__countdown-value">{countdown.value}</div>
                <div className="dash__countdown-label">{countdown.label}</div>
                {goLiveDate && <div className="dash__countdown-date">{goLiveDate}</div>}
              </div>
            )}

            <div className="dash__statcol">
              <div className="dash__eyebrow-label">Overall completion</div>
              <div className="dash__completion-value">{metrics.readinessPercent}%</div>
              <div className="dash__completion-sub">{metrics.completedCount} of {completeDenominator} complete</div>
            </div>

            <div className="dash__readiness">
              <div className="dash__eyebrow-label dash__eyebrow-label--inverse">Go-live readiness</div>
              <div className="dash__readiness-value">{metrics.goLiveGate.percent}%</div>
              {focus && <p className="dash__readiness-focus">{focus}</p>}
              {metrics.workstreams.length > 0 && (
                <div className="dash__chiplist">
                  {metrics.workstreams.map((w) => (
                    <span className="dash__chip" key={w.workstream}>{w.workstream}</span>
                  ))}
                </div>
              )}
              <div className="dash__blockercount">{totalBlockers} remaining blocker{totalBlockers === 1 ? "" : "s"}</div>
            </div>
          </div>

          <p className="dash__legend">
            <strong>Critical path</strong> — delays dependent work &nbsp;·&nbsp; <strong>Go-live gate</strong> — must be complete before day one
          </p>

          <section className="dash__block">
            <h2 className="dash__block-title">Workstream progress</h2>
            <div className="dash__wslist">
              {metrics.workstreams.map((w) => (
                <div className="dash__wsrow" key={w.workstream}>
                  <span className="dash__wsname">{w.workstream}</span>
                  <span className="dash__wspercent">{w.percent}%</span>
                  <span className="dash__wsglyph" aria-hidden>{fillGlyph(w.percent)}</span>
                  <span className="dash__wsstate">{fillState(w.percent)}</span>
                  <span className="dash__wsfraction">{w.completed}/{w.total}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="dash__block">
            <h2 className="dash__block-title">Critical blockers to go-live</h2>
            {priorityItems.length === 0 ? (
              <p className="dash__quiet">No critical-path or go-live-gate tasks are blocked or overdue.</p>
            ) : (
              <ol className="dash__list">
                {priorityItems.map((w) => {
                  const overdue = w.dueDate ? daysOverdue(w.dueDate) : null;
                  return (
                    <li className="dash__row" key={w.id}>
                      <span className="dash__row-desc">{w.description}</span>
                      <span className="dash__row-meta">
                        {stakes(w)} · {w.owner ?? "Unassigned"} · {overdue !== null ? `${overdue} day${overdue === 1 ? "" : "s"} overdue` : "overdue"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {ownerExposure.length > 0 && (
            <section className="dash__block">
              <h2 className="dash__block-title">Where help is needed</h2>
              <div className="dash__ownerlist">
                {ownerExposure.map((o) => (
                  <div className="dash__ownerrow" key={o.owner}>
                    <span className="dash__ownername">{o.owner}</span>
                    <div className="dash__ownertrack">
                      <div className="dash__ownerfill" style={{ width: `${(o.overdueCount / maxExposure) * 100}%` }} />
                    </div>
                    <span className="dash__ownercount">{o.overdueCount} overdue</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {upcomingMilestones.length > 0 && (
            <section className="dash__block">
              <h2 className="dash__block-title">Upcoming milestones</h2>
              <ol className="dash__list">
                {upcomingMilestones.map((w) => {
                  const inDays = w.dueDate ? daysUntil(w.dueDate) : null;
                  return (
                    <li className="dash__row" key={w.id}>
                      <span className="dash__row-desc">{w.description}</span>
                      <span className="dash__row-meta">
                        {inDays !== null ? (inDays === 0 ? "Due today" : `In ${inDays}d`) : ""} · {w.owner ?? "Unassigned"} · {formatDate(w.dueDate)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {recentProgress.items.length > 0 && (
            <section className="dash__block">
              <h2 className="dash__block-title">Recent momentum</h2>
              <ol className="dash__momentum-list">
                {recentProgress.items.map((w) => (
                  <li className="dash__momentum-item" key={w.id}>
                    <span className="dash__momentum-mark" aria-hidden>◆</span>
                    {w.owner ? <>{w.owner} completed </> : "Completed "}
                    <span className="dash__momentum-desc">{w.description}</span>
                    {w.completedAt && <span className="dash__momentum-date"> · {formatDate(w.completedAt.slice(0, 10))}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
