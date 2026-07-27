export const STATUSES = [
  "Not Started", "In Progress", "Waiting on Client", "Waiting on Prior Manager",
  "Waiting on Vendor", "Blocked", "Complete", "Not Applicable",
] as const;

export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;
export const RESP_PARTIES = ["The Lab", "Client", "Prior Manager", "Vendor", "Shared"] as const;
// Owner options come from the admin-managed work_owners roster (see
// work-items/api.ts listActiveOwners) — not a hard-coded list.

// "Blocked work" has no dedicated field yet — it's these four status values,
// three of which also name who/what the item is waiting on. Centralized here
// so every consumer (My Actions grouping, the waiting-on breakdown, row tags)
// reads one definition instead of re-deriving it. Deliberately schema-free:
// see the Blocked v1 design discussion for why this is deferred rather than
// normalized into its own column.
export const BLOCKED_STATUSES: readonly string[] = [
  "Blocked", "Waiting on Client", "Waiting on Vendor", "Waiting on Prior Manager",
];

const WAITING_ON_PREFIX = "Waiting on ";

// The reason a blocked item is stuck, parsed from its status. Returns null
// for plain "Blocked" — no party is named in that string, so none is
// fabricated; callers must handle the null case explicitly rather than
// falling back to a guess.
export function blockedReason(status: string): string | null {
  return status.startsWith(WAITING_ON_PREFIX) ? status.slice(WAITING_ON_PREFIX.length) : null;
}

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
