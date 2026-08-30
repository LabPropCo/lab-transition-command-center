import { useEffect, useMemo, useState } from "react";
import type { Vendor, VendorPatch, VendorType } from "../vendors/types";
import { ONBOARDING_PATHS, NOT_USING_REASONS, W9_STATUSES, COI_STATUSES, TRI_STATES } from "../vendors/constants";
import { deriveWorkflowStatus } from "../vendors/workflow";
import { useAuth } from "../auth/AuthProvider";

export function VendorDetail({ vendor, vendorTypes, typeName, onClose, onSave }: {
  vendor: Vendor;
  vendorTypes: VendorType[];
  typeName: (id: string | null) => string;
  onClose: () => void;
  onSave: (patch: VendorPatch) => Promise<Vendor>;
}) {
  const { user } = useAuth();
  const [f, setF] = useState(vendor);
  const [showBlocked, setShowBlocked] = useState(vendor.blocked);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setF(vendor); setShowBlocked(vendor.blocked); setSaved(false); setError(""); }, [vendor]);

  const typeOptions = useMemo(() => {
    const names = vendorTypes.map((t) => t.id);
    return f.vendorTypeId && !names.includes(f.vendorTypeId) ? [f.vendorTypeId, ...names] : names;
  }, [vendorTypes, f.vendorTypeId]);

  function set<K extends keyof Vendor>(k: K, v: Vendor[K]) {
    setF((p) => ({ ...p, [k]: v }));
    setSaved(false);
  }

  // App-level rule (not a DB constraint): blocked clears when the path moves
  // to Unreviewed or Not Using — there's nothing left to be blocked on.
  function setPath(path: Vendor["onboardingPath"]) {
    setF((p) => {
      const next = { ...p, onboardingPath: path };
      if (path === "Unreviewed" || path === "Not Using") {
        next.blocked = false; next.blockedReason = null; next.waitingOnParty = null;
      }
      return next;
    });
    if (path === "Unreviewed" || path === "Not Using") setShowBlocked(false);
    setSaved(false);
  }

  const dirty = JSON.stringify(f) !== JSON.stringify(vendor);

  async function save() {
    setError(""); setSaving(true);
    const patch: VendorPatch = {
      name: f.name,
      vendor_type_id: f.vendorTypeId,
      primary_contact: f.primaryContact, phone: f.phone, email: f.email,
      onboarding_path: f.onboardingPath,
      not_using_reason: f.onboardingPath === "Not Using" ? f.notUsingReason : null,
      w9_status: f.w9Status, coi_status: f.coiStatus,
      coi_na_reason: f.coiStatus === "N/A" ? f.coiNaReason : null,
      yardi_vendor_created: f.yardiVendorCreated,
      yardi_vendor_id: f.yardiVendorId, yardi_verified_by: f.yardiVerifiedBy, yardi_verified_at: f.yardiVerifiedAt,
      contract_exists: f.contractExists, contract_copy_received: f.contractCopyReceived,
      contract_uploaded_dropbox: f.contractUploadedDropbox, dropbox_link: f.dropboxLink,
      blocked: showBlocked, blocked_reason: showBlocked ? f.blockedReason : null,
      waiting_on_party: showBlocked ? f.waitingOnParty : null,
      notes: f.notes,
    };
    try { await onSave(patch); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  function markVerified() {
    setF((p) => ({ ...p, yardiVerifiedBy: user?.id ?? p.yardiVerifiedBy, yardiVerifiedAt: new Date().toISOString() }));
    setSaved(false);
  }

  const path = f.onboardingPath;
  // showBlocked (the checkbox's pending state) is separate from f.blocked
  // (the last-saved value) so the checkbox can be unchecked without losing
  // the reason/waiting-on text underneath it; the live status preview needs
  // the pending value, not the stale saved one.
  const status = deriveWorkflowStatus({ ...f, blocked: showBlocked });
  const showContact = path !== "Not Using";
  const showContract = path !== "Not Using";
  const showOnboardingChecklist = path === "Needs Onboarding";
  const showAlreadyInYardi = path === "Already in Yardi";
  const canBlock = path === "Needs Onboarding" || path === "Already in Yardi";

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={`Vendor ${vendor.name}`}>
        <div className="panel__head">
          <div>
            <div className="panel__code">{status}</div>
            <h2 className="panel__title">{vendor.name}</h2>
          </div>
          <button className="panel__close" onClick={onClose}>Close</button>
        </div>

        <div className="panel__body">
          {error && <p className="panel__error">{error}</p>}

          <Field t="Vendor name">
            <input className="panel__input" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>

          <div className="panel__grid">
            <Lbl t="Vendor type">
              <select className="panel__input" value={f.vendorTypeId ?? ""} onChange={(e) => set("vendorTypeId", e.target.value || null)}>
                <option value="">—</option>
                {typeOptions.map((id) => <option key={id} value={id}>{typeName(id)}</option>)}
              </select>
            </Lbl>
            <Lbl t="Onboarding path">
              <select className="panel__input" value={path} onChange={(e) => setPath(e.target.value as Vendor["onboardingPath"])}>
                {ONBOARDING_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Lbl>
          </div>

          {path === "Not Using" && (
            <Field t="Reason">
              <select className="panel__input" value={f.notUsingReason ?? ""} onChange={(e) => set("notUsingReason", (e.target.value || null) as Vendor["notUsingReason"])}>
                <option value="">— select a reason —</option>
                {NOT_USING_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          )}

          {showContact && (
            <div className="panel__grid">
              <Lbl t="Primary contact"><input className="panel__input" value={f.primaryContact ?? ""} onChange={(e) => set("primaryContact", e.target.value || null)} /></Lbl>
              <Lbl t="Phone"><input className="panel__input" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} /></Lbl>
              <Lbl t="Email"><input className="panel__input" type="email" value={f.email ?? ""} onChange={(e) => set("email", e.target.value || null)} /></Lbl>
            </div>
          )}

          {showOnboardingChecklist && (
            <>
              <hr className="panel__rule" />
              <div className="panel__grid">
                <Lbl t="W-9 status">
                  <select className="panel__input" value={f.w9Status} onChange={(e) => set("w9Status", e.target.value as Vendor["w9Status"])}>
                    {W9_STATUSES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
                <Lbl t="COI status">
                  <select className="panel__input" value={f.coiStatus} onChange={(e) => set("coiStatus", e.target.value as Vendor["coiStatus"])}>
                    {COI_STATUSES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
              </div>
              {f.coiStatus === "N/A" && (
                <Field t="Reason COI is N/A">
                  <input className="panel__input" value={f.coiNaReason ?? ""} onChange={(e) => set("coiNaReason", e.target.value || null)} />
                </Field>
              )}
              <label className="panel__check">
                <input type="checkbox" checked={f.yardiVendorCreated} onChange={(e) => set("yardiVendorCreated", e.target.checked)} />
                Vendor created in Yardi
              </label>
            </>
          )}

          {showAlreadyInYardi && (
            <>
              <hr className="panel__rule" />
              <div className="panel__grid">
                <Lbl t="Yardi vendor ID"><input className="panel__input" value={f.yardiVendorId ?? ""} onChange={(e) => set("yardiVendorId", e.target.value || null)} /></Lbl>
                <Lbl t="Verified">
                  {f.yardiVerifiedBy ? (
                    <span className="panel__metaval">{f.yardiVerifiedAt ? new Date(f.yardiVerifiedAt).toLocaleDateString() : "Verified"}</span>
                  ) : (
                    <button type="button" className="panel__cancel" onClick={markVerified}>Mark as verified</button>
                  )}
                </Lbl>
              </div>
            </>
          )}

          {showContract && (
            <>
              <hr className="panel__rule" />
              <div className="panel__grid">
                <Lbl t="Contract exists">
                  <select className="panel__input" value={f.contractExists} onChange={(e) => set("contractExists", e.target.value as Vendor["contractExists"])}>
                    {TRI_STATES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
                <Lbl t="Copy received">
                  <select className="panel__input" value={f.contractCopyReceived} onChange={(e) => set("contractCopyReceived", e.target.value as Vendor["contractCopyReceived"])}>
                    {TRI_STATES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
                <Lbl t="Uploaded to Dropbox">
                  <select className="panel__input" value={f.contractUploadedDropbox} onChange={(e) => set("contractUploadedDropbox", e.target.value as Vendor["contractUploadedDropbox"])}>
                    {TRI_STATES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Lbl>
              </div>
              <Field t="Dropbox link">
                <input className="panel__input" type="url" placeholder="https://www.dropbox.com/…" value={f.dropboxLink ?? ""} onChange={(e) => set("dropboxLink", e.target.value || null)} />
              </Field>
            </>
          )}

          <hr className="panel__rule" />
          <label className="panel__check">
            <input type="checkbox" checked={showBlocked} disabled={!canBlock}
              onChange={(e) => { setShowBlocked(e.target.checked); setSaved(false); }} />
            Blocked{!canBlock && " (not applicable for this path)"}
          </label>
          {showBlocked && (
            <div className="panel__grid">
              <Lbl t="Reason"><input className="panel__input" value={f.blockedReason ?? ""} onChange={(e) => set("blockedReason", e.target.value || null)} /></Lbl>
              <Lbl t="Waiting on (optional)"><input className="panel__input" value={f.waitingOnParty ?? ""} onChange={(e) => set("waitingOnParty", e.target.value || null)} /></Lbl>
            </div>
          )}

          <Field t="Notes">
            <textarea className="panel__input panel__textarea" rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} />
          </Field>
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

function Field({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="panel__field"><span className="panel__label">{t}</span>{children}</label>;
}
function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <div className="panel__field"><span className="panel__label">{t}</span>{children}</div>;
}
