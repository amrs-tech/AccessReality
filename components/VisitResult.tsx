import type { Report } from '../lib/contracts';
import { featureLabels } from './ui-contracts';

// A partial corpus cannot authorize a favorable fit. Reported barriers remain
// visible even when some other evidence could not be accepted.
export function displayedFit(report: Report): Report['overall'] {
  return report.isPartial && report.overall === 'evidence_supports_requirements'
    ? 'needs_confirmation'
    : report.overall;
}

export function partialEvidenceReason(report: Report): string {
  const validationRejected = report.limitations.some(limitation => [
    'Stage unavailable or incomplete: extraction_validation_rejected.',
    'Unavailable stage: extraction_validation_rejected.',
  ].includes(limitation));
  return validationRejected
    ? 'Some extracted claims could not be verified against their sources and were excluded.'
    : 'Some evidence could not be fully validated or processed.';
}

const headlines = {
  evidence_supports_requirements: 'Your must-haves are supported by the available evidence.',
  reported_barrier: 'A reported barrier conflicts with your must-haves.',
  needs_confirmation: 'Requirements not confirmed — check with the venue before visiting.',
};

export function VisitResult({ report, viewDetails }: { report: Report; viewDetails: () => void }) {
  const fit = displayedFit(report);
  const mustHaves = report.requirements.filter(requirement => requirement.priority === 'must_have');
  const supported = mustHaves.filter(requirement => requirement.status === 'supported');
  const barriers = mustHaves.filter(requirement => requirement.status === 'barrier_reported');
  const conflicts = mustHaves.filter(requirement => requirement.status === 'conflicting');
  const unconfirmed = mustHaves.filter(requirement => ['insufficient', 'historical_only'].includes(requirement.status));
  const names = (requirements: typeof mustHaves) => requirements.map(requirement => featureLabels[requirement.feature]).join(', ');
  return <section className={`visit-result result-${fit}`} aria-labelledby="visit-result-heading">
    <div className="result-context"><span className="eyebrow">Your visit result</span><span className="result-venue">{report.venue.name}{report.venue.address && <span className="result-address">{report.venue.address}</span>}</span></div>
    <div className="result-headline-row"><span className="result-symbol" aria-hidden="true">{fit === 'reported_barrier' ? '!' : fit === 'needs_confirmation' ? '?' : '✓'}</span><h2 id="visit-result-heading" aria-live="polite" aria-atomic="true">{headlines[fit]}</h2></div>
    <div className="result-reasons">
      {mustHaves.length === 0 ? <p>Select at least one must-have requirement to assess whether this venue meets your needs.</p> : <p className="result-coverage"><strong>{supported.length} of {mustHaves.length} must-haves</strong> {supported.length === 1 ? 'has' : 'have'} supporting evidence.</p>}
      {barriers.length > 0 && <p><strong>Reported barriers:</strong> {names(barriers)}.</p>}
      {conflicts.length > 0 && <p><strong>Conflicting evidence:</strong> {names(conflicts)}.</p>}
      {unconfirmed.length > 0 && <p><strong>Still to confirm:</strong> {names(unconfirmed)}.</p>}
      {fit === 'evidence_supports_requirements' && <p>These are public observations. Confirm current conditions with the venue before arrival.</p>}
      {fit === 'reported_barrier' && <p>Ask the venue about the reported barrier and any access options for this visit.</p>}
    </div>
    {report.isPartial && <div className="result-incomplete"><strong>Evidence is partial</strong><p>{partialEvidenceReason(report)} The result uses only accepted evidence. {report.overall === 'evidence_supports_requirements' && 'Supporting observations alone cannot establish a favorable result from this partial brief.'}</p></div>}
    <a href="#report-heading" className="result-details-link" onClick={event => { event.preventDefault(); viewDetails(); }}>View detailed report <span aria-hidden="true">↓</span></a>
  </section>;
}
