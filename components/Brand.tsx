import Link from 'next/link';

export function Brand() {
  return <header className="site-header"><div className="header-inner">
    <Link href="/" className="brand" aria-label="AccessReality home">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24h22M7 23V9h7v7h7v7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><circle cx="24" cy="7" r="3" fill="currentColor"/></svg>
      <span>Access<span className="brand-light">Reality</span></span>
    </Link>
    <span className="header-note"><span className="tiny-lock" aria-hidden="true">⌑</span> Private venue brief</span>
  </div></header>;
}

export function Footer() {
  return <footer className="site-footer"><span>Public evidence. Personal requirements. Honest unknowns.</span><span>Built for a more considered visit.</span></footer>;
}
