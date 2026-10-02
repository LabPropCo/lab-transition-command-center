// Shared footer for the public marketing pages (homepage + /golf).
export function PublicFooter() {
  return (
    <div className="ph__inner ph__footer">
      <img className="ph__footer-logo" src="/brand/lab-logo-primary-black.svg" alt="The Lab Property Company" />
      <div className="ph__footer-name">The Lab Property Company LLC</div>
      <div className="ph__footer-address">
        2198 E. Camelback Rd., Suite 240
        <br />
        Phoenix, AZ 85016
      </div>
      <nav className="ph__footer-links">
        <a href="/">Home</a>
        <a href="/golf">Hospitality &amp; Golf</a>
      </nav>
      <div className="ph__footer-copyright">
        © {new Date().getFullYear()} The Lab Property Company LLC
      </div>
      <div className="ph__footer-easteregg">Leave it better than you found it.</div>
    </div>
  );
}
