import { useTransition } from "../transitions/TransitionProvider";
import { useAuth } from "../auth/AuthProvider";

// The active transition's identity (name, client, go-live countdown) now
// lives once, in the sidebar — this bar is a plain utility strip: switch
// transitions when there's a choice to make, filter by property, sign out.
// Nothing here duplicates what the sidebar or the page's own header already say.
export function TopBar() {
  const { transitions, selected, selectTransition, properties, propertyFilter, setPropertyFilter, loading, error, reload } = useTransition();
  const { user, signOut } = useAuth();

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          {loading && <span className="topbar__status topbar__status--muted">Loading transition…</span>}
          {!loading && error && <span className="topbar__status topbar__status--err">Couldn’t load transitions</span>}
          {!loading && !error && transitions.length > 1 && (
            <select className="topbar__tsel" aria-label="Switch transition"
              value={selected?.id ?? ""} onChange={(e) => selectTransition(e.target.value)}>
              {transitions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {!loading && !error && transitions.length === 0 && (
            <span className="topbar__status topbar__status--muted">No transitions available</span>
          )}
        </div>

        <div className="topbar__right">
          {!loading && !error && properties.length > 0 && (
            <select className="switcher" aria-label="Filter by property"
              value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
              <option value="all">All properties</option>
              <option value="shared">Shared (transition-wide)</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="topbar__user" title={user?.email ?? ""}>
            <span className="topbar__email">{user?.email}</span>
            <button className="topbar__signout" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>

      {error && (
        <div className="loadbar" role="alert">
          <span className="loadbar__msg">{error}</span>
          <button className="loadbar__retry" onClick={reload}>Retry</button>
        </div>
      )}
    </>
  );
}
