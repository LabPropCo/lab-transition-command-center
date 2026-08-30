// Vendor domain types (Sprint 18). One vendor row per company per transition —
// never per property. Property/spreadsheet provenance lives only in
// VendorSource and is never read by workflow-status derivation.

export type OnboardingPath = "Unreviewed" | "Needs Onboarding" | "Already in Yardi" | "Not Using";

export type NotUsingReason =
  | "Replaced by preferred vendor" | "Service no longer needed" | "Duplicate"
  | "Corporate vendor or contract" | "Other";

export type W9Status = "Not Requested" | "Requested" | "Received" | "Uploaded to Yardi";
export type CoiStatus = "Not Requested" | "Requested" | "Received" | "Uploaded to Yardi" | "N/A";
export type TriState = "Unknown" | "Yes" | "No";

export interface Vendor {
  id: string;
  transitionId: string;
  name: string;
  vendorTypeId: string | null;
  primaryContact: string | null;
  phone: string | null;
  email: string | null;
  onboardingPath: OnboardingPath;
  notUsingReason: NotUsingReason | null;
  w9Status: W9Status;
  coiStatus: CoiStatus;
  coiNaReason: string | null;
  yardiVendorCreated: boolean;
  yardiVendorId: string | null;
  yardiVerifiedBy: string | null;
  yardiVerifiedAt: string | null;
  contractExists: TriState;
  contractCopyReceived: TriState;
  contractUploadedDropbox: TriState;
  dropboxLink: string | null;
  blocked: boolean;
  blockedReason: string | null;
  waitingOnParty: string | null;
  blockedSince: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

// Snake-case, matches the DB columns directly — passed straight to
// supabase.from("vendors").update(patch), same convention as WorkItemPatch.
export interface VendorPatch {
  name?: string;
  vendor_type_id?: string | null;
  primary_contact?: string | null;
  phone?: string | null;
  email?: string | null;
  onboarding_path?: OnboardingPath;
  not_using_reason?: string | null;
  w9_status?: W9Status;
  coi_status?: CoiStatus;
  coi_na_reason?: string | null;
  yardi_vendor_created?: boolean;
  yardi_vendor_id?: string | null;
  yardi_verified_by?: string | null;
  yardi_verified_at?: string | null;
  contract_exists?: TriState;
  contract_copy_received?: TriState;
  contract_uploaded_dropbox?: TriState;
  dropbox_link?: string | null;
  blocked?: boolean;
  blocked_reason?: string | null;
  waiting_on_party?: string | null;
  notes?: string | null;
}

export interface VendorType {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number | null;
}

export interface VendorSource {
  id: string;
  vendorId: string;
  propertyId: string | null;
  sourceLabel: string | null;
  originalImportedName: string;
  importedBy: string | null;
  importDate: string;
}

export interface VendorAuditEntry {
  id: number;
  vendorId: string | null;
  actorEmail: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export type WorkflowStatus =
  | "Needs Decision" | "Blocked" | "Needs Classification" | "Needs Contact"
  | "Documents Pending" | "Ready for Yardi" | "Yardi Setup Pending" | "Contract Review"
  | "Complete";
