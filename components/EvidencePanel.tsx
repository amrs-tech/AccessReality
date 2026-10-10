import type { Report } from '../lib/contracts';
import { featureLabels, formatDate, safeHref } from './ui-contracts';

const kinds = { maps_attribute: 'Venue listing attribute', maps_review: 'Visitor report', search_snippet: 'Search snippet' };
const selection = { newest: 'Newest review sample', keyword: 'Keyword-filtered review sample', discovery_attribute: 'Venue details', web_query: 'Venue-specific web search' };

export function EvidencePanel({ report }: { report: Report }) {
  return <section className="evidence-panel" aria-labelledby="evidence-heading"><div className="section-heading"><div><span className="eyebrow">The evidence ledger</span><h2 id="evidence-heading">Read what the sources say</h2></div><span className="count-pill">{report.sources.length}</span></div>
    <p className="small muted">Source dates describe when a report was published or observed. Retrieval time only tells you when this app collected it.</p>
    {report.sources.length === 0 ? <div className="empty-evidence"><span aria-hidden="true">?</span><h3>No source evidence is available</h3><p>The checks did not produce usable venue evidence. Selected requirements remain unknown; this does not establish a barrier.</p></div> : <div className="source-list">{report.sources.map((source, index) => {
      const claims = report.claims.filter(claim => claim.sourceId === source.id && claim.extractionStatus === 'accepted');
      const link = safeHref(source.sourceUrl);
      const originalLanguage = typeof source.metadata.originalLanguage === 'string' ? source.metadata.originalLanguage : null;
      return <article className="source-card" id={`source-${source.id}`} key={source.id} tabIndex={-1}>
        <div className="source-heading"><span className="source-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{kinds[source.kind]}</h3><p className="small muted">{selection[source.selectionMethod]}{originalLanguage ? ` · Original language: ${originalLanguage}` : ''}</p></div></div>
        {source.kind === 'search_snippet' && <p className="snippet-note">A search-result excerpt; the full page was not reviewed.</p>}
        {claims.length > 0 ? claims.map(claim => <div className="claim" key={claim.id}><span className={`claim-label polarity-${claim.polarity}`}>{featureLabels[claim.feature]} · {claim.polarity === 'supports' ? 'Supporting report' : claim.polarity === 'barrier' ? 'Reported barrier' : 'Unclear'}</span><blockquote>{claim.originalQuote}</blockquote>{Object.values(claim.scope).flat().filter(Boolean).length > 0 && <p className="small muted">Scope and conditions: {[claim.scope.entrance, claim.scope.floor, claim.scope.facility, ...claim.scope.conditions].filter(Boolean).join(' · ')}</p>}</div>) : <><p className="unprocessed-note">No accepted accessibility claim from this source.</p><blockquote className="raw-evidence">{source.text || 'The provider supplied no text excerpt.'}</blockquote></>}
        <dl className="source-dates"><div><dt>Published</dt><dd>{formatDate(source.publishedAt)}</dd></div><div><dt>Observed</dt><dd>{formatDate(source.observedAt)}</dd></div><div><dt>Retrieved</dt><dd>{formatDate(source.retrievedAt, true)}</dd></div>{source.editedAt && <div><dt>Edited</dt><dd>{formatDate(source.editedAt)} · does not renew the observation</dd></div>}</dl>
        {source.metadata.truncated === true && <p className="small warning-text">This source excerpt was truncated.</p>}
        {claims.length > 0 && <details className="source-details"><summary>Read immutable source text</summary><p>{source.text}</p></details>}
        {link ? <><a className="source-link" href={link} target="_blank" rel="noopener noreferrer">View {kinds[source.kind].toLowerCase()} {source.publishedAt ? `published ${formatDate(source.publishedAt)}` : `source ${index + 1}`} <span aria-hidden="true">↗</span></a><span className="print-url">{link}</span></> : <p className="small muted">No usable public source link was supplied.</p>}
      </article>;
    })}</div>}
  </section>;
}
