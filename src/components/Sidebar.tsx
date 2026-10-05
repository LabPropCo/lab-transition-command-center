import { NavLink } from "react-router-dom";
import { NAV, SCREENS, ADMIN_NAV } from "../lib/nav";
import { useAdmin } from "../admin/AdminProvider";
import { useTransition } from "../transitions/TransitionProvider";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(new Date().toDateString());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// Same factual framing as the Dashboard hero countdown, in miniature — a
// self-contained figure the sidebar can state on its own, never a fragment.
function goLiveLine(d: number): string {
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} to go-live`;
  if (d === 0) return "Go-live is today";
  return `Live · day ${Math.abs(d)}`;
}

export function Sidebar() {
  const { isAdmin } = useAdmin();
  const { selected } = useTransition();
  const goLiveDays = selected ? daysUntil(selected.targetGoLive) : null;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark">The Lab<span>.</span></div>
        <div className="brand__sub">Transition Command Center</div>
      </div>

      {selected && (
        <div className="sidebar__identity">
          <div className="sidebar__rule" aria-hidden />
          <div className="active-transition">
            {selected.logoUrl && <img className="active-transition__logo" src={selected.logoUrl} alt="" />}
            <div className="active-transition__label">Active Transition</div>
            <div className="active-transition__name">{selected.name}</div>
            {(selected.companyName ?? selected.ownershipGroup) && (
              <div className="active-transition__client">{selected.companyName ?? selected.ownershipGroup}</div>
            )}
            {goLiveDays !== null && (
              <div className="active-transition__countdown">{goLiveLine(goLiveDays)}</div>
            )}
          </div>
        </div>
      )}

      <div className="sidebar__nav">
        {NAV.map((g) => (
          <nav className="nav__group" key={g.group} aria-label={g.group}>
            <div className="nav__label">{g.group}</div>
            {g.items.map((key) => {
              const s = SCREENS[key];
              return (
                <NavLink key={key} to={s.path}
                  className={({ isActive }) => "nav__item" + (isActive ? " is-active" : "")}>
                  <span className="nav__bar" aria-hidden />
                  <span>{s.title}</span>
                </NavLink>
              );
            })}
          </nav>
        ))}

        <div className="sidebar__spacer" />

        {/* System group is shown only to platform admins, and lists only the
            admin screens that are actually implemented. */}
        {isAdmin && (
          <nav className="nav__group" aria-label="System">
            <div className="nav__label">System</div>
            {ADMIN_NAV.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.path === "/admin"}
                className={({ isActive }) => "nav__item" + (isActive ? " is-active" : "")}>
                <span className="nav__bar" aria-hidden />
                <span>{item.title}</span>
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}
