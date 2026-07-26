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

// How many days an already-overdue item has been overdue. Only ever called on
// items isOverdue() has already confirmed have a valid, past due date.
function daysOverdue(iso: string): number {
  const due = new Date(iso + "T00:00:00");
  const today = new Date(new Date().toDateString());
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

// A self-contained figure + label, never a fragment: whatever the sign of
// `d`, the pairing always reads as a complete statement on its own.
function goLiveCountdown(d: number): { value: number; label: string } {
  if (d > 0) return { value: d, label: d === 1 ? "Day until go-live" : "Days until go-live" };
  if (d === 0) return { value: 0, label: "Go-live is today" };
  const since = Math.abs(d);
  return { value: since, label: since === 1 ? "Day since go-live" : "Days since go-live" };
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

  const goLiveDays = selected ? daysUntil(selected.targetGoLive) : null;
  const countdown = goLiveDays !== null ? goLiveCountdown(goLiveDays) : null;
  const readinessReady = !loading && !err && metrics.totalCount > 0;

  return (
    <section className="screen dash">
      <div className="dash__hero">
        <p className="dash__eyebrow">{selected?.name ?? "Dashboard"}</p>
        {(countdown || readinessReady) && (
          <div className="dash__headline">
            {countdown && (
              <div className="dash__figure">
                <div className="dash__figure-value">{countdown.value}</div>
                <div className="dash__figure-label">{countdown.label}</div>
              </div>
            )}
            {readinessReady && (
              <div className="dash__figure">
                <div className="dash__figure-value">{metrics.readinessPercent}%</div>
                <div className="dash__figure-label">Complete</div>
              </div>
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
              : "Select a transition to see its dashboard."}
          </p>
        </div>
      )}

      {!loading && !err && metrics.totalCount > 0 && (
        <div className="dash__body">
          <div className="dash__stats">
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
              <h2 className="dash__block-title">Needs attention</h2>
              {priorityItems.length === 0 ? (
                <p className="dash__quiet">Nothing overdue on the critical path or a go-live gate.</p>
              ) : (
                <ol className="dash__list">
                  {priorityItems.map((w) => {
                    const overdue = w.dueDate ? daysOverdue(w.dueDate) : null;
                    return (
                      <li className="dash__row" key={w.id}>
                        <span className="dash__row-code">{w.code}</span>
                        <span className="dash__row-desc">{w.description}</span>
                        <span className="dash__row-meta">
                          {w.owner && <>{w.owner} · </>}
                          {overdue !== null ? `${overdue} day${overdue === 1 ? "" : "s"} overdue` : "overdue"}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section className="dash__block">
              <h2 className="dash__block-title">Recent progress</h2>
              {recentProgress.items.length === 0 ? (
                <p className="dash__quiet">Nothing completed in the last two weeks.</p>
              ) : (
                <ol className="dash__momentum-list">
                  {recentProgress.items.map((w) => (
                    <li className="dash__momentum-item" key={w.id}>
                      {w.owner ? <>{w.owner} completed </> : "Completed "}
                      <span className="dash__momentum-desc">{w.description}</span>
                      {w.completedAt && <span className="dash__momentum-date"> · {w.completedAt.slice(0, 10)}</span>}
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
