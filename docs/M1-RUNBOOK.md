# M1 Runbook — Auth & property scoping

Everything in M1 is coded and type-checked. This runbook is the one-time setup you
run against a live Supabase project to make it work and to verify the acceptance
criteria. ~30 minutes. Build on the **Free tier**; upgrade to Pro before Arkansas
go-live.

## 0. Accounts
- A Supabase project (Free tier) → note the **Project URL**, **anon key**, and
  **service-role key** (Settings → API).
- A Resend account → an **API key** and a **verified sending domain**.

## 1. Frontend env
```bash
cp .env.example .env.local
# set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

## 2. Apply the schema + RLS
Using the Supabase CLI (recommended):
```bash
supabase link --project-ref YOUR-REF
supabase db push          # applies supabase/migrations/0001_auth_and_properties.sql
```
Or paste `supabase/migrations/0001_auth_and_properties.sql` into the SQL editor and run it.
(Optional dev data: run `supabase/seed.sql` for the sample property.)

## 3. Lock auth to invite-only  (Dashboard → Authentication → Providers → Email)
- **Disable "Allow new users to sign up".**  ← critical; this is the server half of invite-only.
- Enable **Email OTP**. Set OTP length **6**, expiry **3600s**.
- Leave "Confirm email" off (OTP verifies the address).

## 4. Resend as SMTP  (Dashboard → Project Settings → Authentication → SMTP)
- Enable **Custom SMTP**. Host `smtp.resend.com`, port `465`, username `resend`,
  password = your **Resend API key**. Sender = an address on your verified domain.
- Save. Supabase's own low rate limit no longer applies — important for sending
  codes across many corporate domains.

## 5. OTP email template  (Dashboard → Authentication → Email Templates → Magic Link)
- Paste `supabase/templates/otp-email.html`. It shows the **6-digit `{{ .Token }}`**
  as the hero and keeps `{{ .ConfirmationURL }}` as a fallback link.

## 6. Deploy the invite function
```bash
supabase functions deploy invite-user
supabase secrets set ALLOWED_ORIGIN=https://YOUR-CLOUDFLARE-DOMAIN
# SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected automatically.
```

## 7. Seed the first admin (only Jessica for M1)
```bash
SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY \
node scripts/seed-admin.mjs
# → "jessica@texascapitalpartners.com is now platform admin."
```

## 8. Acceptance criteria — verify these
1. **Invite-only holds.** On the login screen, request a code for an *unregistered*
   email. You get the generic "if that address is registered…" message and **no
   account is created** (check Authentication → Users).
2. **Admin signs in.** Request a code for `jessica@…`; the email arrives via Resend
   with a 6-digit code; entering it signs her in.
3. **Multi-domain delivery.** Send codes to at least two *different corporate
   domains* you control and confirm both arrive and verify. (This is the M1
   deliverability gate.)
4. **Scoping works.** As admin, invite a second user assigned to ONE property.
   Sign in as that user → they see only that property; the admin sees all.
5. **De-provision is instant.** Remove that user's `property_members` row → on next
   load they can no longer see the property.

When 1–5 pass, M1 is accepted. Then we start **M2 — Work Items engine.**
