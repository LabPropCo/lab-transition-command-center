import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems } from "../work-items/api";
import type { WorkItem } from "../work-items/types";
import { computeDashboardMetrics, computePriorityItems, computeRecentProgress } from "../lib/metrics";
import "../styles/dashboard.css";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(new Date().toDateString());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// Spells out small integers for prose sentences (an executive briefing reads
// as written, not tabulated — numerals stay in the stat strip and lists).
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
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return ONES[hundreds] + " hundred" + (rest ? " " + numberToWords(rest) : "");
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
  const priorityItems = useMemo(() => computePriorityItems(scoped), [scoped]);
  const recentProgress = useMemo(() => computeRecentProgress(scoped), [scoped]);

  const goLiveDays = selected ? daysUntil(selected.targetGoLive) : null;

  // An evidence-only briefing: every sentence is one computed fact, stated
  // plainly. No status word, no judgment — the reader draws their own
  // conclusion from the numbers, the same way the app would.
  const narrative = useMemo(() => {
    if (!selected || metrics.totalCount === 0) return null;
    const sentences: string[] = [];
    sentences.push(`${metrics.readinessPercent}% of work items are complete.`);
    sentences.push(
      `${cap(numberToWords(metrics.goLiveGate.completed))} of ${numberToWords(metrics.goLiveGate.total)} go-live gates ` +
      `${metrics.goLiveGate.completed === 1 ? "has" : "have"} been completed.`,
    );
    sentences.push(
      `${cap(numberToWords(metrics.criticalPath.completed))} of ${numberToWords(metrics.criticalPath.total)} critical-path items ` +
      `${metrics.criticalPath.completed === 1 ? "has" : "have"} been completed.`,
    );
    sentences.push(
      metrics.overdueCount > 0
        ? `${cap(numberToWords(metrics.overdueCount))} work item${metrics.overdueCount === 1 ? "" : "s"} ${metrics.overdueCount === 1 ? "is" : "are"} overdue.`
        : "No work items are overdue.",
    );
    sentences.push(
      recentProgress.count > 0
        ? `Recent activity shows ${numberToWords(recentProgress.count)} completed work item${recentProgress.count === 1 ? "" : "s"} during the past two weeks.`
        : "No work items have been completed in the past two weeks.",
    );
    return sentences.join(" ");
  }, [selected, metrics, recentProgress]);

  return (
    <section className="screen dash">
      <div className="dash__hero">
        <h1 className="dash__title">{selected?.name ?? "Dashboard"}</h1>
        {(selected?.currentPhase || goLiveDays !== null) && (
          <p className="dash__meta">
            {selected?.currentPhase}
            {selected?.currentPhase && goLiveDays !== null && " · "}
            {goLiveDays !== null && `${goLiveDays >= 0 ? goLiveDays : 0} day${goLiveDays === 1 ? "" : "s"} until go-live`}
          </p>
        )}

        {narrative && (
          <div className="dash__summary">
            <h2 className="dash__summary-label">Executive Summary</h2>
            <p className="dash__narrative">{narrative}</p>
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
              : "Select a transition to see its dashboard."}
          </p>
        </div>
      )}

      {!loading && !err && metrics.totalCount > 0 && (
        <div className="dash__body">
          <div className="dash__stats">
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.readinessPercent}%</div>
              <div className="dash__stat-label">Ready</div>
            </div>
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.goLiveGate.completed}/{metrics.goLiveGate.total}</div>
              <div className="dash__stat-label">Go-live gates</div>
            </div>
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.criticalPath.completed}/{metrics.criticalPath.total}</div>
              <div className="dash__stat-label">Critical path</div>
            </div>
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.overdueCount}</div>
              <div className="dash__stat-label">Overdue</div>
            </div>
          </div>

          <div className="dash__pair">
            <section className="dash__block">
              <h2 className="dash__block-title dash__block-title--attention">Needs attention</h2>
              {priorityItems.length === 0 ? (
                <p className="dash__quiet">Nothing overdue on the critical path or a go-live gate.</p>
              ) : (
                <ol className="dash__list">
                  {priorityItems.map((w) => (
                    <li className="dash__row" key={w.id}>
                      <span className="dash__row-code">{w.code}</span>
                      <span className="dash__row-desc">{w.description}</span>
                      <span className="dash__row-meta">{w.dueDate} · overdue</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="dash__block">
              <h2 className="dash__block-title dash__block-title--progress">Recent progress</h2>
              {recentProgress.items.length === 0 ? (
                <p className="dash__quiet">Nothing completed in the last two weeks.</p>
              ) : (
                <ol className="dash__list">
                  {recentProgress.items.map((w) => (
                    <li className="dash__row" key={w.id}>
                      <span className="dash__row-code">{w.code}</span>
                      <span className="dash__row-desc">{w.description}</span>
                      <span className="dash__row-meta">{w.completedAt?.slice(0, 10)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section className="dash__block dash__block--quiet">
            <h2 className="dash__block-title">Workstream detail</h2>
            <div className="dash__wslist">
              {metrics.workstreams.map((w) => (
                <div className="dash__wsrow" key={w.workstream}>
                  <div className="dash__wshead">
                    <span className="dash__wsname">{w.workstream}</span>
                    <span className="dash__wscount">{w.completed} / {w.total} · {w.percent}%</span>
                  </div>
                  <div className="dash__wstrack">
                    <div className="dash__wsfill" style={{ width: `${w.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
