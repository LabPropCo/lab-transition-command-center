// Restrict to your app origins in production (set ALLOWED_ORIGIN as a function secret).
const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
export const cors = {
  "Access-Control-Allow-Origin": allowed,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
