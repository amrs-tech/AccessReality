'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Footer } from './Brand';
import { SessionAccess } from './SessionAccess';
import { RequirementsForm } from './RequirementsForm';
import { InvestigationProgress } from './InvestigationProgress';
import { VisitBrief } from './VisitBrief';
import { ErrorSummary } from './ErrorSummary';
import { useSession } from './useSession';
import { useJob, terminal } from './useJob';
import { api, ApiError } from './api-client';
import { defaultRequirements, type Job, type Requirements } from './ui-contracts';
import { createRequestKey, type PendingCreate } from './idempotency';

export function InvestigationPage({ id, autoStart }: { id: string; autoStart: boolean }) {
  const router = useRouter();
  const auth = useSession();
  const work = useJob({ csrfToken: auth.session?.csrfToken, onExpired: auth.expire });
  const [requirements, setRequirements] = useState<Requirements>(defaultRequirements);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loadedId = useRef<string | null>(null);
  const startRequested = useRef(autoStart);
  const pendingGaps = useRef<PendingCreate>(null);
  const load = work.load;
  const run = work.run;
  const expire = auth.expire;
  const loadJob = useCallback(async () => {
    try {
      const loaded = await load(id); setRequirements(loaded.requirements);
      if (startRequested.current) { startRequested.current = false; window.history.replaceState(window.history.state, '', `/investigate/${encodeURIComponent(id)}`); void run(loaded); }
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) expire(); setError(cause instanceof Error ? cause.message : 'This private investigation could not be opened.'); }
  }, [id, load, run, expire]);
  useEffect(() => {
    if (auth.session?.authenticated && loadedId.current !== id) { loadedId.current = id; void loadJob(); }
    if (!auth.session?.authenticated) loadedId.current = null;
  }, [auth.session?.authenticated, id, loadJob]);
  async function reassess() {
    if (!auth.session?.authenticated) return;
    setBusy(true); setError(null);
    try { const next = await api<Job>(`/api/jobs/${encodeURIComponent(id)}/reassess`, { method: 'POST', csrfToken: auth.session.csrfToken, body: { requirements } }); work.update(next); headingRef.current?.focus(); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) auth.expire(); setError(cause instanceof Error ? cause.message : 'Reassessment could not be saved.'); }
    finally { setBusy(false); }
  }
  async function gaps() {
    if (!auth.session?.authenticated || !work.job?.discoveryJobId || !work.job.candidateId) return;
    setBusy(true); setError(null);
    try {
      const input = { discoveryJobId: work.job.discoveryJobId, candidateId: work.job.candidateId, requirements };
      const created = await api<{ jobId: string }>('/api/investigations', { method: 'POST', csrfToken: auth.session.csrfToken, body: { ...input, idempotencyKey: createRequestKey(pendingGaps, input) } });
      router.push(`/investigate/${created.jobId}?start=1`);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) auth.expire(); setError(cause instanceof Error ? cause.message : 'A new gap investigation could not start.'); }
    finally { setBusy(false); }
  }
  const finished = auth.session?.authenticated && work.job && terminal(work.job);
  return <><Brand /><main id="main" className="page-shell investigation-page"><div className="page-topline"><Link href="/" className="back-link">← Find another venue</Link><span className="small muted">Private investigation</span></div><div className="investigation-intro"><span className="eyebrow">Evidence, with its limits intact</span><h1>Your visit, in focus.</h1><p>What was reported. What applies to your requirements. What to ask next.</p></div>
    <div className="investigation-layout"><aside className="requirements-sidebar"><div className="panel"><RequirementsForm value={requirements} onChange={setRequirements} disabled={busy || work.running} id="revision-requirements" />{finished && <div className="reassess-controls"><button className="button secondary full-width" type="button" disabled={busy || !auth.session?.authenticated} onClick={() => void reassess()}>{busy ? 'Saving…' : 'Reassess this evidence'}</button><p className="small muted">Uses the saved evidence. Zero new searches.</p>{work.job?.report?.overall !== 'evidence_supports_requirements' && work.job?.discoveryJobId && work.job.candidateId && <><button type="button" className="text-button" disabled={busy || !auth.session?.authenticated} onClick={() => void gaps()}>Investigate remaining gaps →</button><p className="small muted">Starts a new capped run, up to 5 search attempts. Fresh app cache entries may be reused.</p></>}</div>}</div></aside>
      <div className="investigation-content"><SessionAccess {...auth} logout={async () => { work.pause(); await auth.logout(); setRequirements(defaultRequirements); }} /><ErrorSummary message={error || work.error} />{auth.session?.authenticated && !work.job && !error && <p className="loading-note" role="status">Opening your saved investigation…</p>}{auth.session?.authenticated && work.job && <><InvestigationProgress job={work.job} running={work.running} pauseReason={work.pauseReason} resume={() => void work.run()} pause={() => work.pause()} cancel={() => void work.cancel()} />{work.job.report && <><button type="button" className="button secondary view-brief" onClick={() => headingRef.current?.focus()}>View {finished ? 'completed' : 'current'} brief ↓</button><VisitBrief report={work.job.report} jobId={id} headingRef={headingRef}/></>}{finished && !work.job.report && <section className="empty-panel"><h2>No assessment was produced</h2><p>Completed attempts remain recorded. No accessibility conclusion is available from this run.</p></section>}</>}</div>
    </div></main><Footer /></>;
}
