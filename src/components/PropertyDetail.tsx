import { useEffect, useState } from "react";
import type { Property } from "../types";
import type { PropertyPatch } from "../admin/api";

const empty: PropertyPatch = { name: "", active: true };

export function PropertyDetail({ property, onClose, onSave }: {
  property: Property | null;            // null = new
  onClose: () => void;
  onSave: (patch: PropertyPatch, id: string | null) => Promise<void>;
}) {
  const isNew = property === null;
  const [f, setF] = useState<PropertyPatch>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    if (property) {
      setF({
        name: property.name, address: property.address, city: property.city, state: property.state,
        zip: property.zip, units: property.units ?? null, property_type: property.propertyType,
        notes: property.notes, active: property.active,
      });
    } else setF(empty);
  }, [property]);

  const set = (k: keyof PropertyPatch, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setError("");
    if (!f.name?.trim()) { setError("Property name is required."); return; }
    setSaving(true);
    try { await onSave(f, property?.id ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={isNew ? "New property" : `Edit ${property?.name}`}>
        <div className="panel__head">
          <div>
            <div className="panel__code">Property{property && !property.active ? " · Inactive" : ""}</div>
            <h2 className="panel__title">{isNew ? "Add property" : "Edit property"}</h2>
          </div>
          <button className="panel__close" onClick={onClose}>Close</button>
        </div>

        <div className="panel__body">
          {error && <p className="panel__error">{error}</p>}
          <label className="panel__field"><span className="panel__label">Property name</span>
            <input className="panel__input" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="panel__field"><span className="panel__label">Address</span>
            <input className="panel__input" value={f.address ?? ""} onChange={(e) => set("address", e.target.value || null)} /></label>
          <div className="panel__grid">
            <label className="panel__field"><span className="panel__label">City</span>
              <input className="panel__input" value={f.city ?? ""} onChange={(e) => set("city", e.target.value || null)} /></label>
            <label className="panel__field"><span className="panel__label">State</span>
              <input className="panel__input" value={f.state ?? ""} onChange={(e) => set("state", e.target.value || null)} /></label>
            <label className="panel__field"><span className="panel__label">ZIP</span>
              <input className="panel__input" value={f.zip ?? ""} onChange={(e) => set("zip", e.target.value || null)} /></label>
            <label className="panel__field"><span className="panel__label">Unit count</span>
              <input className="panel__input" type="number" value={f.units ?? ""} onChange={(e) => set("units", e.target.value === "" ? null : Number(e.target.value))} /></label>
            <label className="panel__field"><span className="panel__label">Property type</span>
              <input className="panel__input" value={f.property_type ?? ""} onChange={(e) => set("property_type", e.target.value || null)} /></label>
            <label className="panel__field"><span className="panel__label">Status</span>
              <select className="panel__input" value={f.active ? "active" : "inactive"} onChange={(e) => set("active", e.target.value === "active")}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select></label>
          </div>
          <label className="panel__field"><span className="panel__label">Notes</span>
            <textarea className="panel__input panel__textarea" rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} /></label>
        </div>

        <div className="panel__foot">
          <button className="panel__cancel" onClick={onClose}>Cancel</button>
          <button className="panel__save" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </aside>
    </>
  );
}
