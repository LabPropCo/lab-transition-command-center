import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems } from "../work-items/api";
import type { WorkItem } from "../work-items/types";
import { computeDashboardMetrics } from "../lib/metrics";
import { SCREENS } from "../lib/nav";
import "../styles/dashboard.css";

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

  const s = SCREENS.dashboard;

  return (
    <section className="screen">
      <h1 className="screen__title">{s.title}</h1>
      <p className="screen__deck">{s.deck}</p>

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
        <>
          <div className="dash__grid">
            <div className="dash__tile">
              <div className="dash__tile-label">Overall readiness</div>
              <div className="dash__tile-value dash__tile-value--gold">{metrics.readinessPercent}%</div>
              <div className="dash__tile-sub">{metrics.completedCount} of {metrics.totalCount} work items complete</div>
            </div>
            <div className="dash__tile">
              <div className="dash__tile-label">Overdue</div>
              <div className={"dash__tile-value" + (metrics.overdueCount > 0 ? " dash__tile-value--terra" : "")}>
                {metrics.overdueCount}
              </div>
              <div className="dash__tile-sub">past due, not complete</div>
            </div>
            <div className="dash__tile">
              <div className="dash__tile-label">Go-live gates</div>
              <div className="dash__tile-value">{metrics.goLiveGate.completed}/{metrics.goLiveGate.total}</div>
              <div className="dash__tile-sub">{metrics.goLiveGate.outstanding} outstanding</div>
            </div>
            <div className="dash__tile">
              <div className="dash__tile-label">Critical path</div>
              <div className="dash__tile-value">{metrics.criticalPath.completed}/{metrics.criticalPath.total}</div>
              <div className="dash__tile-sub">{metrics.criticalPath.outstanding} outstanding</div>
            </div>
          </div>

          <div className="dash__section">
            <div className="dash__section-title">Workstream progress</div>
            <p className="dash__section-deck">Share of each workstream's work items marked Complete.</p>
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
          </div>
        </>
      )}
    </section>
  );
}
