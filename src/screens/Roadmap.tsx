import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems } from "../work-items/api";
import type { WorkItem } from "../work-items/types";
import { computePhaseMilestones } from "../lib/metrics";
import { SCREENS } from "../lib/nav";
import "../styles/dashboard.css";
import "../styles/roadmap.css";

export function Roadmap() {
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

  // Same property-scope semantics as Work Items and the Dashboard.
  const scoped = useMemo(() => items.filter((w) => {
    if (propertyFilter === "shared") return w.scopeType === "transition";
    if (propertyFilter !== "all") return w.propertyId === propertyFilter;
    return true;
  }), [items, propertyFilter]);

  const phases = useMemo(() => computePhaseMilestones(scoped), [scoped]);

  const s = SCREENS.roadmap;

  return (
    <section className="screen">
      <h1 className="screen__title">{s.title}</h1>
      <p className="screen__deck">{s.deck}</p>

      {err && <p className="dash__err">{err}</p>}
      {loading && !err && <p className="dash__loading">Loading…</p>}

      {!loading && !err && phases.length === 0 && (
        <div className="dash__empty">
          <div className="dash__empty-head">No work items yet</div>
          <p className="dash__empty-body">
            {selected
              ? "This transition hasn't been provisioned with work items yet, or none match the current property filter."
              : "Select a transition to see its roadmap."}
          </p>
        </div>
      )}

      {!loading && !err && phases.length > 0 && (
        <div className="roadmap__list">
          {phases.map((p) => {
            const current = selected?.currentPhase === p.phase;
            return (
              <div className={"roadmap__phase" + (current ? " roadmap__phase--current" : "")} key={p.phase}>
                <div className="roadmap__phasehead">
                  <span className="roadmap__phasename">
                    {p.phase}
                    {current && <span className="roadmap__here">You are here</span>}
                  </span>
                  <span className="roadmap__phasecount">{p.completed} / {p.total} · {p.percent}%</span>
                </div>
                <div className="dash__wstrack">
                  <div className="dash__wsfill" style={{ width: `${p.percent}%` }} />
                </div>

                {p.gateItems.length > 0 && (
                  <ul className="roadmap__gates">
                    {p.gateItems.map((g) => (
                      <li className="roadmap__gate" key={g.id}>
                        <span className="roadmap__gatecode">{g.code}</span>
                        <span className="roadmap__gatedesc">{g.description}</span>
                        <span className={"roadmap__gatestatus" + (g.status === "Complete" ? " roadmap__gatestatus--done" : "")}>
                          {g.status}
                        </span>
                        <span className="roadmap__gatedue">{g.dueDate ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
