import { useEffect, useMemo, useState } from "react";
import type { WorkItem, WorkItemPatch } from "../work-items/types";
import type { WorkOwner } from "../types";
import { STATUSES, RESP_PARTIES, statusColor } from "../work-items/constants";

export function WorkItemDetail({ item, allItems, transitionName, propertyName, owners, onClose, onSave }: {
  item: WorkItem;
  allItems: WorkItem[];
  transitionName: string;
  propertyName: string;
  owners: WorkOwner[]; // active roster; the item's current owner is always shown too, even if inactive/removed
  onClose: () => void;
  onSave: (patch: WorkItemPatch) => Promise<WorkItem>;
}) {
  const [status, setStatus] = useState(item.status);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [resp, setResp] = useState(item.responsibleParty ?? "");
  const [due, setDue] = useState(item.dueDate ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [link, setLink] = useState(item.dropboxLink ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStatus(item.status); setOwner(item.owner ?? ""); setResp(item.responsibleParty ?? "");
    setDue(item.dueDate ?? ""); setNotes(item.notes ?? ""); setLink(item.dropboxLink ?? "");
    setSaved(false); setError("");
  }, [item]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Resolve dependency across scope: prefer same property or a transition-level item.
  const dep = item.dependsOnCode
    ? (allItems.find((w) => w.code === item.dependsOnCode && (w.propertyId === item.propertyId || w.scopeType === "transition"))
       ?? allItems.find((w) => w.code === item.dependsOnCode))
    : null;

  const dirty =
    status !== item.status || (owner || null) !== (item.owner || null) ||
    (resp || null) !== (item.responsibleParty || null) || (due || null) !== (item.dueDate || null) ||
    (notes || null) !== (item.notes || null) || (link || null) !== (item.dropboxLink || null);

  async function save() {
    setSaving(true); setError("");
    const patch: WorkItemPatch = {};
    if (status !== item.status) patch.status = status;
    if ((owner || null) !== (item.owner || null)) patch.owner = owner || null;
    if ((resp || null) !== (item.responsibleParty || null)) patch.responsible_party = resp || null;
    if ((due || null) !== (item.dueDate || null)) patch.due_date = due || null;
    if ((notes || null) !== (item.notes || null)) patch.notes = notes || null;
    if ((link || null) !== (item.dropboxLink || null)) patch.dropbox_link = link || null;
    try { await onSave(patch); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  const scopeLabel = item.scopeType === "transition" ? "Shared (transition-wide)" : "Property-specific";

  // Always include the item's current owner even if it's since been
  // deactivated or removed from the roster, so history is never hidden.
  const ownerOptions = useMemo(() => {
    const names = owners.map((o) => o.displayName);
    return item.owner && !names.includes(item.owner) ? [item.owner, ...names] : names;
  }, [owners, item.owner]);

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={`Work item ${item.code}`}>
        <div className="panel__head">
          <div>
            <div className="panel__code">{item.code}
              <span className={"wi__scope " + (item.scopeType === "transition" ? "wi__scope--shared" : "wi__scope--prop")}>
                {item.scopeType === "transition" ? "Shared" : propertyName}
              </span>
              {item.criticalPath && <span className="wi__flag wi__flag--crit">Critical path</span>}
              {item.goLiveGate && <span className="wi__flag wi__flag--gate">Go-live gate</span>}
            </div>
            <h2 className="panel__title">{item.description}</h2>
          </div>
          <button className="panel__close" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <div className="panel__body">
          {item.completionStandard && (
            <div className="panel__block">
              <div className="panel__label">Completion standard</div>
              <p className="panel__text">{item.completionStandard}</p>
            </div>
          )}

          <div className="panel__grid">
            <Meta label="Transition" value={transitionName} />
            <Meta label="Scope" value={scopeLabel} />
            <Meta label="Property" value={item.scopeType === "property" ? propertyName : "—"} />
            <Meta label="Phase" value={item.phase} />
            <Meta label="Workstream" value={item.workstream} />
            <Meta label="Priority" value={item.priority} />
          </div>

          <div className="panel__block">
            <div className="panel__label">Depends on</div>
            <p className="panel__text">
              {item.dependsOnCode
                ? `${item.dependsOnCode} · ${dep ? dep.description : "(not found in this transition)"}`
                : "No dependency"}
            </p>
          </div>

          <hr className="panel__rule" />

          <Field label="Status">
            <select className="panel__input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((st) => <option key={st}>{st}</option>)}
            </select>
          </Field>
          <Field label="Owner">
            <select className="panel__input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">—</option>{ownerOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Responsible party">
            <select className="panel__input" value={resp} onChange={(e) => setResp(e.target.value)}>
              <option value="">—</option>{RESP_PARTIES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Due date">
            <input className="panel__input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea className="panel__input panel__textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
          <Field label="Dropbox link">
            <input className="panel__input" type="url" placeholder="https://www.dropbox.com/…"
              value={link} onChange={(e) => setLink(e.target.value)} />
          </Field>

          <div className="panel__meta2">
            <span className="panel__statusdot" style={{ background: statusColor(item.status) }} />
            {item.completedAt ? `Completed ${item.completedAt.slice(0, 10)}` : "Not yet complete"}
            {item.updatedAt && ` · updated ${item.updatedAt.slice(0, 10)}`}
          </div>
          {error && <p className="panel__error">{error}</p>}
        </div>

        <div className="panel__foot">
          {saved && !dirty && <span className="panel__saved">Saved</span>}
          <button className="panel__cancel" onClick={onClose}>Close</button>
          <button className="panel__save" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="panel__field"><span className="panel__label">{label}</span>{children}</label>;
}
function Meta({ label, value }: { label: string; value: string | null }) {
  return <div><div className="panel__label">{label}</div><div className="panel__metaval">{value ?? "—"}</div></div>;
}
