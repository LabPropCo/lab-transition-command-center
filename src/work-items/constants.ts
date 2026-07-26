export const STATUSES = [
  "Not Started", "In Progress", "Waiting on Client", "Waiting on Prior Manager",
  "Waiting on Vendor", "Blocked", "Complete", "Not Applicable",
] as const;

export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export const RESP_PARTIES = ["The Lab", "Client", "Prior Manager", "Vendor", "Shared"] as const;
// Owner options come from the admin-managed work_owners roster (see
// work-items/api.ts listActiveOwners) — not a hard-coded list.

// Status → dot color, drawn from the approved palette.
export function statusColor(status: string): string {
  switch (status) {
    case "Complete": return "var(--gold)";
    case "In Progress": return "var(--bronze)";
    case "Blocked": return "var(--terra)";
    case "Not Applicable": return "var(--muted)";
    default: return "var(--soft)"; // Not Started + all Waiting states
  }
}

export function priorityColor(p: string | null): string {
  switch (p) {
    case "Critical": return "var(--terra)";
    case "High": return "var(--gold)";
    default: return "var(--muted)";
  }
}
