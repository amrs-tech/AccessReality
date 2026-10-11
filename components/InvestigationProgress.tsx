'use client';

import type { Job } from './ui-contracts';
import { formatDate } from './ui-contracts';
import { terminal } from './useJob';

const stages: Record<string, string> = { created: 'Ready to start', discovery: 'Finding exact venue branches', details: 'Retrieving venue details', reviews: 'Reading a bounded review sample', extract: 'Extracting and validating observations', assess: 'Assessing your requirements', plan: 'Choosing a permitted gap check', targeted_search: 'Checking a specific evidence gap', finalize: 'Preparing your visit brief', complete: 'Investigation complete', partial: 'Partial brief available', cancelled: 'Investigation cancelled' };
const reasons: Record<string, string> = { evidence_sufficient: 'Selected requirements have usable public evidence.', search_budget_exhausted: 'This bounded investigation used its permitted search attempts and stopped further checks. Remaining venue requirements still need confirmation.', llm_budget_exhausted: 'This run reached its extraction allowance and stopped additional processing. Unprocessed information remains unconfirmed.', no_new_evidence: 'Further checks added no accepted evidence.', no_eligible_actions: 'No permitted evidence checks remain.', upstream_unavailable: 'A provider was unavailable. Available evidence is preserved.', time_limit: 'The bounded active-time limit was reached.', cancelled: 'You cancelled further checks.', ambiguous_dispatch: 'A request may have reached its provider. It will not be replayed automatically.' };

export function InvestigationProgress({ job, running, pauseReason, resume, pause, cancel }: { job: Job; running: boolean; pauseReason: string | null; resume: () => void; pause: () => void; cancel: () => void }) {
  const isTerminal = terminal(job);
  const recent = job.events.slice(-4);
  return <section className="progress-panel" aria-labelledby="progress-heading">
    <div className="section-heading"><div><span className="eyebrow">Bounded investigation</span><h2 id="progress-heading" aria-live="polite" aria-atomic="true">{stages[job.phase] ?? 'Retrieving venue evidence'}</h2></div><span className={`status-badge ${running ? 'active' : 'neutral'}`}>{running ? 'In progress' : isTerminal ? job.phase === 'partial' ? 'Partial' : job.phase === 'cancelled' ? 'Stopped' : 'Complete' : 'Paused'}</span></div>
    <div className="progress-stats">
      <div><strong>{job.providerAttempts}<span> / {job.searchCap}</span></strong><span>Search attempts reserved</span></div>
      <div><strong>{job.sourceCount}</strong><span>Retrieved sources</span></div>
      <div><strong>{job.reviewsExamined}</strong><span>Reviews examined</span></div>
      <div><strong>{job.appCacheHits}</strong><span>App cache reuses</span></div>
    </div>
    <p className="small muted">Search attempts are a conservative allowance count, not exact billed credits. Extraction: {job.llmAttempts} / {job.llmCap} attempts.</p>
    {job.lastKnownProviderRemaining !== null && <p className="small muted">Last known provider allowance: {job.lastKnownProviderRemaining}, checked {formatDate(job.allowanceCheckedAt, true)}. This is a saved account check, not a live balance.</p>}
    {job.remainingAction && !isTerminal && <p className="next-action"><strong>Permitted next action</strong> {job.remainingAction}</p>}
    {recent.length > 0 && <ol className="action-trace" aria-label="Recent investigation actions">{recent.map((event, index) => <li key={`${event.createdAt}-${index}`}><span className="trace-line" aria-hidden="true"/><span>{event.message || event.type.replaceAll('_', ' ')}<time className="trace-date" dateTime={event.createdAt}>{formatDate(event.createdAt, true)}</time></span></li>)}</ol>}
    {job.stopReason && <p className="stop-note">{reasons[job.stopReason] ?? job.stopReason.replaceAll('_', ' ')}</p>}
    {pauseReason && !isTerminal && <p className="pause-note" role="status">{pauseReason}</p>}
    {job.nextRetryAt && !isTerminal && <p className="small">Earliest retry: <time dateTime={job.nextRetryAt}>{formatDate(job.nextRetryAt, true)}</time></p>}
    {!isTerminal && <><div className="button-row">{running ? <button type="button" className="button secondary" onClick={pause}>Pause after this step</button> : <button type="button" className="button primary" onClick={resume}>Resume investigation <span aria-hidden="true">→</span></button>}<button type="button" className="text-button danger" onClick={cancel}>Cancel further checks</button></div><p className="small muted">You can return to this investigation; it continues while this page is open. Completed steps are saved.</p></>}
  </section>;
}
