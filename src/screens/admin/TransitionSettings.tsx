import { useEffect, useRef, useState } from "react";
import { useTransition } from "../../transitions/TransitionProvider";
import { updateTransitionSettings, uploadLogo, type TransitionSettingsPatch } from "../../admin/api";
import "../../styles/admin.css";

const STATUS_OPTIONS = ["On Track", "At Risk", "Delayed", "On Hold", "Complete"];

export function TransitionSettings() {
  const { selected, properties, reload } = useTransition();

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [goLive, setGoLive] = useState("");
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState("");
  const [cdName, setCdName] = useState("");
  const [tm, setTm] = useState("");
  const [rm, setRm] = useState("");
  const [defaultProp, setDefaultProp] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate the form from the selected transition.
  useEffect(() => {
    if (!selected) return;
    setName(selected.name ?? "");
    setCompany(selected.companyName ?? "");
    setGoLive(selected.targetGoLive ?? "");
    setStatus(selected.overallStatus ?? "");
    setPhase(selected.currentPhase ?? "");
    setCdName(selected.communityDirectorName ?? "");
    setTm(selected.transitionManager ?? "");
    setRm(selected.regionalManager ?? "");
    setDefaultProp(selected.defaultPropertyId ?? "");
    setPrimary(selected.primaryColor ?? "");
    setSecondary(selected.secondaryColor ?? "");
    setLogoUrl(selected.logoUrl ?? "");
    setNotes(selected.notes ?? "");
    setSaved(false); setError("");
  }, [selected]);

  if (!selected) return <section className="screen"><p className="screen__deck">No transition selected.</p></section>;

  const norm = (v: string) => (v.trim() === "" ? null : v.trim());

  async function onSave() {
    if (!selected) return;
    setSaving(true); setError(""); setSaved(false);
    const patch: TransitionSettingsPatch = {
      name: name.trim() || selected.name,
      company_name: norm(company),
      target_go_live_date: norm(goLive),
      overall_status: norm(status),
      current_phase: norm(phase),
      community_director_name: norm(cdName),   // free text; community_director_id left as-is for a future release
      transition_manager: norm(tm),
      regional_manager: norm(rm),
      default_property_id: defaultProp || null,
      primary_color: norm(primary),
      secondary_color: norm(secondary),
      logo_url: norm(logoUrl),
      notes: norm(notes),
    };
    try {
      await updateTransitionSettings(selected.id, patch);
      reload();               // propagate to top bar, title, countdown, nav
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setUploading(true); setError("");
    try {
      const url = await uploadLogo(selected.id, file);
      setLogoUrl(url);
      await updateTransitionSettings(selected.id, { logo_url: url });
      reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="screen">
      <h1 className="screen__title">Transition Settings</h1>
      <p className="screen__deck">Edit transition metadata. Changes propagate across the app on save.</p>
      {error && <div className="loadbar" role="alert"><span className="loadbar__msg">{error}</span></div>}

      <div className="adminform">
        <div className="adminform__grid">
          <Field label="Transition name">
            <input className="adminform__input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Company name">
            <input className="adminform__input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
          <Field label="Go-live date">
            <input className="adminform__input" type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} />
          </Field>
          <Field label="Transition status">
            <select className="adminform__input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">—</option>
              {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Current phase">
            <input className="adminform__input" value={phase} onChange={(e) => setPhase(e.target.value)} />
          </Field>
          <Field label="Default property">
            <select className="adminform__input" value={defaultProp} onChange={(e) => setDefaultProp(e.target.value)}>
              <option value="">—</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Community Director">
            <input className="adminform__input" placeholder="e.g. Jane Smith" value={cdName} onChange={(e) => setCdName(e.target.value)} />
          </Field>
          <Field label="Transition manager">
            <input className="adminform__input" value={tm} onChange={(e) => setTm(e.target.value)} />
          </Field>
          <Field label="Regional manager">
            <input className="adminform__input" value={rm} onChange={(e) => setRm(e.target.value)} />
          </Field>
          <Field label="Primary color">
            <div className="adminform__color">
              <input type="color" value={primary || "#A8813B"} onChange={(e) => setPrimary(e.target.value)} />
              <input className="adminform__input" placeholder="#A8813B" value={primary} onChange={(e) => setPrimary(e.target.value)} />
            </div>
          </Field>
          <Field label="Secondary color">
            <div className="adminform__color">
              <input type="color" value={secondary || "#9C7C52"} onChange={(e) => setSecondary(e.target.value)} />
              <input className="adminform__input" placeholder="#9C7C52" value={secondary} onChange={(e) => setSecondary(e.target.value)} />
            </div>
          </Field>
          <Field label="Logo">
            <div className="adminform__logo">
              {logoUrl ? <img className="adminform__logoimg" src={logoUrl} alt="Transition logo" /> : <span className="adminform__logonone">No logo</span>}
              <input className="adminform__input" placeholder="https://… or upload" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              <input ref={fileRef} type="file" accept="image/*" onChange={onLogoFile} hidden />
              <button className="adminform__btn adminform__btn--ghost" type="button"
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </Field>
        </div>

        <div className="adminform__field--full"><Field label="Notes">
          <textarea className="adminform__input adminform__textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field></div>

        <div className="adminform__foot">
          {saved && <span className="adminform__saved">Saved</span>}
          <button className="adminform__btn" onClick={() => void onSave()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="adminform__field"><span className="adminform__label">{label}</span>{children}</label>;
}
