import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { DEV_BYPASS_ENABLED } from "../auth/devBypass";

// Gate for all app routes. No session → /login. While the session (or the dev
// bypass sign-in) is resolving we render nothing, so the login page never flashes.
export function RequireAuth() {
  const { user, loading, bypassError } = useAuth();
  if (loading) return null;
  if (user) return <Outlet />;

  // Bypass engaged but sign-in failed: show a clear dev error, NOT the OTP screen.
  if (DEV_BYPASS_ENABLED) return <BypassError message={bypassError} />;
  return <Navigate to="/login" replace />;
}

function BypassError({ message }: { message: string | null }) {
  return (
    <div className="bypasserr">
      <div className="bypasserr__card">
        <div className="bypasserr__badge">DEV AUTH BYPASS</div>
        <h1 className="bypasserr__title">Couldn't auto sign in</h1>
        <p className="bypasserr__msg">{message ?? "The dev bypass could not create a session."}</p>
        <div className="bypasserr__steps">
          <div className="bypasserr__steplabel">One-time fix</div>
          <pre className="bypasserr__pre">SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run set:dev-password

# then restart:  npm run dev</pre>
          <p className="bypasserr__hint">
            Prefer no backend at all? Use <code>VITE_DEMO_MODE=true</code> instead.
          </p>
        </div>
      </div>
    </div>
  );
}
