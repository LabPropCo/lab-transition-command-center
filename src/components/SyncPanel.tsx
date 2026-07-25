import { useEffect, useState, useCallback } from "react";
import { syncPreview, applySync, deferSyncChange } from "../methodology/api";
import type { SyncRow, SyncResult } from "../methodology/types";

const LABELS: Record<SyncRow["changeType"], string> = {
  add: "New items to add", rename: "Renames", metadata: "Metadata updates",
  due: "Methodology due dates", conflict: "Conflicts (review)", skip: "Protected (completed)",
  archived: "Archived / removed (retained)",
};
const ORDER: SyncRow["changeType"][] = ["add", "rename", "metadata", "due", "conflict", "skip", "archived"];
const DEFERRABLE = new Set(["rename", "metadata", "due"]);

export function SyncPanel({ transitionId, transitionName, onClose, onApplied }: {
  transitionId: string; transitionName: string; onClose: () => void; onApplied: () => void;
}) {
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [add, setAdd] = useState(true);
  const [rename, setRename] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [due, setDue] = useState(false);
  const [skipCompleted, setSkipCompleted] = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    syncPreview(transitionId)
      .then((r) => { setRows(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Preview failed."); setLoading(false); });
  }, [transitionId]);
  useEffect(() => { load(); }, [load]);

  const counts = ORDER.reduce((a, k) => { a[k] = rows.filter((r) => r.changeType === k).length; return a; }, {} as Record<string, number>);

  async function apply() {
    setApplying(true); setError(""); setResult(null);
    try {
      const res = await applySync(transitionId, { add, rename, metadata, due, skipCompleted });
      setResult(res); onApplied(); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed."); }
    finally { setApplying(false); }
  }

  async function ignore(r: SyncRow) {
    if (!r.templateId || !DEFERRABLE.has(r.changeType)) return;
    try { await deferSyncChange(transitionId, r.templateId, r.changeType as "rename" | "metadata" | "due"); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not ignore change."); }
  }

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel panel--wide" role="dialog" aria-label="Synchronize transition">
        <div className="panel__head">
          <div><div className="panel__code">Synchronize</div><h2 className="panel__title">{transitionName}</h2></div>
          <button className="panel__close" onClick={onClose}>Close</button>
        </div>

        <div className="panel__body">
          {error && <p className="panel__error">{error}</p>}
          <p className="panel__text">
            Preview of the difference between the current methodology and this transition. Synchronization is
            additive and never overwrites status, owner, notes, manual due dates, or completed work. Matching
            is by each item's permanent ID, so renaming a template ID never loses the link.
          </p>

          <div className="sync__summary">
            {ORDER.map((k) => (
              <div key={k} className={"sync__chip sync__chip--" + k}><span className="sync__chipn">{counts[k] ?? 0}</span> {LABELS[k]}</div>
            ))}
          </div>

          <div className="sync__opts">
            <label className="panel__check"><input type="checkbox" checked={add} onChange={(e) => setAdd(e.target.checked)} /> Add new work items ({counts.add ?? 0})</label>
            <label className="panel__check"><input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} /> Apply renames ({counts.rename ?? 0})</label>
            <label className="panel__check"><input type="checkbox" checked={metadata} onChange={(e) => setMetadata(e.target.checked)} /> Apply metadata updates ({counts.metadata ?? 0})</label>
            <label className="panel__check"><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} /> Apply methodology due dates ({counts.due ?? 0}) — manual overrides are never touched</label>
            <label className="panel__check"><input type="checkbox" checked={skipCompleted} onChange={(e) => setSkipCompleted(e.target.checked)} /> Protect completed work (recommended)</label>
          </div>

          {result && <p className="sync__result">Applied — added {result.added}, renamed {result.renamed}, updated {result.updated}, due dates {result.due}.</p>}

          {loading ? <p className="panel__text">Loading preview…</p> : (
            <div className="sync__list">
              {ORDER.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
                <div key={k} className="sync__group">
                  <div className="sync__grouphd">{LABELS[k]}</div>
                  {rows.filter((r) => r.changeType === k).slice(0, 100).map((r, i) => (
                    <div key={k + i} className="sync__row">
                      <span className="wi__code">{r.code}</span>
                      <span className={"wi__scope " + (r.scopeType === "transition" ? "wi__scope--shared" : "wi__scope--prop")}>
                        {r.scopeType === "transition" ? "Shared" : "Property"}
                      </span>
                      <span className="sync__detail">
                        {r.changeType === "add" && (r.newValue ?? "")}
                        {(r.changeType === "rename" || r.changeType === "metadata" || r.changeType === "due") && `${r.field}: ${r.oldValue ?? "—"} → ${r.newValue ?? "—"}`}
                        {r.changeType === "conflict" && `scope is ${r.oldValue} here, ${r.newValue} in methodology`}
                        {r.changeType === "skip" && "completed — will not be changed"}
                        {r.changeType === "archived" && (r.newValue ?? "template archived — work retained")}
                      </span>
                      {DEFERRABLE.has(r.changeType) && r.templateId && (
                        <button className="sync__ignore" onClick={() => void ignore(r)} title="Ignore this change for this transition">Ignore</button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {rows.length === 0 && <p className="panel__text">This transition is already in sync with the methodology.</p>}
            </div>
          )}
        </div>

        <div className="panel__foot">
          <button className="panel__cancel" onClick={onClose}>Close</button>
          <button className="panel__save" disabled={applying || (!add && !rename && !metadata && !due)} onClick={() => void apply()}>
            {applying ? "Applying…" : "Apply selected"}
          </button>
        </div>
      </aside>
    </>
  );
}
