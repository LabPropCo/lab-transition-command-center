// invite-user — admin-only provisioning (invite-only auth).
//   1. Authenticate the caller from their JWT.
//   2. Authorize: caller must be a platform admin.
//   3. Provision: create-or-find the invited user, assign transition membership,
//      and optionally restrict them to specific properties.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors } from "../_shared/cors.ts";

interface InviteBody {
  email: string;
  transition_id: string;
  role?: string;
  // Optional: limit the user to these properties within the transition.
  property_ids?: string[];
  full_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
  const { data: profile } = await caller
    .from("profiles").select("is_platform_admin").eq("id", userData.user.id).single();
  if (!profile?.is_platform_admin) return json({ error: "Forbidden" }, 403);

  let body: InviteBody;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const email = (body.email || "").trim().toLowerCase();
  const transitionId = body.transition_id;
  const role = body.role ?? "transition_team";
  if (!email || !transitionId) return json({ error: "email and transition_id are required" }, 400);

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let invitedId: string | undefined;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: body.full_name ? { full_name: body.full_name } : undefined,
  });
  if (createErr) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    invitedId = list?.users.find((u) => (u.email || "").toLowerCase() === email)?.id;
    if (!invitedId) return json({ error: createErr.message }, 400);
  } else {
    invitedId = created.user.id;
  }

  const { error: memErr } = await admin.from("transition_members")
    .upsert({ transition_id: transitionId, user_id: invitedId, role }, { onConflict: "transition_id,user_id" });
  if (memErr) return json({ error: memErr.message }, 400);

  // Optional property restriction. Providing property_ids limits the user to them.
  if (Array.isArray(body.property_ids) && body.property_ids.length > 0) {
    const rows = body.property_ids.map((pid) => ({ transition_id: transitionId, user_id: invitedId, property_id: pid }));
    const { error: rErr } = await admin.from("transition_member_properties")
      .upsert(rows, { onConflict: "transition_id,user_id,property_id" });
    if (rErr) return json({ error: rErr.message }, 400);
  }

  return json({ ok: true, user_id: invitedId, transition_id: transitionId, restricted: (body.property_ids?.length ?? 0) > 0 });

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
