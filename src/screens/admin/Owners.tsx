import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE } from "../../demo/config";
import { listAllOwners, createOwner, updateOwner, countOwnerUsage, type OwnerPatch } from "../../admin/api";
import { OwnerDetail } from "../../components/OwnerDetail";
import type { WorkOwner } from "../../types";
import "../../styles/admin.css";

export function Owners() {
  const [owners, setOwners] = useState<WorkOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<WorkOwner | null | "new">(null);

  const reload = useCallback(() => {
    setLoading(true); setError("");
    listAllOwners()
      .then((o) => { setOwners(o); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Load failed."); setLoading(false); });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function guard(fn: () => Promise<void>) {
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
  }

  // Informational only — never blocks deactivation, never reassigns anything.
  async function confirmDeactivation(displayName: string): Promise<boolean> {
    const { workItems, templates } = await countOwnerUsage(displayName);
    if (workItems === 0 && templates === 0) return true;
    const parts = [
      workItems > 0 ? `${workItems} work item${workItems === 1 ? "" : "s"}` : null,
      templates > 0 ? `${templates} template${templates === 1 ? "" : "s"} (as the default owner)` : null,
    ].filter(Boolean).join(" and ");
    return window.confirm(
      `"${displayName}" is currently referenced by ${parts}. Deactivating only removes them from future ` +
      `assignment dropdowns — those existing records keep this owner's name unchanged. Continue?`,
    );
  }

  const normalize = (s: string) => s.trim().toLowerCase();

  async function onSave(patch: OwnerPatch, id: string | null) {
    if (id) {
      const prev = owners.find((o) => o.id === id);
      const deactivating = prev?.active && patch.active === false;
      if (deactivating && !(await confirmDeactivation(prev!.displayName))) return;
      await updateOwner(id, patch);
    } else {
      const name = (patch.display_name ?? "").trim();
      // One normalized name maps to one roster record — reactivate the
      // existing inactive one instead of creating a duplicate.
      const inactiveMatch = owners.find((o) => !o.active && normalize(o.displayName) === normalize(name));
      if (inactiveMatch) {
        const reactivate = window.confirm(
          `"${inactiveMatch.displayName}" already exists but is inactive. Reactivate this owner instead of creating a new entry?`,
        );
        if (!reactivate) return; // admin declined — do not create, do not reactivate
        await updateOwner(inactiveMatch.id, { active: true });
      } else {
        try {
          await createOwner(name);
        } catch (e) {
          // Defensive: someone else created/reactivated a matching name between
          // our roster load and this save (race with the DB partial unique
          // index as backstop). Refresh so the admin sees current state, then
          // let the panel show the error as usual.
          reload();
          throw e;
        }
      }
    }
    setEditing(null); reload();
  }

  async function quickToggle(o: WorkOwner) {
    if (o.active && !(await confirmDeactivation(o.displayName))) return;
    await guard(async () => { await updateOwner(o.id, { active: !o.active }); reload(); });
  }

  if (DEMO_MODE) {
    return (<section className="screen"><h1 className="screen__title">Owners</h1>
      <p className="screen__deck">Owner roster management requires a live backend — not available in demo mode.</p></section>);
  }

  return (
    <section className="screen">
      <div className="methodology__head">
        <div>
          <h1 className="screen__title">Owners</h1>
          <p className="screen__deck">
            The roster offered in the Work Item and Master Work Item "Owner" dropdowns. Deactivating
            an owner removes them from future assignments only — it never edits existing records.
          </p>
        </div>
        <div className="methodology__actions">
          <button className="adminform__btn adminform__btn--ghost" onClick={() => setEditing("new")}>+ Add owner</button>
        </div>
      </div>

      {error && <div className="loadbar" role="alert"><span className="loadbar__msg">{error}</span></div>}
      <div className="wi__count">{loading ? "Loading…" : `${owners.length} owner${owners.length === 1 ? "" : "s"}`}</div>

      {!loading && (
        <div className="wi__tablewrap">
          <table className="wi__table">
            <thead><tr>
              <th className="wi__th">Display name</th><th className="wi__th">Status</th><th className="wi__th"></th>
            </tr></thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id} className={"wi__row" + (o.active ? "" : " methodology__archived")}>
                  <td className="wi__td wi__code" onClick={() => setEditing(o)}>{o.displayName}</td>
                  <td className="wi__td">
                    <button className="methodology__reorder" onClick={() => void quickToggle(o)} style={{ padding: "2px 8px" }}>
                      {o.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="wi__td"><button className="sync__ignore" onClick={() => setEditing(o)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {owners.length === 0 && <div className="wi__empty">No owners yet. Add one to get started.</div>}
        </div>
      )}

      {editing !== null && (
        <OwnerDetail owner={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={onSave} />
      )}
    </section>
  );
}
