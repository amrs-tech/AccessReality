'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Footer } from '../components/Brand';
import { RequirementsForm } from '../components/RequirementsForm';
import { SessionAccess } from '../components/SessionAccess';
import { VenueCandidates } from '../components/VenueCandidates';
import { InvestigationProgress } from '../components/InvestigationProgress';
import { ErrorSummary } from '../components/ErrorSummary';
import { useSession } from '../components/useSession';
import { useJob, terminal } from '../components/useJob';
import { api, ApiError } from '../components/api-client';
import { defaultRequirements, type Requirements, type Venue } from '../components/ui-contracts';
import { createRequestKey, type PendingCreate } from '../components/idempotency';

export default function Home() {
  const router = useRouter();
  const auth = useSession();
  const work = useJob({ csrfToken: auth.session?.csrfToken, onExpired: auth.expire });
  const [requirements, setRequirements] = useState<Requirements>(defaultRequirements);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('Bengaluru');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingSearch = useRef<PendingCreate>(null);
  const pendingInvestigation = useRef<PendingCreate>(null);
  async function search(event: FormEvent) {
    event.preventDefault(); if (!auth.session?.authenticated) return;
    setBusy(true); setError(null);
    try {
      const input = { query: query.trim(), city: city.trim(), country: 'India' };
      const created = await api<{ jobId: string }>('/api/discoveries', { method: 'POST', csrfToken: auth.session.csrfToken, body: { ...input, idempotencyKey: createRequestKey(pendingSearch, input) } });
      const loaded = await work.load(created.jobId); pendingSearch.current = null; void work.run(loaded);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) auth.expire(); setError(cause instanceof Error ? cause.message : 'Venue discovery could not start.'); }
    finally { setBusy(false); }
  }
  async function investigate(venue: Venue) {
    if (!work.job || !auth.session?.authenticated) return;
    setBusy(true); setError(null);
    try {
      const input = { discoveryJobId: work.job.id, candidateId: venue.id, requirements };
      const created = await api<{ jobId: string }>('/api/investigations', { method: 'POST', csrfToken: auth.session.csrfToken, body: { ...input, idempotencyKey: createRequestKey(pendingInvestigation, input) } });
      router.push(`/investigate/${created.jobId}?start=1`);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) auth.expire(); setError(cause instanceof Error ? cause.message : 'This investigation could not start.'); setBusy(false); }
  }
  const searching = busy || work.running;
  return <><Brand /><main id="main" className="page-shell home-page">
    <div className="hero"><div><span className="eyebrow">A more informed way to arrive</span><h1>Know the barriers<br/>before you arrive<span className="accent-dot">.</span></h1><p className="hero-copy">The right question isn’t “Is it accessible?”<br/>It’s “Does this venue meet <em>your</em> needs?”</p></div><div className="hero-aside"><span className="hero-number">01</span><p>One exact venue.<br/>Dated public evidence.<br/><strong>A brief built around you.</strong></p></div></div>
    <div className="home-layout"><aside className="requirements-sidebar"><div className="panel"><RequirementsForm value={requirements} onChange={setRequirements} disabled={busy} /><div className="sidebar-note"><span aria-hidden="true">↳</span><p>An unknown stays unknown. A single must-have barrier stays visible.</p></div></div></aside>
      <div className="home-content"><SessionAccess {...auth} logout={async () => { work.pause(); await auth.logout(); setRequirements(defaultRequirements); }} /><section className="search-panel" aria-labelledby="search-heading"><span className="eyebrow">Find your venue</span><h2 id="search-heading">Start with a place, not a promise.</h2><form onSubmit={event => void search(event)}><div className="search-fields"><div className="field venue-field"><label htmlFor="venue-query">Venue or category</label><input id="venue-query" placeholder="e.g. cafés in Indiranagar" minLength={2} maxLength={160} required value={query} onChange={event => setQuery(event.target.value)} disabled={searching}/></div><div className="field city-field"><label htmlFor="venue-city">City in India</label><input id="venue-city" minLength={2} maxLength={80} required value={city} onChange={event => setCity(event.target.value)} disabled={searching}/></div></div><div className="search-submit"><p className="small muted">Up to 5 branches. One discovery search attempt.<br/>Selecting a venue starts a separate run, capped at 5 search attempts.</p><button className="button primary" type="submit" disabled={!auth.session?.authenticated || searching}>{searching ? 'Searching…' : 'Find venues'}<span aria-hidden="true">→</span></button></div></form></section>
        <ErrorSummary message={error || work.error} />
        {auth.session?.authenticated && work.job && <><InvestigationProgress job={work.job} running={work.running} pauseReason={work.pauseReason} resume={() => void work.run()} pause={() => work.pause()} cancel={() => void work.cancel()} />{terminal(work.job) && <VenueCandidates candidates={work.job.candidates} busy={busy} select={venue => void investigate(venue)} />}</>}
        {!work.job && <section className="how-it-works" aria-label="How AccessReality works"><div><span>01</span><h3>Choose your requirements</h3><p>Your must-haves shape the brief. Preferred features stay separate.</p></div><div><span>02</span><h3>Follow the evidence</h3><p>Venue attributes, a bounded review sample and relevant search excerpts.</p></div><div><span>03</span><h3>Arrive with better questions</h3><p>Read reported barriers, source dates and what still needs confirmation.</p></div></section>}
      </div></div>
  </main><Footer /></>;
}
