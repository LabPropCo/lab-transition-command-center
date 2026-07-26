import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems } from "../work-items/api";
import type { WorkItem } from "../work-items/types";
import { computeDashboardMetrics, computePriorityItems, computeRecentProgress } from "../lib/metrics";
import "../styles/dashboard.css";

const STATUS_TONE: Record<string, "good" | "attention" | "neutral"> = {
  "On Track": "good",
  "Complete": "good",
  "At Risk": "attention",
  "Delayed": "attention",
  "On Hold": "neutral",
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(new Date().toDateString());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

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

  const status = selected?.overallStatus ?? null;
  const tone = status ? (STATUS_TONE[status] ?? "neutral") : "neutral";
  const goLiveDays = selected ? daysUntil(selected.targetGoLive) : null;

  // A short, honest narrative — every clause is a computed fact, nothing fabricated.
  const narrative = useMemo(() => {
    if (!selected || metrics.totalCount === 0) return null;
    const parts: string[] = [];
    parts.push(
      `${metrics.readinessPercent}% of ${metrics.totalCount} work items are complete` +
      (goLiveDays !== null ? `, with ${goLiveDays >= 0 ? goLiveDays : 0} day${goLiveDays === 1 ? "" : "s"} remaining to go-live.` : "."),
    );
    if (metrics.overdueCount > 0) {
      const gateNote = metrics.goLiveGate.outstanding > 0
        ? `, including ${metrics.goLiveGate.outstanding} go-live gate${metrics.goLiveGate.outstanding === 1 ? "" : "s"} not yet cleared`
        : "";
      parts.push(`${metrics.overdueCount} item${metrics.overdueCount === 1 ? "" : "s"} ${metrics.overdueCount === 1 ? "is" : "are"} past due${gateNote}.`);
    } else {
      parts.push("Nothing is past due.");
    }
    return parts.join(" ");
  }, [selected, metrics, goLiveDays]);

  return (
    <section className="screen dash">
      <div className="dash__hero">
        <div className="dash__eyebrow">{selected?.name ?? "Dashboard"}</div>
        <h1 className={"dash__status dash__status--" + tone}>{status ?? "Dashboard"}</h1>
        {selected?.currentPhase && <p className="dash__phase">{selected.currentPhase}</p>}
        {narrative && <p className="dash__narrative">{narrative}</p>}
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
            {goLiveDays !== null && (
              <div className="dash__stat">
                <div className="dash__stat-value">{goLiveDays >= 0 ? goLiveDays : 0}</div>
                <div className="dash__stat-label">Days to go-live</div>
              </div>
            )}
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.goLiveGate.completed}/{metrics.goLiveGate.total}</div>
              <div className="dash__stat-label">Go-live gates</div>
            </div>
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.criticalPath.completed}/{metrics.criticalPath.total}</div>
              <div className="dash__stat-label">Critical path</div>
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
              {recentProgress.length === 0 ? (
                <p className="dash__quiet">Nothing completed in the last two weeks.</p>
              ) : (
                <ol className="dash__list">
                  {recentProgress.map((w) => (
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
