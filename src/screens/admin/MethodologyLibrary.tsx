import { useEffect, useMemo, useState, useCallback } from "react";
import { DEMO_MODE } from "../../demo/config";
import { useTransition } from "../../transitions/TransitionProvider";
import {
  listTemplates, listVersions, createTemplate, updateTemplate, deleteTemplate,
  setArchived, duplicateTemplate, swapOrder, publishVersion,
} from "../../methodology/api";
import { listActiveOwners } from "../../work-items/api";
import type { Template, TemplatePatch, MethodologyVersion } from "../../methodology/types";
import type { WorkOwner } from "../../types";
import { TemplateDetail } from "../../components/TemplateDetail";
import { SyncPanel } from "../../components/SyncPanel";
import "../../styles/admin.css";

type SortKey = "order" | "code" | "description" | "scope" | "priority";

export function MethodologyLibrary() {
  const { selected } = useTransition();
  const [items, setItems] = useState<Template[]>([]);
  const [versions, setVersions] = useState<MethodologyVersion[]>([]);
  const [owners, setOwners] = useState<WorkOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [fWs, setFWs] = useState("All");
  const [fPhase, setFPhase] = useState("All");
  const [fScope, setFScope] = useState("All");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "order", dir: 1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Template | null | "new">(null);
  const [showSync, setShowSync] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const reload = useCallback(() => {
    setLoading(true); setError("");
    Promise.all([listTemplates(true), listVersions()])
      .then(([t, v]) => { setItems(t); setVersions(v); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Load failed."); setLoading(false); });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { listActiveOwners().then(setOwners).catch((e) => console.error("[owners] load failed", e)); }, []);

  const currentVersion = versions.find((v) => v.isCurrent) ?? null;
  const workstreams = useMemo(() => Array.from(new Set(items.map((i) => i.workstream).filter(Boolean))) as string[], [items]);
  const phases = useMemo(() => Array.from(new Set(items.map((i) => i.phase).filter(Boolean))) as string[], [items]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = items.filter((t) => {
      if (!showArchived && t.archived) return false;
      if (fWs !== "All" && t.workstream !== fWs) return false;
      if (fPhase !== "All" && t.phase !== fPhase) return false;
      if (fScope !== "All" && t.scopeType !== fScope) return false;
      if (needle && !(`${t.code} ${t.description} ${t.responsibleParty ?? ""}`.toLowerCase().includes(needle))) return false;
      return true;
    });
    rows.sort((a, b) => {
      let c = 0;
      if (sort.key === "order") c = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      else if (sort.key === "code") c = a.code.localeCompare(b.code);
      else if (sort.key === "description") c = a.description.localeCompare(b.description);
      else if (sort.key === "scope") c = a.scopeType.localeCompare(b.scopeType);
      else if (sort.key === "priority") c = (a.priority ?? "").localeCompare(b.priority ?? "");
      return c * sort.dir;
    });
    return rows;
  }, [items, q, fWs, fPhase, fScope, showArchived, sort]);

  const codes = useMemo(() => new Set(items.map((i) => i.code)), [items]);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selAll() {
    setSel((s) => (s.size === view.length ? new Set() : new Set(view.map((t) => t.id))));
  }

  async function guard(fn: () => Promise<void>) {
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
  }

  async function onSave(patch: TemplatePatch, id: string | null) {
    if (id) await updateTemplate(id, patch); else await createTemplate(patch);
    setEditing(null); reload();
  }
  async function onDelete(id: string) {
    if (!window.confirm("Delete this methodology item? This cannot be undone. (In-use items must be archived instead.)")) return;
    await guard(async () => { await deleteTemplate(id); setEditing(null); reload(); });
  }
  async function onDuplicate(t: Template) {
    await guard(async () => { await duplicateTemplate(t, codes); setEditing(null); reload(); });
  }
  async function onToggleArchive(t: Template) {
    await guard(async () => { await setArchived([t.id], !t.archived); setEditing(null); reload(); });
  }
  async function bulk(kind: "archive" | "activate" | "delete") {
    const ids = Array.from(sel);
    if (ids.length === 0) return;
    if (kind === "delete" && !window.confirm(`Delete ${ids.length} item(s)? In-use items must be archived instead.`)) return;
    await guard(async () => {
      if (kind === "delete") { for (const id of ids) await deleteTemplate(id); }
      else await setArchived(ids, kind === "archive");
      setSel(new Set()); reload();
    });
  }
  async function move(t: Template, dir: -1 | 1) {
    const idx = view.findIndex((x) => x.id === t.id);
    const nb = view[idx + dir];
    if (!nb) return;
    await guard(async () => { await swapOrder(t, nb); reload(); });
  }
  async function publish() {
    const label = window.prompt("New version label (e.g. v1.1):", suggestNext(currentVersion?.label));
    if (!label) return;
    const note = window.prompt("Version note (optional):", "") ?? null;
    await guard(async () => { await publishVersion(label, note); reload(); });
  }

  if (DEMO_MODE) {
    return (
      <section className="screen">
        <h1 className="screen__title">Methodology Library</h1>
        <p className="screen__deck">Editing the methodology requires a live backend — not available in demo mode.</p>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="methodology__head">
        <div>
          <h1 className="screen__title">Methodology Library</h1>
          <p className="screen__deck">The authoritative methodology for every future transition. Edits here affect future provisioning; existing transitions change only via Synchronize.</p>
        </div>
        <div className="methodology__version">
          <span className="chip"><span className="chip__dot" aria-hidden />{currentVersion ? currentVersion.label : "unversioned"}</span>
          <button className="adminform__btn adminform__btn--ghost" onClick={() => setShowVersions(true)}>History</button>
          <button className="adminform__btn adminform__btn--ghost" onClick={() => void publish()}>Publish version</button>
        </div>
      </div>

      {error && <div className="loadbar" role="alert"><span className="loadbar__msg">{error}</span></div>}

      <div className="wi__controls">
        <input className="wi__search" placeholder="Search ID, name, owner…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="wi__sel" value={fScope} onChange={(e) => setFScope(e.target.value)}>
          <option value="All">All scopes</option><option value="transition">Shared</option><option value="property">Property</option>
        </select>
        <select className="wi__sel" value={fWs} onChange={(e) => setFWs(e.target.value)}>
          <option value="All">All workstreams</option>{workstreams.map((w) => <option key={w}>{w}</option>)}
        </select>
        <select className="wi__sel" value={fPhase} onChange={(e) => setFPhase(e.target.value)}>
          <option value="All">All phases</option>{phases.map((p) => <option key={p}>{p}</option>)}
        </select>
        <label className="wi__gate"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        <div className="methodology__actions">
          <button className="adminform__btn adminform__btn--ghost" onClick={() => setEditing("new")}>+ New item</button>
          {selected && <button className="adminform__btn" onClick={() => setShowSync(true)}>Synchronize {selected.name.split(" ")[0]}…</button>}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="methodology__bulk">
          <span>{sel.size} selected</span>
          <button onClick={() => void bulk("archive")}>Archive</button>
          <button onClick={() => void bulk("activate")}>Restore</button>
          <button className="methodology__bulkdanger" onClick={() => void bulk("delete")}>Delete</button>
          <button onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <div className="wi__count">{loading ? "Loading…" : `${view.length} of ${items.length} items`}</div>

      {!loading && (
        <div className="wi__tablewrap">
          <table className="wi__table">
            <thead><tr>
              <th className="wi__th"><input type="checkbox" checked={sel.size === view.length && view.length > 0} onChange={selAll} /></th>
              <th className="wi__th">Order</th>
              <th className="wi__th wi__th--sort" onClick={() => toggleSort("code")}>ID{arrow("code")}</th>
              <th className="wi__th wi__th--sort" onClick={() => toggleSort("description")}>Name{arrow("description")}</th>
              <th className="wi__th wi__th--sort" onClick={() => toggleSort("scope")}>Scope{arrow("scope")}</th>
              <th className="wi__th">Workstream</th>
              <th className="wi__th">Phase</th>
              <th className="wi__th wi__th--sort" onClick={() => toggleSort("priority")}>Priority{arrow("priority")}</th>
            </tr></thead>
            <tbody>
              {view.map((t, i) => (
                <tr key={t.id} className={"wi__row" + (t.archived ? " methodology__archived" : "")}>
                  <td className="wi__td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggleSel(t.id)} />
                  </td>
                  <td className="wi__td" onClick={(e) => e.stopPropagation()}>
                    {sort.key === "order" && (
                      <span className="methodology__reorder">
                        <button disabled={i === 0} onClick={() => void move(t, -1)} aria-label="Move up">↑</button>
                        <button disabled={i === view.length - 1} onClick={() => void move(t, 1)} aria-label="Move down">↓</button>
                      </span>
                    )}
                  </td>
                  <td className="wi__td wi__code" onClick={() => setEditing(t)}>{t.code}</td>
                  <td className="wi__td" onClick={() => setEditing(t)}>
                    <span className="wi__desc">{t.description}</span>
                    <span className="wi__flags">
                      {t.criticalPath && <span className="wi__flag wi__flag--crit">Critical</span>}
                      {t.goLiveGate && <span className="wi__flag wi__flag--gate">Gate</span>}
                      {t.archived && <span className="wi__flag">Archived</span>}
                    </span>
                  </td>
                  <td className="wi__td" onClick={() => setEditing(t)}>
                    <span className={"wi__scope " + (t.scopeType === "transition" ? "wi__scope--shared" : "wi__scope--prop")}>
                      {t.scopeType === "transition" ? "Shared" : "Property"}
                    </span>
                  </td>
                  <td className="wi__td" onClick={() => setEditing(t)}>{t.workstream}</td>
                  <td className="wi__td" onClick={() => setEditing(t)}>{t.phase}</td>
                  <td className="wi__td" onClick={() => setEditing(t)}>{t.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.length === 0 && <div className="wi__empty">No methodology items match these filters.</div>}
        </div>
      )}

      {editing !== null && (
        <TemplateDetail
          template={editing === "new" ? null : editing}
          workstreams={workstreams} phases={phases} owners={owners}
          onClose={() => setEditing(null)}
          onSave={onSave} onDelete={onDelete} onDuplicate={onDuplicate} onToggleArchive={onToggleArchive}
        />
      )}
      {showSync && selected && (
        <SyncPanel transitionId={selected.id} transitionName={selected.name}
          onClose={() => setShowSync(false)} onApplied={() => { /* work items refresh on next visit */ }} />
      )}
      {showVersions && (
        <>
          <div className="panel__scrim" onClick={() => setShowVersions(false)} />
          <aside className="panel" role="dialog" aria-label="Version history">
            <div className="panel__head">
              <div><div className="panel__code">Methodology</div><h2 className="panel__title">Version history</h2></div>
              <button className="panel__close" onClick={() => setShowVersions(false)}>Close</button>
            </div>
            <div className="panel__body">
              {versions.length === 0 && <p className="panel__text">No versions published yet.</p>}
              {versions.map((v) => (
                <div key={v.id} className="ver__row">
                  <div className="ver__top">
                    <span className="ver__label">{v.label}{v.isCurrent && <span className="ver__cur">current</span>}</span>
                    <span className="ver__date">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="ver__counts">+{v.addedCount} added · {v.changedCount} changed · −{v.removedCount} removed</div>
                  {v.note && <div className="ver__note">{v.note}</div>}
                  <div className="ver__by">{v.createdByEmail ?? "system"}</div>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </section>
  );
}

function suggestNext(label?: string): string {
  if (!label) return "v1.1";
  const m = label.match(/^v(\d+)\.(\d+)$/);
  if (!m) return "";
  return `v${m[1]}.${Number(m[2]) + 1}`;
}
