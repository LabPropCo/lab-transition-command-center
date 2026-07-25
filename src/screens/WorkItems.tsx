import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems, updateWorkItem } from "../work-items/api";
import type { WorkItem, WorkItemPatch } from "../work-items/types";
import { STATUSES, statusColor, priorityColor } from "../work-items/constants";
import { WorkItemDetail } from "../components/WorkItemDetail";
import { SCREENS } from "../lib/nav";
import "../styles/workitems.css";

type SortKey = "code" | "due_date" | "priority" | "status" | "scope";
const PRI_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function overdue(w: WorkItem): boolean {
  if (!w.dueDate || w.status === "Complete" || w.status === "Not Applicable") return false;
  return new Date(w.dueDate + "T00:00:00") < new Date(new Date().toDateString());
}

export function WorkItems() {
  const { selected, properties, propertyFilter, setPropertyFilter } = useTransition();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [fWs, setFWs] = useState("All");
  const [fPhase, setFPhase] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [gateOnly, setGateOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "code", dir: 1 });
  const [openId, setOpenId] = useState<string | null>(null);

  const propName = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? "Property" : "Shared");
  }, [properties]);

  useEffect(() => {
    if (!selected) { setItems([]); setLoading(false); return; }
    let active = true;
    setLoading(true); setErr("");
    listWorkItems(selected.id)
      .then((rows) => { if (active) { setItems(rows); setLoading(false); } })
      .catch((e) => { if (active) { setErr(e.message ?? "Failed to load"); setLoading(false); } });
    return () => { active = false; };
  }, [selected]);

  const workstreams = useMemo(() => Array.from(new Set(items.map((i) => i.workstream).filter(Boolean))) as string[], [items]);
  const phases = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => { if (i.phase) m.set(i.phase, i.phaseOrder ?? 0); });
    return Array.from(m.entries()).sort((a, b) => a[1] - b[1]).map(([p]) => p);
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = items.filter((w) => {
      if (propertyFilter === "shared" && w.scopeType !== "transition") return false;
      if (propertyFilter !== "all" && propertyFilter !== "shared" && w.propertyId !== propertyFilter) return false;
      if (fWs !== "All" && w.workstream !== fWs) return false;
      if (fPhase !== "All" && w.phase !== fPhase) return false;
      if (fStatus !== "All" && w.status !== fStatus) return false;
      if (gateOnly && !w.goLiveGate) return false;
      if (needle && !(`${w.code} ${w.description} ${w.owner ?? ""}`.toLowerCase().includes(needle))) return false;
      return true;
    });
    rows.sort((a, b) => {
      let c = 0;
      if (sort.key === "code") c = a.code.localeCompare(b.code);
      else if (sort.key === "due_date") c = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      else if (sort.key === "priority") c = (PRI_RANK[a.priority ?? ""] ?? 9) - (PRI_RANK[b.priority ?? ""] ?? 9);
      else if (sort.key === "status") c = a.status.localeCompare(b.status);
      else if (sort.key === "scope") c = propName(a.propertyId).localeCompare(propName(b.propertyId));
      return c * sort.dir;
    });
    return rows;
  }, [items, q, fWs, fPhase, fStatus, gateOnly, sort, propertyFilter, propName]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

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
  const s = SCREENS["work-items"];
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  return (
    <section className="screen wi">
      <h1 className="screen__title">{s.title}</h1>
      <p className="screen__deck">{s.deck}</p>

      <div className="wi__controls">
        <input className="wi__search" placeholder="Search by ID, description, or owner…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="wi__sel" value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
          <option value="all">All properties</option>
          <option value="shared">Shared (transition-wide)</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="wi__sel" value={fWs} onChange={(e) => setFWs(e.target.value)}>
          <option value="All">All workstreams</option>
          {workstreams.map((w) => <option key={w}>{w}</option>)}
        </select>
        <select className="wi__sel" value={fPhase} onChange={(e) => setFPhase(e.target.value)}>
          <option value="All">All phases</option>
          {phases.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="wi__sel" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="All">All statuses</option>
          {STATUSES.map((st) => <option key={st}>{st}</option>)}
        </select>
        <label className="wi__gate">
          <input type="checkbox" checked={gateOnly} onChange={(e) => setGateOnly(e.target.checked)} />
          Go-live gates only
        </label>
      </div>

      {err && <p className="wi__err">{err}</p>}
      <div className="wi__count">{loading ? "Loading…" : `${filtered.length} of ${items.length} work items`}</div>

      {!loading && (
        <div className="wi__tablewrap">
          <table className="wi__table">
            <thead>
              <tr>
                <th className="wi__th wi__th--sort" onClick={() => toggleSort("code")}>ID{arrow("code")}</th>
                <th className="wi__th">Work item</th>
                <th className="wi__th wi__th--sort" onClick={() => toggleSort("scope")}>Scope{arrow("scope")}</th>
                <th className="wi__th">Owner</th>
                <th className="wi__th wi__th--sort" onClick={() => toggleSort("due_date")}>Due{arrow("due_date")}</th>
                <th className="wi__th wi__th--sort" onClick={() => toggleSort("priority")}>Priority{arrow("priority")}</th>
                <th className="wi__th wi__th--sort" onClick={() => toggleSort("status")}>Status{arrow("status")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id} className="wi__row" onClick={() => setOpenId(w.id)}>
                  <td className="wi__td wi__code">{w.code}</td>
                  <td className="wi__td">
                    <span className="wi__desc">{w.description}</span>
                    <span className="wi__flags">
                      {w.criticalPath && <span className="wi__flag wi__flag--crit">Critical path</span>}
                      {w.goLiveGate && <span className="wi__flag wi__flag--gate">Go-live gate</span>}
                    </span>
                  </td>
                  <td className="wi__td">
                    {w.scopeType === "transition"
                      ? <span className="wi__scope wi__scope--shared">Shared</span>
                      : <span className="wi__scope wi__scope--prop">{propName(w.propertyId)}</span>}
                  </td>
                  <td className="wi__td">{w.owner}</td>
                  <td className={"wi__td " + (overdue(w) ? "wi__overdue" : "wi__muted")}>
                    {w.dueDate ?? "—"}{overdue(w) ? " · overdue" : ""}
                  </td>
                  <td className="wi__td"><span style={{ color: priorityColor(w.priority) }}>{w.priority ?? "—"}</span></td>
                  <td className="wi__td" onClick={(e) => e.stopPropagation()}>
                    <span className="wi__statusdot" style={{ background: statusColor(w.status) }} />
                    <select className="wi__statussel" value={w.status}
                      onChange={(e) => void applyPatch(w.id, { status: e.target.value })}>
                      {STATUSES.map((st) => <option key={st}>{st}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="wi__empty">No work items match these filters.</div>}
        </div>
      )}

      {open && (
        <WorkItemDetail
          item={open}
          allItems={items}
          transitionName={selected?.name ?? ""}
          propertyName={propName(open.propertyId)}
          onClose={() => setOpenId(null)}
          onSave={(patch) => applyPatch(open.id, patch)}
        />
      )}
    </section>
  );
}
