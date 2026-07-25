// One-time: set a password on the seeded admin so the local dev bypass can do a
// real signInWithPassword. Uses the service-role key locally; nothing is committed.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEV_ADMIN_PASSWORD=... node scripts/set-dev-password.mjs
// Optional: ADMIN_EMAIL=... (defaults to the primary admin).
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.ADMIN_EMAIL || "jessica@texascapitalpartners.com").toLowerCase();
const password = process.env.DEV_ADMIN_PASSWORD || "labdev-transition"; // default matches the bypass default

if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (password.length < 8) { console.error("Choose a DEV_ADMIN_PASSWORD of at least 8 characters."); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUser(e) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === e);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

const user = await findUser(email);
if (!user) { console.error(`No user ${email}. Run: npm run seed:admin`); process.exit(1); }
const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
if (error) { console.error("Failed:", error.message); process.exit(1); }
console.log(`\u2705 Dev password set for ${email}. You can now enable VITE_DEV_AUTH_BYPASS locally.`);
