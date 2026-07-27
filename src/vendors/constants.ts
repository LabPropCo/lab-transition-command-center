import type { OnboardingPath, NotUsingReason, W9Status, CoiStatus, TriState, VendorAuditEntry, VendorSource } from "./types";

export const ONBOARDING_PATHS: OnboardingPath[] = ["Unreviewed", "Needs Onboarding", "Already in Yardi", "Not Using"];
export const NOT_USING_REASONS: NotUsingReason[] =
  ["Replaced by preferred vendor", "Service no longer needed", "Duplicate", "Corporate vendor or contract", "Other"];
export const W9_STATUSES: W9Status[] = ["Not Requested", "Requested", "Received", "Uploaded to Yardi"];
export const COI_STATUSES: CoiStatus[] = ["Not Requested", "Requested", "Received", "Uploaded to Yardi", "N/A"];
export const TRI_STATES: TriState[] = ["Unknown", "Yes", "No"];

// A short, readable "time ago" — this page is an operational worklist, not an
// archive, so relative phrasing ("Yesterday", "3 days ago") reads better than
// a raw timestamp for anything recent.
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

const FIELD_LABELS: Record<string, (oldV: string | null, newV: string | null) => string> = {
  onboarding_path: (_o, n) => `Marked ${n}`,
  w9_status: (_o, n) => `W-9 ${(n ?? "").toLowerCase()}`,
  coi_status: (_o, n) => (n === "N/A" ? "COI marked N/A" : `COI ${(n ?? "").toLowerCase()}`),
  yardi_vendor_created: (_o, n) => (n === "true" ? "Created in Yardi" : "Removed from Yardi"),
  yardi_vendor_id: () => "Yardi vendor ID recorded",
  vendor_type_id: () => "Vendor type classified",
  blocked: (_o, n) => (n === "true" ? "Marked blocked" : "Unblocked"),
  contract_exists: (_o, n) => `Contract exists: ${n}`,
  contract_copy_received: (_o, n) => `Contract copy received: ${n}`,
  contract_uploaded_dropbox: (_o, n) => `Contract uploaded to Dropbox: ${n}`,
  notes: () => "Notes updated",
  primary_contact: () => "Contact updated",
  phone: () => "Contact updated",
  email: () => "Contact updated",
};

// The newest thing that happened to this vendor, in plain language — read-only,
// synthesized from vendor_audit_log (field changes) and, if there's no audit
// history yet, vendor_sources (how it first showed up). Never a stored value —
// this is display-only and never duplicates the audit data itself.
export function lastActivity(
  vendorId: string,
  audit: VendorAuditEntry[],
  sources: VendorSource[],
  createdAt: string,
): { text: string; when: string } | null {
  const latest = audit.find((a) => a.vendorId === vendorId);
  if (latest) {
    const describe = latest.field ? FIELD_LABELS[latest.field] : null;
    const text = describe ? describe(latest.oldValue, latest.newValue) : `${latest.field ?? "Updated"} changed`;
    return { text, when: timeAgo(latest.createdAt) };
  }
  const earliestSource = sources
    .filter((s) => s.vendorId === vendorId)
    .sort((a, b) => a.importDate.localeCompare(b.importDate))[0];
  if (earliestSource) return { text: "Imported from spreadsheet", when: timeAgo(earliestSource.importDate) };
  return { text: "Added", when: timeAgo(createdAt) };
}
