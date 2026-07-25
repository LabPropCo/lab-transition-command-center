import { DEMO_MODE } from "../demo/config";
import { DEV_BYPASS_ENABLED } from "../auth/devBypass";

// Visible only in local dev modes. Returns null (and is dead-code eliminated)
// in production builds.
export function DevBanner() {
  // Direct env guard: in production `import.meta.env.DEV` is false, so everything
  // below (including the label strings) is dead-code eliminated.
  if (!import.meta.env.DEV) return null;
  const label = DEMO_MODE
    ? "DEMO MODE · sample data · no backend"
    : DEV_BYPASS_ENABLED
    ? "DEV MODE · auth bypass · local only"
    : null;
  if (!label) return null;
  return (
    <div className="devbanner" role="status">
      <span className="devbanner__dot" aria-hidden />
      {label}
    </div>
  );
}
