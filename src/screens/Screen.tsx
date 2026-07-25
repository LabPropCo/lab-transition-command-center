import { SCREENS, type ScreenKey } from "../lib/nav";

// M0 renders every screen through one honest frame: real title + deck (the
// approved copy) with a milestone-badged placeholder body. Each screen graduates
// to its own file as its milestone lands, replacing this generic body.
export function Screen({ k }: { k: ScreenKey }) {
  const s = SCREENS[k];
  return (
    <section className="screen">
      <h1 className="screen__title">{s.title}</h1>
      <p className="screen__deck">{s.deck}</p>

      <div className="placeholder">
        <span className="placeholder__badge">Arrives in {s.milestone}</span>
        <div className="placeholder__head">This screen is scaffolded, not yet built</div>
        <p className="placeholder__body">
          The layout, navigation, and design system are live. The working{" "}
          {s.title.toLowerCase()} experience — data, interactions, and live
          calculations — lands in milestone {s.milestone}, wired to Supabase
          behind Row-Level Security.
        </p>
      </div>
    </section>
  );
}
