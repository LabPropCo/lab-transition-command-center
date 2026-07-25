// Domain types.

export type Role =
  | "admin" | "regional_manager" | "property_manager"
  | "accounting" | "transition_team" | "read_only";

export type ScopeType = "transition" | "property";

// The primary operating unit. Properties belong to a Transition.
export interface Transition {
  id: string;
  name: string;
  ownershipGroup: string | null;
  companyName: string | null;
  targetGoLive: string | null;   // ISO date
  currentPhase: string | null;
  overallStatus: string | null;
  communityDirectorId: string | null;
  communityDirectorName: string | null;
  transitionManager: string | null;
  regionalManager: string | null;
  defaultPropertyId: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  notes: string | null;
  active: boolean;
}

export interface Property {
  id: string;
  transitionId: string;
  name: string;
  client: string;
  transitionDate: string;
  goLive: string;
  units?: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyType: string | null;
  notes: string | null;
  active: boolean;
}

export interface Membership {
  transitionId: string;
  userId: string;
  role: Role;
}
