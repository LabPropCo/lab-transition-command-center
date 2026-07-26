import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { DEMO_MODE } from "../demo/config";
import { listWorkItemsForTransitions, getCurrentUserDisplayName, updateWorkItem, listActiveOwners } from "../work-items/api";
import type { WorkItem, WorkItemPatch } from "../work-items/types";
import type { WorkOwner } from "../types";
import { computeMyActions, isOverdue } from "../lib/metrics";
import { WorkItemDetail } from "../components/WorkItemDetail";
import { SCREENS } from "../lib/nav";
import "../styles/myactions.css";

function daysOverdue(iso: string): number {
  const due = new Date(iso + "T00:00:00");
  const today = new Date(new Date().toDateString());
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// One line, worst-first: overdue duration beats a plain due date, and a
// missing due date is stated plainly rather than left blank.
function dueLabel(w: WorkItem): string {
  if (!w.dueDate) return "No due date";
  if (isOverdue(w)) {
    const d = daysOverdue(w.dueDate);
    return `${d} day${d === 1 ? "" : "s"} overdue`;
  }
  return `Due ${formatDate(w.dueDate)}`;
}

// Critical Path and Go-Live Gate are independent booleans, so they earn
// their own tags. "Blocked" is not — it IS the status value (isBlocked(w)
// is defined as status === "Blocked"), and status is always shown at the
// end of the row already, so a separate "Blocked" tag would just repeat
// the same word a few characters later. The status field is the blocked
// indicator; nothing else needs to say it again.
function flagLabels(w: WorkItem): string[] {
  const flags: string[] = [];
  if (w.criticalPath) flags.push("Critical Path");
  if (w.goLiveGate) flags.push("Go-Live Gate");
  return flags;
}

interface ActionRowProps {
  item: WorkItem;
  scopeLabel: string;
  onOpen: () => void;
}

function ActionRow({ item, scopeLabel, onOpen }: ActionRowProps) {
  return (
    <li className="ma__row" onClick={onOpen}>
      <div className="ma__row-title">{item.description}</div>
      <div className="ma__row-scope">{scopeLabel}</div>
      <div className="ma__row-meta">{[dueLabel(item), ...flagLabels(item), item.status].join(" · ")}</div>
    </li>
  );
}

export function MyActions() {
  const { transitions } = useTransition();
  const { user } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [properties, setProperties] = useState<Map<string, string>>(new Map());
  const [owners, setOwners] = useState<WorkOwner[]>([]);
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [transitionFilter, setTransitionFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const transitionIds = useMemo(() => transitions.map((t) => t.id), [transitions]);
  const transitionNames = useMemo(() => new Map(transitions.map((t) => [t.id, t.name])), [transitions]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (transitionIds.length === 0) { setItems([]); setLoading(false); return; }
      setLoading(true); setErr("");
      try {
        const [rows, myName] = await Promise.all([
          listWorkItemsForTransitions(transitionIds),
          getCurrentUserDisplayName(),
        ]);
        if (!active) return;
        setItems(rows);
        setDisplayName(myName ?? "");
        setLoading(false);
      } catch (e) {
        if (active) { setErr(e instanceof Error ? e.message : "Failed to load"); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [transitionIds, user?.id]);

  // Property names across every transition (not just one) — My Actions
  // aggregates by design, so it can't rely on TransitionProvider's
  // single-selected-transition property list.
  useEffect(() => {
    let active = true;
    (async () => {
      if (transitionIds.length === 0) { setProperties(new Map()); return; }
      if (DEMO_MODE) {
        const s = await import("../demo/store");
        const lists = await Promise.all(transitionIds.map((id) => s.demoProperties(id)));
        if (active) setProperties(new Map(lists.flat().map((p) => [p.id, p.name])));
        return;
      }
      if (!supabase) return;
      const { data, error } = await supabase
        .from("properties").select("id,name").in("transition_id", transitionIds);
      if (!active) return;
      if (error) { console.error("[my-actions] properties load failed", error); return; }
      setProperties(new Map((data ?? []).map((p: { id: string; name: string }) => [p.id, p.name])));
    })();
    return () => { active = false; };
  }, [transitionIds]);

  useEffect(() => {
    let active = true;
    listActiveOwners().then((o) => { if (active) setOwners(o); }).catch((e) => console.error("[my-actions] owners load failed", e));
    return () => { active = false; };
  }, []);

  const scoped = useMemo(
    () => (transitionFilter === "all" ? items : items.filter((w) => w.transitionId === transitionFilter)),
    [items, transitionFilter],
  );

  const groups = useMemo(
    () => (displayName ? computeMyActions(scoped, displayName) : null),
    [scoped, displayName],
  );

  const scopeLabel = (w: WorkItem): string => {
    const transitionName = transitionNames.get(w.transitionId) ?? "";
    if (w.scopeType === "transition" || !w.propertyId) return transitionName;
    return `${transitionName} · ${properties.get(w.propertyId) ?? "Property"}`;
  };

  async function applyPatch(id: string, patch: WorkItemPatch) {
    const prev = items;
    try {
      const updated = await updateWorkItem(id, patch);
      setItems((list) => list.map((w) => (w.id === id ? updated : w)));
      return updated;
    } catch (e) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : "Update failed — you may not have edit access.");
      throw e;
    }
  }

  const open = items.find((w) => w.id === openId) ?? null;
  const totalMine = groups ? groups.needsAttention.length + groups.dueThisWeek.length + groups.later.length : 0;
  const s = SCREENS.myactions;

  return (
    <section className="screen ma">
      <div className="ma__hero">
        <h1 className="screen__title">{s.title}</h1>
        <p className="screen__deck">{s.deck}</p>
        {transitions.length > 1 && (
          <select className="ma__filter" value={transitionFilter} onChange={(e) => setTransitionFilter(e.target.value)}>
            <option value="all">All transitions</option>
            {transitions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {err && <p className="ma__err">{err}</p>}
      {loading && !err && <p className="ma__loading">Loading…</p>}

      {!loading && !err && groups && (
        totalMine === 0 ? (
          <p className="ma__empty">You have no active work items assigned.</p>
        ) : (
          <>
            <div className="ma__stats">
              <div className="ma__stat">
                <div className="ma__stat-value">{groups.counts.overdue}</div>
                <div className="ma__stat-label">Overdue</div>
              </div>
              <div className="ma__stat">
                <div className="ma__stat-value">{groups.counts.dueThisWeek}</div>
                <div className="ma__stat-label">Due this week</div>
              </div>
              <div className="ma__stat">
                <div className="ma__stat-value">{groups.counts.criticalPath}</div>
                <div className="ma__stat-label">Critical path</div>
              </div>
              <div className="ma__stat">
                <div className="ma__stat-value">{groups.counts.blocked}</div>
                <div className="ma__stat-label">Blocked</div>
              </div>
            </div>

            <div className="ma__body">
              <section className="ma__group">
                <h2 className="ma__group-title">Needs attention</h2>
                {groups.needsAttention.length === 0 ? (
                  <p className="ma__quiet">Nothing needs immediate attention. Your upcoming work appears below.</p>
                ) : (
                  <ol className="ma__list">
                    {groups.needsAttention.map((w) => (
                      <ActionRow key={w.id} item={w} scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
                    ))}
                  </ol>
                )}
              </section>

              <section className="ma__group">
                <h2 className="ma__group-title">Due this week</h2>
                {groups.dueThisWeek.length === 0 ? (
                  <p className="ma__quiet">No additional items are due this week.</p>
                ) : (
                  <ol className="ma__list">
                    {groups.dueThisWeek.map((w) => (
                      <ActionRow key={w.id} item={w} scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
                    ))}
                  </ol>
                )}
              </section>

              {groups.later.length > 0 && (
                <section className="ma__group">
                  <h2 className="ma__group-title">Later</h2>
                  <ol className="ma__list">
                    {groups.later.map((w) => (
                      <ActionRow key={w.id} item={w} scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </>
        )
      )}

      {open && (
        <WorkItemDetail
          item={open}
          allItems={items}
          transitionName={transitionNames.get(open.transitionId) ?? ""}
          propertyName={open.propertyId ? properties.get(open.propertyId) ?? "Property" : "Shared"}
          owners={owners}
          onClose={() => setOpenId(null)}
          onSave={(patch) => applyPatch(open.id, patch)}
        />
      )}
    </section>
  );
}
