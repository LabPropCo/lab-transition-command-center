import { useEffect, useMemo, useState } from "react";
import type { Template, TemplatePatch } from "../methodology/types";
import type { ScopeType, WorkOwner } from "../types";
import { RESP_PARTIES } from "../work-items/constants";

const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const SCOPES: ScopeType[] = ["transition", "property"];

const empty: TemplatePatch = {
  code: "", description: "", scope_type: "property", priority: "Medium",
  go_live_gate: false, critical_path: false,
};

export function TemplateDetail({ template, workstreams, phases, owners, onClose, onSave, onDelete, onDuplicate, onToggleArchive }: {
  template: Template | null;              // null = create new
  workstreams: string[];
  phases: string[];
  owners: WorkOwner[]; // active roster; the template's current default owner is always shown too, even if inactive/removed
  onClose: () => void;
  onSave: (patch: TemplatePatch, id: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (t: Template) => Promise<void>;
  onToggleArchive: (t: Template) => Promise<void>;
}) {
  const isNew = template === null;
  const [f, setF] = useState<TemplatePatch>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ownerOptions = useMemo(() => {
    const names = owners.map((o) => o.displayName);
    return f.default_owner && !names.includes(f.default_owner) ? [f.default_owner, ...names] : names;
  }, [owners, f.default_owner]);

  useEffect(() => {
    setError("");
    if (template) {
      setF({
        code: template.code, description: template.description, completion_standard: template.completionStandard,
        workstream: template.workstream, sub_workstream: template.subWorkstream, phase: template.phase,
        phase_order: template.phaseOrder, priority: template.priority, default_owner: template.defaultOwner,
        responsible_party: template.responsibleParty, go_live_gate: template.goLiveGate,
        critical_path: template.criticalPath, stage: template.stage, depends_on_code: template.dependsOnCode,
        scope_type: template.scopeType, due_offset_days: template.dueOffsetDays, sort_order: template.sortOrder,
      });
    } else {
      setF(empty);
    }
  }, [template]);

  const set = (k: keyof TemplatePatch, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setError("");
    if (!f.code?.trim()) { setError("Template ID is required."); return; }
    if (!f.description?.trim()) { setError("Name / description is required."); return; }
    setSaving(true);
    try { await onSave(f, template?.id ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={isNew ? "New master work item" : `Edit ${template?.code}`}>
        <div className="panel__head">
          <div>
            <div className="panel__code">
              {isNew ? "New master work item" : template?.code}
              {template?.archived && <span className="wi__flag wi__flag--gate">Archived</span>}
            </div>
            <h2 className="panel__title">{isNew ? "Create methodology item" : "Edit methodology item"}</h2>
          </div>
          <button className="panel__close" onClick={onClose}>Close</button>
        </div>

        <div className="panel__body">
          {error && <p className="panel__error">{error}</p>}

          <div className="panel__grid">
            <Lbl t="Template ID"><input className="panel__input" value={f.code ?? ""} onChange={(e) => set("code", e.target.value)} /></Lbl>
            <Lbl t="Scope">
              <select className="panel__input" value={f.scope_type} onChange={(e) => set("scope_type", e.target.value)}>
                {SCOPES.map((s) => <option key={s} value={s}>{s === "transition" ? "Shared (transition)" : "Property"}</option>)}
              </select>
            </Lbl>
          </div>

          <Field t="Name / description">
            <input className="panel__input" value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field t="Instructions / completion standard">
            <textarea className="panel__input panel__textarea" rows={3} value={f.completion_standard ?? ""} onChange={(e) => set("completion_standard", e.target.value)} />
          </Field>

          <div className="panel__grid">
            <Lbl t="Workstream">
              <input className="panel__input" list="ws-list" value={f.workstream ?? ""} onChange={(e) => set("workstream", e.target.value)} />
              <datalist id="ws-list">{workstreams.map((w) => <option key={w} value={w} />)}</datalist>
            </Lbl>
            <Lbl t="Phase">
              <input className="panel__input" list="ph-list" value={f.phase ?? ""} onChange={(e) => set("phase", e.target.value)} />
              <datalist id="ph-list">{phases.map((p) => <option key={p} value={p} />)}</datalist>
            </Lbl>
            <Lbl t="Priority">
              <select className="panel__input" value={f.priority ?? ""} onChange={(e) => set("priority", e.target.value)}>
                <option value="">—</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Lbl>
            <Lbl t="Owner role (responsible)">
              <select className="panel__input" value={f.responsible_party ?? ""} onChange={(e) => set("responsible_party", e.target.value || null)}>
                <option value="">—</option>{RESP_PARTIES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Lbl>
            <Lbl t="Default owner">
              <select className="panel__input" value={f.default_owner ?? ""} onChange={(e) => set("default_owner", e.target.value || null)}>
                <option value="">—</option>{ownerOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Lbl>
            <Lbl t="Due offset (days from go-live)">
              <input className="panel__input" type="number" value={f.due_offset_days ?? ""} onChange={(e) => set("due_offset_days", e.target.value === "" ? null : Number(e.target.value))} />
            </Lbl>
            <Lbl t="Depends on (code)">
              <input className="panel__input" value={f.depends_on_code ?? ""} onChange={(e) => set("depends_on_code", e.target.value || null)} />
            </Lbl>
            <Lbl t="Display / sort order">
              <input className="panel__input" type="number" value={f.sort_order ?? ""} onChange={(e) => set("sort_order", e.target.value === "" ? null : Number(e.target.value))} />
            </Lbl>
          </div>

          <div className="panel__checks">
            <label className="panel__check"><input type="checkbox" checked={!!f.go_live_gate} onChange={(e) => set("go_live_gate", e.target.checked)} /> Go-live gate</label>
            <label className="panel__check"><input type="checkbox" checked={!!f.critical_path} onChange={(e) => set("critical_path", e.target.checked)} /> Critical path</label>
          </div>
        </div>

        <div className="panel__foot panel__foot--split">
          <div className="panel__foot-left">
            {!isNew && template && (
              <>
                <button className="panel__cancel" onClick={() => void onDuplicate(template)}>Duplicate</button>
                <button className="panel__cancel" onClick={() => void onToggleArchive(template)}>{template.archived ? "Restore" : "Archive"}</button>
                <button className="panel__danger" onClick={() => void onDelete(template.id)}>Delete</button>
              </>
            )}
          </div>
          <div className="panel__foot-right">
            <button className="panel__cancel" onClick={onClose}>Cancel</button>
            <button className="panel__save" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Field({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="panel__field"><span className="panel__label">{t}</span>{children}</label>;
}
function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <div className="panel__field"><span className="panel__label">{t}</span>{children}</div>;
}
