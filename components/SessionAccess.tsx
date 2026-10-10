'use client';

import { useState, type FormEvent } from 'react';
import type { Session } from './api-client';
import { ErrorSummary } from './ErrorSummary';

export function SessionAccess({ session, busy, error, login, logout }: { session: Session | null; busy: boolean; error: string | null; login: (code: string) => Promise<boolean>; logout: () => Promise<void> }) {
  const [code, setCode] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); if (await login(code)) setCode(''); }
  return <section className="access-panel" aria-labelledby="access-heading">
    <ErrorSummary message={error} />
    {session?.authenticated ? <div className="session-active"><div><span className="status-badge positive">Private session active</span><p className="small muted">Your requirements and reports stay within this session.</p></div><button type="button" className="text-button" disabled={busy} onClick={() => void logout()}>Sign out</button></div> : <>
      <div className="access-heading-row"><h2 id="access-heading">Start a private demo session</h2><span className="eyebrow">Owner access</span></div>
      <p className="small muted">An access code protects the shared search allowance. No account or personal details required.</p>
      {session && !session.configured ? <p className="setup-notice">Owner setup is required before live searches can run. Configure the server credentials, database and demo access code described in the README.</p> : <form onSubmit={event => void submit(event)} className="access-form">
        <div className="field"><label htmlFor="access-code">Demo access code</label><input id="access-code" type="password" autoComplete="current-password" maxLength={256} required value={code} onChange={event => setCode(event.target.value)} disabled={!session || busy} /></div>
        <button className="button secondary" type="submit" disabled={!session || busy}>{busy ? 'Confirming access…' : 'Unlock live search'}<span aria-hidden="true">↗</span></button>
      </form>}
    </>}
  </section>;
}
