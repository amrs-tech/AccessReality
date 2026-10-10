'use client';

import type { RefObject } from 'react';
import type { Report } from '../lib/contracts';
import { RequirementCard } from './RequirementCard';
import { EvidencePanel } from './EvidencePanel';
import { formatDate, mapsHref } from './ui-contracts';

const overall = {
  needs_confirmation: { title: 'Some requirements need confirmation', detail: 'The available evidence leaves important questions open. Ask the venue before you arrive.' },
  reported_barrier: { title: 'A must-have barrier was reported', detail: 'Public evidence reports a barrier to a requirement you selected. Confirm the specific access options with the venue.' },
  evidence_supports_requirements: { title: 'Public evidence supports your requirements', detail: 'Public evidence supports these selected requirements; current conditions still need confirmation.' },
};

export function VisitBrief({ report, jobId, headingRef }: { report: Report; jobId: string; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const fit = overall[report.overall];
  const selected = report.requirements.filter(requirement => requirement.priority !== 'not_needed');
  const mustHave = selected.filter(requirement => requirement.priority === 'must_have');
  const supported = mustHave.filter(requirement => requirement.status === 'supported').length;
  const phone = report.venue.phone && /^[+\d()\s.-]{3,100}$/.test(report.venue.phone) ? report.venue.phone.replace(/[^+\d]/g, '') : null;
  return <div className="brief-layout">
    <section className="visit-brief" aria-labelledby="report-heading"><div className="brief-venue"><span className="eyebrow">Your visit brief {report.isPartial ? '· partial result' : ''}</span><h2 id="report-heading" tabIndex={-1} ref={headingRef}>{report.venue.name}</h2><p>{report.venue.address || 'Address not supplied by the source'}</p><p className="small muted">Generated <time dateTime={report.generatedAt}>{formatDate(report.generatedAt, true)}</time></p></div>
      <div className={`overall-fit fit-${report.overall}`}><span className="fit-symbol" aria-hidden="true">{report.overall === 'reported_barrier' ? '!' : report.overall === 'needs_confirmation' ? '?' : '✓'}</span><div><h3>{fit.title}</h3><p>{fit.detail}</p>{report.isPartial && <p className="partial-note"><strong>This brief is partial.</strong> An incomplete evidence stage may have omitted relevant information.</p>}</div></div>
      <div className="brief-actions"><a className="button secondary" href={mapsHref(report.venue)} target="_blank" rel="noopener noreferrer">Open venue in Google Maps <span aria-hidden="true">↗</span></a>{phone && <a className="text-button" href={`tel:${phone}`}>Call {report.venue.phone}</a>}<button type="button" className="text-button" onClick={() => window.print()}>Print brief</button><a className="text-button" href={`/api/jobs/${encodeURIComponent(jobId)}/export`} download>Export JSON</a></div>
      <div className="coverage-line"><h3>Requirement by requirement</h3><span>{supported} / {mustHave.length} must-haves supported <span className="muted">· evidence coverage</span></span></div>
      {selected.length > 0 ? <div className="requirement-cards">{selected.map(requirement => <RequirementCard key={requirement.feature} requirement={requirement} />)}</div> : <p className="empty-panel">Select at least one must-have requirement to assess the fit of this venue.</p>}
      <section className="questions-panel" aria-labelledby="question-heading"><span className="eyebrow">Before you arrive</span><h3 id="question-heading">Questions for the venue</h3><p className="small muted">These questions come from evidence gaps. They have not been sent to the venue.</p>{report.questions.length ? <ol>{report.questions.slice(0, 3).map(question => <li key={question}>{question}</li>)}</ol> : <p>Confirm the selected access requirements and current conditions directly before your visit.</p>}</section>
      <section className="limitations-panel" aria-labelledby="limitations-heading"><h3 id="limitations-heading">What this brief can tell you</h3><p>{report.reviewsExamined} review{report.reviewsExamined === 1 ? '' : 's'} examined in a bounded sample. This is public evidence, not certification or a complete inspection of the venue.</p>{report.limitations.length > 0 && <ul>{report.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul>}<p className="small muted">Assessment policy {report.algorithmVersion} · extractor {report.extractorVersion}</p></section>
    </section>
    <EvidencePanel report={report} />
  </div>;
}
