import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE } from "../../demo/config";
import { listAllVendorTypes, createVendorType, updateVendorType } from "../../vendors/api";
import type { VendorType } from "../../vendors/types";
import "../../styles/admin.css";

// Global lookup, admin-managed — same architectural pattern as the Owners
// roster (work_owners, 0015): active/inactive toggle, no delete (deactivate,
// don't delete), any authenticated user reads, only a platform admin writes.
export function VendorTypes() {
  const [types, setTypes] = useState<VendorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<VendorType | null | "new">(null);
  const [draftName, setDraftName] = useState("");

  const reload = useCallback(() => {
    setLoading(true); setError("");
    listAllVendorTypes().then((t) => { setTypes(t); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Load failed."); setLoading(false); });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function guard(fn: () => Promise<void>) {
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
  }

  function openNew() { setDraftName(""); setEditing("new"); }
  function openEdit(t: VendorType) { setDraftName(t.name); setEditing(t); }

  async function saveDraft() {
    await guard(async () => {
      if (editing === "new") await createVendorType(draftName);
      else if (editing) await updateVendorType(editing.id, { name: draftName });
      setEditing(null); reload();
    });
  }

  async function quickToggle(t: VendorType) {
    await guard(async () => { await updateVendorType(t.id, { active: !t.active }); reload(); });
  }

  if (DEMO_MODE) {
    return (<section className="screen"><h1 className="screen__title">Vendor Types</h1>
      <p className="screen__deck">Vendor type management requires a live backend — not available in demo mode.</p></section>);
  }

  return (
    <section className="screen">
      <div className="methodology__head">
        <div>
          <h1 className="screen__title">Vendor Types</h1>
          <p className="screen__deck">
            The classification list offered in the Vendor Type dropdown. Deactivating a type removes it from
            future assignments only — vendors already classified with it keep that value unchanged.
          </p>
        </div>
        <div className="methodology__actions">
          <button className="adminform__btn adminform__btn--ghost" onClick={openNew}>+ Add vendor type</button>
        </div>
      </div>

      {error && <div className="loadbar" role="alert"><span className="loadbar__msg">{error}</span></div>}
      <div className="wi__count">{loading ? "Loading…" : `${types.length} vendor type${types.length === 1 ? "" : "s"}`}</div>

      {!loading && (
        <div className="wi__tablewrap">
          <table className="wi__table">
            <thead><tr><th className="wi__th">Name</th><th className="wi__th">Status</th><th className="wi__th"></th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className={"wi__row" + (t.active ? "" : " methodology__archived")}>
                  <td className="wi__td wi__code" onClick={() => openEdit(t)}>{t.name}</td>
                  <td className="wi__td">
                    <button className="methodology__reorder" onClick={() => void quickToggle(t)} style={{ padding: "2px 8px" }}>
                      {t.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="wi__td"><button className="sync__ignore" onClick={() => openEdit(t)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {types.length === 0 && <div className="wi__empty">No vendor types yet. Add one to get started.</div>}
        </div>
      )}

      {editing !== null && (
        <>
          <div className="panel__scrim" onClick={() => setEditing(null)} />
          <aside className="panel" role="dialog" aria-label={editing === "new" ? "New vendor type" : "Edit vendor type"}>
            <div className="panel__head">
              <div><h2 className="panel__title">{editing === "new" ? "New vendor type" : "Edit vendor type"}</h2></div>
              <button className="panel__close" onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="panel__body">
              <label className="panel__field">
                <span className="panel__label">Name</span>
                <input className="panel__input" value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus />
              </label>
            </div>
            <div className="panel__foot">
              <button className="panel__cancel" onClick={() => setEditing(null)}>Cancel</button>
              <button className="panel__save" disabled={!draftName.trim()} onClick={() => void saveDraft()}>Save</button>
            </div>
          </aside>
        </>
      )}
    </section>
  );
}
