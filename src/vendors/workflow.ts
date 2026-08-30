// Derived vendor workflow status. Pure function, never stored — computed
// fresh from the vendor row every time, same principle as
// src/lib/metrics.ts (ARCHITECTURE.md §7). First-match-wins.
import type { Vendor, WorkflowStatus } from "./types";

function hasContact(v: Vendor): boolean {
  return Boolean((v.primaryContact ?? "").trim() || (v.phone ?? "").trim() || (v.email ?? "").trim());
}

export function deriveWorkflowStatus(v: Vendor): WorkflowStatus {
  if (v.onboardingPath === "Unreviewed") return "Needs Decision";
  if (v.blocked) return "Blocked";
  if (v.onboardingPath === "Not Using") return "Complete";

  if (v.onboardingPath === "Needs Onboarding") {
    if (!v.vendorTypeId) return "Needs Classification";
    if (!hasContact(v)) return "Needs Contact";

    const w9Received = v.w9Status === "Received" || v.w9Status === "Uploaded to Yardi";
    const coiReceived = v.coiStatus === "Received" || v.coiStatus === "Uploaded to Yardi"
      || (v.coiStatus === "N/A" && Boolean((v.coiNaReason ?? "").trim()));
    if (!(w9Received && coiReceived)) return "Documents Pending";

    if (!v.yardiVendorCreated) return "Ready for Yardi";

    const w9Uploaded = v.w9Status === "Uploaded to Yardi";
    const coiUploaded = v.coiStatus === "Uploaded to Yardi" || v.coiStatus === "N/A";
    if (!(w9Uploaded && coiUploaded)) return "Yardi Setup Pending";

    if (v.contractExists === "Unknown") return "Contract Review";
    return "Complete";
  }

  // Already in Yardi
  if (!v.vendorTypeId) return "Needs Classification";
  if (!hasContact(v)) return "Needs Contact";
  if (!v.yardiVendorId || !v.yardiVerifiedBy) return "Yardi Setup Pending";
  if (v.contractExists === "Unknown") return "Contract Review";
  return "Complete";
}

// Priority order for the main (non-collapsed) list sections.
export const WORKFLOW_GROUP_ORDER: Exclude<WorkflowStatus, "Complete">[] = [
  "Blocked", "Needs Decision", "Needs Classification", "Needs Contact",
  "Documents Pending", "Ready for Yardi", "Yardi Setup Pending", "Contract Review",
];

export interface VendorGroups {
  byStatus: Record<Exclude<WorkflowStatus, "Complete">, Vendor[]>;
  notUsing: Vendor[]; // onboardingPath === "Not Using" — derives to Complete, shown as its own quiet section
  complete: Vendor[]; // genuinely onboarded — derives to Complete
  counts: { total: number; needsAttention: number; blocked: number; complete: number };
}

// Groups by derived status. "Not Using" and genuinely-onboarded vendors both
// derive to "Complete" (by design — see the approved workflow model), but the
// list screen keeps them visually separate: one is done because it was
// intentionally skipped, the other because the work actually finished.
export function groupVendors(vendors: Vendor[]): VendorGroups {
  const byStatus = {} as Record<Exclude<WorkflowStatus, "Complete">, Vendor[]>;
  for (const s of WORKFLOW_GROUP_ORDER) byStatus[s] = [];
  const notUsing: Vendor[] = [];
  const complete: Vendor[] = [];

  for (const v of vendors) {
    const status = deriveWorkflowStatus(v);
    if (status === "Complete") {
      (v.onboardingPath === "Not Using" ? notUsing : complete).push(v);
    } else {
      byStatus[status].push(v);
    }
  }

  const needsAttention = WORKFLOW_GROUP_ORDER
    .filter((s) => s !== "Blocked")
    .reduce((n, s) => n + byStatus[s].length, 0);

  return {
    byStatus,
    notUsing,
    complete,
    counts: {
      total: vendors.length,
      needsAttention,
      blocked: byStatus["Blocked"].length,
      complete: notUsing.length + complete.length,
    },
  };
}
