'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewsArticle, PublicNewsCheck } from '../lib/news/contracts';
import type { Requirements } from '../lib/contracts';
import { api, ApiError } from './api-client';
import { createRequestKey, type PendingCreate } from './idempotency';
import { formatDate, safeHref } from './ui-contracts';

const relationLabels: Record<NewsArticle['relation'], string> = {
  venue_and_area: 'Venue and area mentioned · branch still needs confirmation',
  possible_venue: 'Possible venue mention · exact branch unverified',
  area_context: 'City or area context · venue impact unverified',
  unmatched: 'Venue or area match unverified',
};
const recencyLabels: Record<NewsArticle['recency'], string> = {
  recent: 'Recently published', older: 'Older report', unknown: 'Publication date unknown',
};

export function VisitWatch({ parentJobId, hasSavedBrief, requirements, csrfToken, onExpired }: {
  parentJobId: string; hasSavedBrief: boolean; requirements: Requirements; csrfToken: string | null | undefined; onExpired: () => void;
}) {
  const [check, setCheck] = useState<PublicNewsCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const mounted = useRef(true);
  const active = useRef(false);
  const paused = useRef(false);
  const pendingCreate = useRef<PendingCreate>(null);
  const path = `/api/jobs/${encodeURIComponent(parentJobId)}/news-check`;
  const load = useCallback(async () => (await api<{ check: PublicNewsCheck | null }>(path)).check, [path]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    if (hasSavedBrief) {
      void load().then(saved => { if (!cancelled) { setCheck(saved); setClock(Date.now()); } }).catch(cause => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) onExpired();
        setError(cause instanceof Error ? cause.message : 'The saved news check could not be opened.');
      }).finally(() => { if (!cancelled) setLoading(false); });
    } else setLoading(false);
    const pause = () => {
      if (active.current && (document.hidden || !navigator.onLine)) {
        paused.current = true;
        setPauseReason('Paused. Open this tab with an active connection, then choose Resume news check.');
      }
    };
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('offline', pause);
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      cancelled = true; mounted.current = false; paused.current = true;
      document.removeEventListener('visibilitychange', pause); window.removeEventListener('offline', pause); window.clearInterval(timer);
    };
  }, [hasSavedBrief, load, onExpired]);

  async function run(saved?: PublicNewsCheck) {
    if (active.current || !csrfToken || !hasSavedBrief || loading) return;
    if (document.hidden || !navigator.onLine) {
      setPauseReason('Open this tab with an active connection before starting the news check.'); return;
    }
    active.current = true; paused.current = false; setBusy(true); setError(null); setPauseReason(null);
    let current: PublicNewsCheck | null = saved ?? null;
    try {
      if (!current) {
        const input = { parentJobId, previousCheckId: check?.id ?? null };
        const response = await api<{ check: PublicNewsCheck }>(path, {
          method: 'POST', csrfToken, body: { idempotencyKey: createRequestKey(pendingCreate, input) },
        });
        current = response.check; pendingCreate.current = null;
        if (mounted.current) setCheck(current);
      }
      if (!current) throw new Error('The news check could not be opened.');
      for (let steps = 0; mounted.current && !paused.current && current.canResume && steps < 4; steps += 1) {
        if (document.hidden || !navigator.onLine) {
          setPauseReason('Paused. Open this tab with an active connection, then choose Resume news check.'); break;
        }
        if (current.nextRetryAt && Date.parse(current.nextRetryAt) > Date.now()) {
          setPauseReason('The provider requested a wait. Choose Resume news check after the retry time shown below.'); break;
        }
        try {
          const response: { check: PublicNewsCheck } = await api<{ check: PublicNewsCheck }>(`${path}/step`, {
            method: 'POST', csrfToken, body: { checkId: current.id, expectedVersion: current.stateVersion },
          });
          current = response.check;
          if (mounted.current) { setCheck(current); setClock(Date.now()); }
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 409) {
            const latest = await load(); if (mounted.current) setCheck(latest);
            setPauseReason('Another check step is finishing. Saved state is refreshed; choose Resume news check shortly.');
            break;
          }
          throw cause;
        }
      }
      if (mounted.current && !paused.current && current.canResume && !current.nextRetryAt) {
        setPauseReason(reason => reason ?? 'Completed steps are saved. Choose Resume news check to continue.');
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'This check paused before it finished. Your saved accessibility brief is preserved.');
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  }

  const result = check?.result;
  const expired = !!result && Number.isFinite(Date.parse(result.expiresAt)) && Date.parse(result.expiresAt) <= clock;
  const matches = result?.articles.filter(article => article.relation !== 'unmatched') ?? [];
  const topics = new Set(matches.flatMap(article => article.topics));
  const selected = new Set(requirements.filter(requirement => requirement.priority !== 'not_needed').map(requirement => requirement.feature));
  const questions: string[] = [];
  if (topics.has('closure')) questions.push('Is the selected branch open for my visit?');
  if ((topics.has('maintenance') || topics.has('access')) && selected.size > 0) {
    questions.push(selected.has('lift_present') || selected.has('lift_operational')
      ? 'Are the lift and the access facilities I need available today?'
      : 'Are the access facilities I need available today, including any step-free facilities I selected?');
  }
  if ((topics.has('weather') || topics.has('incident')) && (selected.has('arrival_step_free') || selected.has('entrance_step_free'))) {
    questions.push('Has the reported event affected the entrance or arrival arrangements?');
  }
  const incomplete = !!check && !check.canResume && check.phase !== 'complete';
  const unavailableReason = !check?.errorCode ? null
    : check.errorCode === 'budget_exhausted' || check.errorCode === 'quota' ? 'The permitted search allowance is unavailable for this check.'
    : check.errorCode === 'search_disabled' ? 'The owner has disabled new searches.'
    : ['timeout', 'network', 'ambiguous_dispatch'].includes(check.errorCode) && incomplete ? 'The request may have reached the provider. This check will not replay it automatically.'
    : check.errorCode === 'schema_drift' || check.errorCode === 'invalid_json' ? 'The news response could not be verified and was excluded.'
    : check.errorCode === 'busy' ? 'Another check step is finishing. Refresh saved state before resuming.'
    : 'The news provider did not supply a usable result for this check.';
  const headline = incomplete ? 'News check incomplete — current conditions remain unknown.'
    : result ? matches.length ? 'Public reports to review before your visit.' : 'No matching reports found — current conditions remain unknown.'
    : 'A saved access review can miss a new disruption.';

  return <section className="visit-watch" aria-labelledby="visit-watch-heading">
    <div className="watch-heading-row"><div><span className="eyebrow">Before you go · News signals</span><h2 id="visit-watch-heading">Has anything changed since this brief?</h2></div><span className="watch-provider">SerpApi · Google News</span></div>
    <p className="watch-intro">Look for published reports of closures, maintenance, outages or weather disruption around this venue. This is a separate news check; your accessibility result stays unchanged.</p>
    <div className={`watch-status${incomplete ? ' watch-incomplete' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="watch-status-symbol" aria-hidden="true">{busy ? '…' : matches.length ? '!' : '?'}</span><div><h3>{busy ? 'Checking public news reports…' : headline}</h3>
        {result ? <p>Retrieved <time dateTime={result.retrievedAt}>{formatDate(result.retrievedAt, true)}</time>. {expired ? 'This saved check has expired.' : <>Saved check usable until <time dateTime={result.expiresAt}>{formatDate(result.expiresAt, true)}</time>.</>}{(check?.appCacheHits ?? 0) > 0 && ' Reused from the one-hour app cache; the original retrieval time is shown.'}</p> : <p>Publication dates help you spot reports newer than your brief. A news report does not establish what is happening today.</p>}
      </div>
    </div>
    {loading && <p className="small muted" role="status">Opening the saved news check…</p>}
    {error && <p className="watch-error" role="alert">{error} Your saved accessibility brief is preserved.</p>}
    {unavailableReason && <p className="watch-pause">{unavailableReason} Your saved accessibility brief is preserved.</p>}
    {pauseReason && <p className="watch-pause" role="status">{pauseReason}</p>}
    {check?.nextRetryAt && <p className="small muted">Earliest permitted retry: <time dateTime={check.nextRetryAt}>{formatDate(check.nextRetryAt, true)}</time>.</p>}
    <div className="watch-actions">
      {check?.canResume ? <button className="button secondary" type="button" disabled={busy || loading || !csrfToken} onClick={() => void run(check)}>Resume news check <span aria-hidden="true">↗</span></button>
        : <button className="button secondary" type="button" disabled={busy || loading || !csrfToken || !hasSavedBrief || (!!result && !expired && !incomplete)} onClick={() => void run()}>{busy ? 'Checking…' : result ? 'Check news again' : error ? 'Try news check again' : 'Check before I go'}<span aria-hidden="true">↗</span></button>}
      <p className="small muted">Optional: one Google News query, up to 2 counted attempts if a known failure permits one retry. Fresh app cache can use zero new searches.</p>
    </div>
    {check && <p className="watch-accounting small muted">{check.providerAttempts} / {check.searchCap} search attempts for this check · {check.appCacheHits} app cache hit{check.appCacheHits === 1 ? '' : 's'}. Your original investigation counts are unchanged.</p>}
    {!hasSavedBrief && <p className="small muted">Finish or save the accessibility investigation before checking news.</p>}
    {result && <>
      {result.articles.length > 0 && <div className="watch-articles">{result.articles.map(article => {
        const href = safeHref(article.url);
        return <article className="watch-article" key={article.id}>
          <div className="watch-article-badges"><span className={`watch-recency watch-recency-${article.recency}`}>{recencyLabels[article.recency]}</span>{article.newerThanBrief === true && <span className="watch-newer">Published after the checked brief</span>}</div>
          <p className="watch-relation">{relationLabels[article.relation]}</p>
          <h3>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{article.title}<span className="sr-only"> (opens original news article)</span><span aria-hidden="true"> ↗</span></a> : article.title}</h3>
          <p className="watch-article-meta">{article.publisher || 'Publisher not supplied'} · {article.publishedAt ? <time dateTime={article.publishedAt}>{formatDate(article.publishedAt, true)}</time> : article.dateLabel ? <>Reported date: {article.dateLabel} · exact publication date unknown</> : 'Publication date unknown'}</p>
          {article.snippet && <blockquote>{article.snippet}</blockquote>}
          {article.topics.length > 0 && <p className="watch-topics">Headline topics: {article.topics.join(', ')}. Current venue impact unverified.</p>}
          {!href && <p className="small muted">Original article link unavailable.</p>}
        </article>;
      })}</div>}
      <details className="watch-details"><summary>Search scope and limits</summary><p>Query: {result.query}</p><p>Recently published means published within 14 days of this news check.</p><p>Checked brief snapshot: {result.briefGeneratedAt ? <time dateTime={result.briefGeneratedAt}>{formatDate(result.briefGeneratedAt, true)}</time> : 'date unavailable'}. Reassessing the saved brief does not refresh this news check.</p>{result.limitations.length > 0 && <ul>{result.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul>}</details>
      {questions.length > 0 && <div className="watch-questions"><h3>What to confirm for your visit</h3><p>Questions based on headline topics and your selected requirements. Your requirements stay private; these questions have not been sent.</p><ol>{questions.slice(0, 2).map(question => <li key={question}>{question}</li>)}</ol></div>}
    </>}
    <p className="watch-caveat"><strong>Confirm directly before travelling.</strong> Recently published describes the article, not whether a disruption continues. No matching news is not an all-clear. News cannot confirm current lift operation or certify access.</p>
  </section>;
}
