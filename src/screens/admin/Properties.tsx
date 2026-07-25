import { useState } from "react";
import { DEMO_MODE } from "../../demo/config";
import { useTransition } from "../../transitions/TransitionProvider";
import { createProperty, updateProperty, setDefaultProperty, type PropertyPatch } from "../../admin/api";
import { PropertyDetail } from "../../components/PropertyDetail";
import type { Property } from "../../types";
import "../../styles/admin.css";

export function Properties() {
  const { selected, properties, reload } = useTransition();
  const [editing, setEditing] = useState<Property | null | "new">(null);
  const [error, setError] = useState("");

  async function guard(fn: () => Promise<void>) {
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
  }
  async function onSave(patch: PropertyPatch, id: string | null) {
    if (!selected) return;
    if (id) await updateProperty(id, patch); else await createProperty(selected.id, patch);
    setEditing(null); reload();
  }
  async function makeDefault(p: Property) {
    await guard(async () => { if (selected) { await setDefaultProperty(selected.id, p.id); reload(); } });
  }
  async function toggleActive(p: Property) {
    await guard(async () => { await updateProperty(p.id, { active: !p.active }); reload(); });
  }

  if (DEMO_MODE) {
    return (<section className="screen"><h1 className="screen__title">Properties</h1>
      <p className="screen__deck">Property editing requires a live backend — not available in demo mode.</p></section>);
  }

  return (
    <section className="screen">
      <div className="methodology__head">
        <div>
          <h1 className="screen__title">Properties</h1>
          <p className="screen__deck">Manage the properties in {selected?.name ?? "this transition"}. Edits update filters, scope labels, and dropdowns immediately.</p>
        </div>
        <div className="methodology__actions">
          <button className="adminform__btn adminform__btn--ghost" onClick={() => setEditing("new")}>+ Add property</button>
        </div>
      </div>

      {error && <div className="loadbar" role="alert"><span className="loadbar__msg">{error}</span></div>}

      <div className="wi__tablewrap">
        <table className="wi__table">
          <thead><tr>
            <th className="wi__th">Name</th><th className="wi__th">City / State</th><th className="wi__th">Units</th>
            <th className="wi__th">Type</th><th className="wi__th">Status</th><th className="wi__th">Default</th><th className="wi__th"></th>
          </tr></thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id} className={"wi__row" + (p.active ? "" : " methodology__archived")}>
                <td className="wi__td wi__code" onClick={() => setEditing(p)}>{p.name}</td>
                <td className="wi__td" onClick={() => setEditing(p)}>{[p.city, p.state].filter(Boolean).join(", ")}</td>
                <td className="wi__td" onClick={() => setEditing(p)}>{p.units ?? "—"}</td>
                <td className="wi__td" onClick={() => setEditing(p)}>{p.propertyType ?? "—"}</td>
                <td className="wi__td">
                  <button className="methodology__reorder" onClick={() => void toggleActive(p)} style={{ padding: "2px 8px" }}>
                    {p.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="wi__td">
                  {selected?.defaultPropertyId === p.id
                    ? <span className="wi__flag wi__flag--gate">Default</span>
                    : <button className="sync__ignore" onClick={() => void makeDefault(p)}>Set default</button>}
                </td>
                <td className="wi__td"><button className="sync__ignore" onClick={() => setEditing(p)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {properties.length === 0 && <div className="wi__empty">No properties yet. Add one to get started.</div>}
      </div>

      {editing !== null && (
        <PropertyDetail property={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={onSave} />
      )}
    </section>
  );
}
