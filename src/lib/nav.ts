// Information architecture, lifted directly from the approved prototype.
// Four groups; screen titles and decks match the prototype's screenMeta.
// In M1 these routes will nest under /p/:propertyId/ for multi-property scoping.

export type ScreenKey =
  | "dashboard" | "myactions" | "meeting"
  | "work-items" | "roadmap" | "first-90"
  | "risks" | "decisions" | "documents"
  | "contacts" | "credentials" | "vendors"
  | "admin";

export interface ScreenMeta {
  key: ScreenKey;
  path: string;
  title: string;
  deck: string;
  /** Milestone the screen's real functionality lands in (drives M0 placeholders). */
  milestone: string;
  /** Roles that may see the nav entry. Enforced for real by RLS in M1+. */
  adminOnly?: boolean;
}

export const SCREENS: Record<ScreenKey, ScreenMeta> = {
  dashboard:   { key: "dashboard",   path: "/dashboard",   title: "Leadership Brief",          deck: "What leadership should do today, not what metrics exist.",                                milestone: "M3" },
  myactions:   { key: "myactions",   path: "/my-actions",  title: "My Actions",                deck: "Exactly what you own right now.",                                                        milestone: "M4" },
  meeting:     { key: "meeting",     path: "/meeting",     title: "Weekly Transition Meeting", deck: "Everything the meeting needs, in the order you need it.",                                 milestone: "M4" },
  "work-items":{ key: "work-items",  path: "/work-items",  title: "Master Work Items",         deck: "Every work item lives here. Open one for full detail; change a status and the dashboard follows.", milestone: "M2" },
  roadmap:     { key: "roadmap",     path: "/roadmap",     title: "Transition Roadmap",        deck: "Today, next, upcoming, and recently completed — the transition at a glance.",             milestone: "M4" },
  "first-90":  { key: "first-90",    path: "/first-90",    title: "First 90 Days",             deck: "Stabilize, then optimize, then prove the standard.",                                     milestone: "M4" },
  risks:       { key: "risks",       path: "/risks",       title: "Risks & Issues",            deck: "What requires leadership attention, and who owns the resolution.",                        milestone: "M5" },
  decisions:   { key: "decisions",   path: "/decisions",   title: "Decision Log",              deck: "What was decided, why, and what still needs a call.",                                     milestone: "M5" },
  documents:   { key: "documents",   path: "/documents",   title: "Documents",                 deck: "Every document tracked from request to file. Links live in Dropbox.",                     milestone: "M5" },
  contacts:    { key: "contacts",    path: "/contacts",    title: "Contacts",                  deck: "Everyone involved in the transition, in one place.",                                     milestone: "M5" },
  credentials: { key: "credentials", path: "/credentials", title: "Credentials",               deck: "System access tracked by lifecycle. Secrets live in your password manager, never here.",  milestone: "M5" },
  vendors:     { key: "vendors",     path: "/vendors",     title: "Vendor Transition",         deck: "Retain, replace, or terminate — and the paperwork behind each call.",                     milestone: "M5" },
  admin:       { key: "admin",       path: "/admin",       title: "Admin",                     deck: "Manage properties, people, roles, and the transition template.",                          milestone: "M6", adminOnly: true },
};

export interface NavGroup { group: string; items: ScreenKey[]; }

export const NAV: NavGroup[] = [
  { group: "Command",   items: ["dashboard", "myactions", "meeting"] },
  { group: "Execution", items: ["work-items", "roadmap", "first-90"] },
  { group: "Oversight", items: ["risks", "decisions", "documents"] },
  { group: "Reference", items: ["contacts", "credentials", "vendors"] },
];

// Admin sub-navigation (platform-admin only). Only implemented screens are
// listed — items are added as each admin phase ships.
export interface AdminNavItem { path: string; title: string; }
export const ADMIN_NAV: AdminNavItem[] = [
  { path: "/admin", title: "Admin" },
  { path: "/admin/transition-settings", title: "Transition Settings" },
  { path: "/admin/methodology", title: "Methodology Library" },
  { path: "/admin/properties", title: "Properties" },
  { path: "/admin/owners", title: "Owners" },
];
