import { supabase } from "../lib/supabase";
import type { Transition } from "../types";
import { DEMO_MODE } from "../demo/config";

export interface TransitionSettingsPatch {
  name?: string;
  company_name?: string | null;
  target_go_live_date?: string | null;
  overall_status?: string | null;
  current_phase?: string | null;
  community_director_id?: string | null;
  community_director_name?: string | null;
  transition_manager?: string | null;
  regional_manager?: string | null;
  default_property_id?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  logo_url?: string | null;
  notes?: string | null;
}

export async function updateTransitionSettings(id: string, patch: TransitionSettingsPatch): Promise<void> {
  if (DEMO_MODE) return; // demo mode is read-only for settings
  if (!supabase) throw new Error("Backend not configured");
  const { error } = await supabase.from("transitions").update(patch).eq("id", id);
  if (error) {
    if (error.code === "42501" || /permission denied/i.test(error.message)) {
      throw new Error("Permission denied. Admin write grants (0007/0008/0009) must be applied, and you must be a platform admin.");
    }
    throw error;
  }
}

// Uploads a logo to the `branding` bucket and returns its public URL.
export async function uploadLogo(transitionId: string, file: File): Promise<string> {
  if (DEMO_MODE) throw new Error("Logo upload is disabled in demo mode.");
  if (!supabase) throw new Error("Backend not configured");
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${transitionId}/logo-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("branding").upload(path, file, {
    cacheControl: "3600", upsert: true, contentType: file.type || undefined,
  });
  if (upErr) {
    if (/bucket/i.test(upErr.message) && /not found/i.test(upErr.message)) {
      throw new Error("The `branding` storage bucket doesn't exist yet — apply migration 0009, then retry.");
    }
    throw upErr;
  }
  const { data } = supabase.storage.from("branding").getPublicUrl(path);
  return data.publicUrl;
}

// Convenience for screens that want the freshest single transition row.
export async function fetchTransition(id: string): Promise<Transition | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("transitions")
    .select("id,name,ownership_group,company_name,target_go_live_date,current_phase,overall_status,community_director_id,community_director_name,transition_manager,regional_manager,default_property_id,primary_color,secondary_color,logo_url,notes,active")
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const r = data as any;
  return {
    id: r.id, name: r.name, ownershipGroup: r.ownership_group, companyName: r.company_name ?? r.ownership_group,
    targetGoLive: r.target_go_live_date, currentPhase: r.current_phase, overallStatus: r.overall_status,
    communityDirectorId: r.community_director_id, communityDirectorName: r.community_director_name,
    transitionManager: r.transition_manager, regionalManager: r.regional_manager,
    defaultPropertyId: r.default_property_id, primaryColor: r.primary_color, secondaryColor: r.secondary_color,
    logoUrl: r.logo_url, notes: r.notes, active: r.active,
  };
}

export interface DirectoryUser { id: string; name: string; email: string; }

// Active users for the Community Director dropdown. Until the Users module lands
// this reads existing profile records (admins may read all via RLS).
export async function listUsers(): Promise<DirectoryUser[]> {
  if (DEMO_MODE || !supabase) return [];
  const { data, error } = await supabase.from("profiles").select("id,full_name,email").order("full_name", { nullsFirst: false });
  if (error) throw error;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.full_name || r.email, email: r.email }));
}

// ---- Property administration (platform-admin only; gated by properties RLS) ----
export interface PropertyPatch {
  name?: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  units?: number | null;
  property_type?: string | null;
  notes?: string | null;
  active?: boolean;
}

function propErr(e: any): Error {
  const msg = String(e?.message ?? e);
  if (e?.code === "42501" || /permission denied/i.test(msg))
    return new Error("Permission denied — platform-admin only, and the properties grant (0013) must be applied.");
  if (/row-level security/i.test(msg)) return new Error("Only platform admins can edit properties.");
  return e instanceof Error ? e : new Error(msg);
}

export async function createProperty(transitionId: string, patch: PropertyPatch): Promise<void> {
  if (DEMO_MODE) throw new Error("Property editing needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const { error } = await supabase.from("properties").insert({ transition_id: transitionId, ...patch });
  if (error) throw propErr(error);
}

export async function updateProperty(id: string, patch: PropertyPatch): Promise<void> {
  if (DEMO_MODE) throw new Error("Property editing needs a live backend (disabled in demo mode).");
  if (!supabase) throw new Error("Backend not configured.");
  const { error } = await supabase.from("properties").update(patch).eq("id", id);
  if (error) throw propErr(error);
}

export async function setDefaultProperty(transitionId: string, propertyId: string | null): Promise<void> {
  return updateTransitionSettings(transitionId, { default_property_id: propertyId });
}
