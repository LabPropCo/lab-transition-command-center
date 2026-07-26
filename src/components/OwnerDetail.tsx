import { useEffect, useState } from "react";
import type { WorkOwner } from "../types";
import type { OwnerPatch } from "../admin/api";

const empty: OwnerPatch = { display_name: "", active: true };

export function OwnerDetail({ owner, onClose, onSave }: {
  owner: WorkOwner | null; // null = new
  onClose: () => void;
  onSave: (patch: OwnerPatch, id: string | null) => Promise<void>;
}) {
  const isNew = owner === null;
  const [f, setF] = useState<OwnerPatch>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setF(owner ? { display_name: owner.displayName, active: owner.active } : empty);
  }, [owner]);

  const set = (k: keyof OwnerPatch, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setError("");
    if (!f.display_name?.trim()) { setError("Owner name is required."); return; }
    setSaving(true);
    try { await onSave(f, owner?.id ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={isNew ? "New owner" : `Edit ${owner?.displayName}`}>
        <div className="panel__head">
          <div>
            <div className="panel__code">Owner{owner && !owner.active ? " · Inactive" : ""}</div>
            <h2 className="panel__title">{isNew ? "Add owner" : "Edit owner"}</h2>
          </div>
          <button className="panel__close" onClick={onClose}>Close</button>
        </div>

        <div className="panel__body">
          {error && <p className="panel__error">{error}</p>}
          <label className="panel__field"><span className="panel__label">Display name</span>
            <input className="panel__input" value={f.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} /></label>
          <label className="panel__field"><span className="panel__label">Status</span>
            <select className="panel__input" value={f.active ? "active" : "inactive"} onChange={(e) => set("active", e.target.value === "active")}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select></label>
          <p className="panel__text">
            Renaming only changes what future assignments offer — existing work items and templates
            keep whatever owner text they already have until someone edits that record by hand.
          </p>
        </div>

        <div className="panel__foot">
          <button className="panel__cancel" onClick={onClose}>Cancel</button>
          <button className="panel__save" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </aside>
    </>
  );
}
