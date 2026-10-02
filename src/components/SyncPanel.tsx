import { useEffect, useState, useCallback } from "react";
import { syncPreview, applySync, deferSyncChange } from "../methodology/api";
import type { SyncRow, SyncResult } from "../methodology/types";

const LABELS: Record<SyncRow["changeType"], string> = {
  add: "New items to add", rename: "Renames", metadata: "Metadata updates", owner: "Responsible party / owner",
  due: "Methodology due dates", archive: "Archive existing work items", restore: "Restore archived work items",
  conflict: "Conflicts (review)", skip: "Protected (completed)",
};
const ORDER: SyncRow["changeType"][] = ["add", "rename", "metadata", "owner", "due", "archive", "restore", "conflict", "skip"];
const DEFERRABLE = new Set(["rename", "metadata", "due", "owner"]);

export function SyncPanel({ transitionId, transitionName, onClose, onApplied }: {
  transitionId: string; transitionName: string; onClose: () => void; onApplied: () => void;
}) {
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [add, setAdd] = useState(true);
  const [rename, setRename] = useState(true);
  const [metadata, setMetadata] = useState(true);
  const [owner, setOwner] = useState(true);
  const [due, setDue] = useState(false);
  const [archive, setArchive] = useState(true);
  const [restore, setRestore] = useState(true);
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
  const selectedCount = (add ? counts.add ?? 0 : 0) + (rename ? counts.rename ?? 0 : 0)
    + (metadata ? counts.metadata ?? 0 : 0) + (owner ? counts.owner ?? 0 : 0) + (due ? counts.due ?? 0 : 0)
    + (archive ? counts.archive ?? 0 : 0) + (restore ? counts.restore ?? 0 : 0);
  const nothingSelected = !add && !rename && !metadata && !owner && !due && !archive && !restore;

  async function apply() {
    setApplying(true); setError(""); setResult(null);
    try {
      const res = await applySync(transitionId, { add, rename, metadata, due, skipCompleted, archive, restore, owner });
      setResult(res); onApplied(); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed."); }
    finally { setApplying(false); }
  }

  async function ignore(r: SyncRow) {
    if (!r.templateId || !DEFERRABLE.has(r.changeType)) return;
    try { await deferSyncChange(transitionId, r.templateId, r.changeType as "rename" | "metadata" | "due" | "owner"); load(); }
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
            <label className="panel__check"><input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} /> Apply responsible party / owner ({counts.owner ?? 0})</label>
            <label className="panel__check"><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} /> Apply methodology due dates ({counts.due ?? 0}) — manual overrides are never touched</label>
            <label className="panel__check"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Archive existing work items ({counts.archive ?? 0}) — hides from Master Work Items, never deletes</label>
            <label className="panel__check"><input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} /> Restore archived work items ({counts.restore ?? 0})</label>
            <label className="panel__check"><input type="checkbox" checked={skipCompleted} onChange={(e) => setSkipCompleted(e.target.checked)} /> Protect completed work (recommended)</label>
          </div>

          {result && (
            <p className="sync__result">
              Applied — added {result.added}, renamed {result.renamed}, updated {result.updated}, due dates {result.due},
              archived {result.archived}, restored {result.restored}, owners updated {result.ownersUpdated}
              {result.ownerConflicts > 0 ? `, owner conflicts ${result.ownerConflicts}` : ""}.
            </p>
          )}

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
                        {(r.changeType === "rename" || r.changeType === "metadata" || r.changeType === "due" || r.changeType === "owner") && `${r.field}: ${r.oldValue ?? "—"} → ${r.newValue ?? "—"}`}
                        {r.changeType === "conflict" && `scope is ${r.oldValue} here, ${r.newValue} in methodology`}
                        {r.changeType === "skip" && `Changed: ${r.field ?? "—"}. ${r.newValue ?? "Protected because this item is Complete."}`}
                        {(r.changeType === "archive" || r.changeType === "restore") && (r.newValue ?? "")}
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
          {nothingSelected && <p className="panel__error">Select at least one synchronization category.</p>}
          <button className="panel__cancel" onClick={onClose}>Close</button>
          <button className="panel__save" disabled={applying || nothingSelected} onClick={() => void apply()}>
            {applying ? "Applying…" : `Apply ${selectedCount} Change${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </aside>
    </>
  );
}
