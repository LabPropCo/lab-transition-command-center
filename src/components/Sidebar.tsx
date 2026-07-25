import { NavLink } from "react-router-dom";
import { NAV, SCREENS, ADMIN_NAV } from "../lib/nav";
import { useAdmin } from "../admin/AdminProvider";

export function Sidebar() {
  const { isAdmin } = useAdmin();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark">The Lab<span>.</span></div>
        <div className="brand__sub">Transition Command Center</div>
      </div>

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
    </aside>
  );
}
