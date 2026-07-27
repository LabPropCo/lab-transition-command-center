import { useEffect, useMemo, useState, useCallback } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import {
  listVendors, listAllVendorTypes, listVendorSources, listVendorAudit,
  updateVendor, createVendorWithSource, addVendorSource,
} from "../vendors/api";
import type { Vendor, VendorPatch, VendorType, VendorSource, VendorAuditEntry } from "../vendors/types";
import { deriveWorkflowStatus, groupVendors, WORKFLOW_GROUP_ORDER } from "../vendors/workflow";
import type { WorkflowStatus } from "../vendors/types";
import { lastActivity } from "../vendors/constants";
import { VendorDetail } from "../components/VendorDetail";
import { VendorImport } from "../components/VendorImport";
import { SCREENS } from "../lib/nav";
import "../styles/vendors.css";

const GROUP_TITLES: Record<Exclude<WorkflowStatus, "Complete">, string> = {
  "Blocked": "Blocked",
  "Needs Decision": "Needs decision",
  "Needs Classification": "Needs classification",
  "Needs Contact": "Needs contact",
  "Documents Pending": "Documents pending",
  "Ready for Yardi": "Ready for Yardi",
  "Yardi Setup Pending": "Yardi setup pending",
  "Contract Review": "Contract review",
};

