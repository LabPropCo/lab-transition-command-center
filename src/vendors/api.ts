import { supabase } from "../lib/supabase";
import { DEMO_MODE } from "../demo/config";
import type { Vendor, VendorPatch, VendorType, VendorSource, VendorAuditEntry } from "./types";

const COLS =
  "id,transition_id,name,vendor_type_id,primary_contact,phone,email,onboarding_path,not_using_reason," +
  "w9_status,coi_status,coi_na_reason,yardi_vendor_created,yardi_vendor_id,yardi_verified_by,yardi_verified_at," +
  "contract_exists,contract_copy_received,contract_uploaded_dropbox,dropbox_link," +
  "blocked,blocked_reason,waiting_on_party,blocked_since,notes,created_at,updated_at,updated_by";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapVendor(r: any): Vendor {
  return {
    id: r.id, transitionId: r.transition_id, name: r.name, vendorTypeId: r.vendor_type_id,
    primaryContact: r.primary_contact, phone: r.phone, email: r.email,
    onboardingPath: r.onboarding_path, notUsingReason: r.not_using_reason,
    w9Status: r.w9_status, coiStatus: r.coi_status, coiNaReason: r.coi_na_reason,
    yardiVendorCreated: r.yardi_vendor_created, yardiVendorId: r.yardi_vendor_id,
    yardiVerifiedBy: r.yardi_verified_by, yardiVerifiedAt: r.yardi_verified_at,
    contractExists: r.contract_exists, contractCopyReceived: r.contract_copy_received,
    contractUploadedDropbox: r.contract_uploaded_dropbox, dropboxLink: r.dropbox_link,
    blocked: r.blocked, blockedReason: r.blocked_reason, waitingOnParty: r.waiting_on_party,
    blockedSince: r.blocked_since, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by,
  };
}

function friendly(e: any): Error {
  const msg = String(e?.message ?? e);
  if (e?.code === "42501" || /permission denied/i.test(msg)) return new Error("Permission denied — you may not have write access to this transition.");
  if (e?.code === "PGRST205" || /schema cache/i.test(msg)) return new Error("The API can't see the vendors tables yet — migration 0017 may not be applied, or PostgREST's schema cache needs a reload.");
  return e instanceof Error ? e : new Error(msg);
}

export async function listVendors(transitionId: string): Promise<Vendor[]> {
  if (DEMO_MODE || !supabase) return [];
  const { data, error } = await supabase.from("vendors").select(COLS).eq("transition_id", transitionId).order("name");
  if (error) throw friendly(error);
  return (data ?? []).map(mapVendor);
}

export async function createVendor(transitionId: string, name: string): Promise<Vendor> {
  if (DEMO_MODE) throw new Error("Vendor management needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const { data, error } = await supabase.from("vendors")
    .insert({ transition_id: transitionId, name: name.trim() }).select(COLS).single();
  if (error) throw friendly(error);
  return mapVendor(data);
}

export async function updateVendor(id: string, patch: VendorPatch): Promise<Vendor> {
  if (DEMO_MODE) throw new Error("Vendor management needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const { data, error } = await supabase.from("vendors").update(patch).eq("id", id).select(COLS).single();
  if (error) throw friendly(error);
  return mapVendor(data);
}

// ---- Vendor types (global lookup) ----
function mapType(r: any): VendorType {
  return { id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order };
}
export async function listActiveVendorTypes(): Promise<VendorType[]> {
  if (DEMO_MODE || !supabase) return [];
  const { data, error } = await supabase.from("vendor_types").select("id,name,active,sort_order")
    .eq("active", true).order("sort_order", { ascending: true, nullsFirst: false }).order("name");
  if (error) throw friendly(error);
  return (data ?? []).map(mapType);
}
export async function listAllVendorTypes(): Promise<VendorType[]> {
  if (DEMO_MODE || !supabase) return [];
  const { data, error } = await supabase.from("vendor_types").select("id,name,active,sort_order")
    .order("sort_order", { ascending: true, nullsFirst: false }).order("name");
  if (error) throw friendly(error);
  return (data ?? []).map(mapType);
}
export async function createVendorType(name: string): Promise<void> {
  if (DEMO_MODE) throw new Error("Vendor type management needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Vendor type name is required.");
  const { error } = await supabase.from("vendor_types").insert({ name: trimmed });
  if (error) throw friendly(error);
}
export async function updateVendorType(id: string, patch: { name?: string; active?: boolean }): Promise<void> {
  if (DEMO_MODE) throw new Error("Vendor type management needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const p = { ...patch };
  if (p.name !== undefined) {
    p.name = p.name.trim();
    if (!p.name) throw new Error("Vendor type name is required.");
  }
  const { error } = await supabase.from("vendor_types").update(p).eq("id", id);
  if (error) throw friendly(error);
}

// ---- Vendor sources (import provenance — never read by workflow logic) ----
function mapSource(r: any): VendorSource {
  return {
    id: r.id, vendorId: r.vendor_id, propertyId: r.property_id, sourceLabel: r.source_label,
    originalImportedName: r.original_imported_name, importedBy: r.imported_by, importDate: r.import_date,
  };
}
export async function listVendorSources(vendorIds: string[]): Promise<VendorSource[]> {
  if (DEMO_MODE || !supabase || vendorIds.length === 0) return [];
  const { data, error } = await supabase.from("vendor_sources")
    .select("id,vendor_id,property_id,source_label,original_imported_name,imported_by,import_date")
    .in("vendor_id", vendorIds);
  if (error) throw friendly(error);
  return (data ?? []).map(mapSource);
}

export interface VendorSourceInput { propertyId: string | null; sourceLabel: string | null; originalImportedName: string; }

// Creates a brand-new vendor plus its provenance row in one call.
export async function createVendorWithSource(transitionId: string, name: string, source: VendorSourceInput): Promise<Vendor> {
  const vendor = await createVendor(transitionId, name);
  await addVendorSource(vendor.id, source);
  return vendor;
}

// Links an already-existing vendor to a new source — never touches onboarding fields.
export async function addVendorSource(vendorId: string, source: VendorSourceInput): Promise<void> {
  if (DEMO_MODE) throw new Error("Vendor import needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("vendor_sources").insert({
    vendor_id: vendorId, property_id: source.propertyId, source_label: source.sourceLabel,
    original_imported_name: source.originalImportedName, imported_by: user?.id ?? null,
  });
  if (error) throw friendly(error);
}

// ---- Audit (read-only; "Last Activity" is synthesized client-side from this) ----
function mapAudit(r: any): VendorAuditEntry {
  return { id: r.id, vendorId: r.vendor_id, actorEmail: r.actor_email, field: r.field, oldValue: r.old_value, newValue: r.new_value, createdAt: r.created_at };
}
export async function listVendorAudit(transitionId: string): Promise<VendorAuditEntry[]> {
  if (DEMO_MODE || !supabase) return [];
  const { data, error } = await supabase.from("vendor_audit_log")
    .select("id,vendor_id,actor_email,field,old_value,new_value,created_at")
    .eq("transition_id", transitionId).order("created_at", { ascending: false }).limit(500);
  if (error) throw friendly(error);
  return (data ?? []).map(mapAudit);
}
