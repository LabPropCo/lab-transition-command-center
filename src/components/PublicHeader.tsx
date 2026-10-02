// Shared header for the public marketing pages (homepage + /golf). Anchor
// links are rooted at "/" so they work correctly from any public route: a
// plain <a href="/#operate"> is an in-page hash scroll when already on "/",
// and a real navigation-then-scroll from elsewhere.
export function PublicHeader() {
  return (
    <div className="ph__inner ph__header">
      <img
        className="ph__logo"
        src="/brand/lab-logo-reversed-white.svg"
        alt="The Lab Property Company"
      />
      <ul className="ph__nav">
        <li><a href="/#operate">How We Operate</a></li>
        <li><a href="/#manage">What We Do</a></li>
        <li><a href="/#standard">The Standard</a></li>
        <li><a href="/golf">Hospitality &amp; Golf</a></li>
      </ul>
    </div>
  );
}