export function Vendors() {
  const { selected, properties } = useTransition();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorTypes, setVendorTypes] = useState<VendorType[]>([]);
  const [allVendorTypes, setAllVendorTypes] = useState<VendorType[]>([]);
  const [sources, setSources] = useState<VendorSource[]>([]);
  const [audit, setAudit] = useState<VendorAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showNotUsing, setShowNotUsing] = useState(false);

  const transitionId = selected?.id ?? null;

  const load = useCallback(() => {
    if (!transitionId) { setVendors([]); setLoading(false); return; }
    setLoading(true); setErr("");
    Promise.all([listVendors(transitionId), listAllVendorTypes(), listVendorAudit(transitionId)])
      .then(([v, t, a]) => {
        setVendors(v); setAllVendorTypes(t); setAudit(a);
        setVendorTypes(t.filter((x) => x.active));
        return listVendorSources(v.map((x) => x.id));
      })
      .then((s) => { setSources(s); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : "Failed to load"); setLoading(false); });
  }, [transitionId]);
  useEffect(() => { load(); }, [load]);

  const typeName = useMemo(() => {
    const m = new Map(allVendorTypes.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [allVendorTypes]);

  // Property filter narrows to vendors with a matching vendor_sources row —
  // provenance only, never how the vendor set itself is scoped.
  const scoped = useMemo(() => {
    if (propertyFilter === "all") return vendors;
    const idsForProperty = new Set(sources.filter((s) => s.propertyId === propertyFilter).map((s) => s.vendorId));
    return vendors.filter((v) => idsForProperty.has(v.id));
  }, [vendors, sources, propertyFilter]);

  const groups = useMemo(() => groupVendors(scoped), [scoped]);

  const propertiesFor = useCallback((vendorId: string) => {
    const names = new Map(properties.map((p) => [p.id, p.name]));
    return sources.filter((s) => s.vendorId === vendorId && s.propertyId)
      .map((s) => names.get(s.propertyId!)).filter(Boolean) as string[];
  }, [properties, sources]);

  async function applyPatch(id: string, patch: VendorPatch) {
    const prev = vendors;
    try {
      const updated = await updateVendor(id, patch);
      setVendors((list) => list.map((v) => (v.id === id ? updated : v)));
      return updated;
    } catch (e) {
      setVendors(prev);
      setErr(e instanceof Error ? e.message : "Update failed — you may not have edit access.");
      throw e;
    }
  }

  const open = vendors.find((v) => v.id === openId) ?? null;
  const s = SCREENS.vendors;

  function renderRow(v: Vendor) {
    const status = deriveWorkflowStatus(v);
    const act = lastActivity(v.id, audit, sources, v.createdAt);
    const props = propertiesFor(v.id);
    return (
      <li key={v.id} className="ven__row" onClick={() => setOpenId(v.id)}>
        <div className="ven__row-main">
          <div className="ven__row-title">{v.name}</div>
          <div className="ven__row-meta">
            {typeName(v.vendorTypeId)}
            {props.length > 0 ? ` · ${props.join(", ")}` : ""}
          </div>
        </div>
        {act && (
          <div className="ven__row-activity">
            <span className="ven__row-activity-text">{act.text}</span>
            <span className="ven__row-activity-when">{act.when}</span>
          </div>
        )}
        {status === "Blocked" && v.blockedReason && <div className="ven__row-blocked">{v.blockedReason}</div>}
      </li>
    );
  }

  function renderSection(key: Exclude<WorkflowStatus, "Complete">) {
    const list = groups.byStatus[key];
    if (list.length === 0) return null;
    return (
      <section className="ven__group" key={key}>
        <h2 className="ven__group-title">{GROUP_TITLES[key]}</h2>
        <ol className="ven__list">{list.map(renderRow)}</ol>
      </section>
    );
  }

  return (
    <section className="screen ven">
      <div className="ven__hero">
        <h1 className="screen__title">{s.title}</h1>
        <p className="screen__deck">{s.deck}</p>
        <div className="ven__hero-actions">
          {properties.length > 0 && (
            <select className="ven__filter" value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
              <option value="all">All properties</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button type="button" className="ven__import-btn" onClick={() => setImportOpen(true)}>+ Import vendors</button>
        </div>
      </div>

      {err && <p className="ven__err">{err}</p>}
      {loading && !err && <p className="ven__loading">Loading…</p>}

      {!loading && !err && (
        vendors.length === 0 ? (
          <p className="ven__empty">No vendors yet for this transition. Import a spreadsheet to get started.</p>
        ) : (
          <>
            <div className="ven__stats">
              <div className="ven__stat"><div className="ven__stat-value">{groups.counts.total}</div><div className="ven__stat-label">Total</div></div>
              <div className="ven__stat"><div className="ven__stat-value">{groups.counts.needsAttention}</div><div className="ven__stat-label">Needs attention</div></div>
              <div className="ven__stat"><div className="ven__stat-value">{groups.counts.blocked}</div><div className="ven__stat-label">Blocked</div></div>
              <div className="ven__stat"><div className="ven__stat-value">{groups.counts.complete}</div><div className="ven__stat-label">Complete</div></div>
            </div>

            <div className="ven__body">
              {WORKFLOW_GROUP_ORDER.map(renderSection)}

              {groups.notUsing.length > 0 && (
                <section className="ven__group ven__group--quiet">
                  <h2 className="ven__group-title" onClick={() => setShowNotUsing((v) => !v)} role="button">
                    Not using ({groups.notUsing.length}) {showNotUsing ? "▾" : "▸"}
                  </h2>
                  {showNotUsing && <ol className="ven__list">{groups.notUsing.map(renderRow)}</ol>}
                </section>
              )}

              {groups.complete.length > 0 && (
                <section className="ven__group ven__group--quiet">
                  <h2 className="ven__group-title" onClick={() => setShowComplete((v) => !v)} role="button">
                    Complete ({groups.complete.length}) {showComplete ? "▾" : "▸"}
                  </h2>
                  {showComplete && <ol className="ven__list">{groups.complete.map(renderRow)}</ol>}
                </section>
              )}
            </div>
          </>
        )
      )}

      {open && (
        <VendorDetail
          vendor={open}
          vendorTypes={vendorTypes}
          typeName={typeName}
          onClose={() => setOpenId(null)}
          onSave={(patch) => applyPatch(open.id, patch)}
        />
      )}

      {importOpen && transitionId && (
        <VendorImport
          properties={properties}
          existingVendors={vendors}
          onClose={() => setImportOpen(false)}
          onCreate={(name, source) => createVendorWithSource(transitionId, name, source)}
          onLink={(vendorId, source) => addVendorSource(vendorId, source)}
          onDone={() => { setImportOpen(false); load(); }}
        />
      )}
    </section>
  );
}
