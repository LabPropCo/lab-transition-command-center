// One-time first-admin bootstrap.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-admin.mjs
// Optional: ADMIN_EMAIL=... (defaults to the primary admin).
//
// Creates a passwordless (OTP) auth user, confirms the email, and flips the
// profile's is_platform_admin flag. Idempotent: re-running finds the existing
// user instead of failing. The service-role key stays on your machine only.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = (process.env.ADMIN_EMAIL || "jessica@texascapitalpartners.com").toLowerCase();

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  let userId;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: adminEmail,
    email_confirm: true,
  });

  if (createErr) {
    const existing = await findUserByEmail(adminEmail);
    if (!existing) throw createErr;
    userId = existing.id;
    console.log(`User already exists: ${adminEmail} (${userId})`);
  } else {
    userId = created.user.id;
    console.log(`Created user: ${adminEmail} (${userId})`);
  }

  const { error: upErr } = await admin
    .from("profiles")
    .upsert({ id: userId, email: adminEmail, is_platform_admin: true }, { onConflict: "id" });
  if (upErr) throw upErr;

  console.log(`\u2705 ${adminEmail} is now platform admin.`);
}

main().catch((e) => { console.error("Seed failed:", e.message || e); process.exit(1); });
