'use client';

import type { Venue } from './ui-contracts';
import { mapsHref } from './ui-contracts';

export function VenueCandidates({ candidates, busy, select }: { candidates: Venue[]; busy: boolean; select: (venue: Venue) => void }) {
  if (candidates.length === 0) return <section className="empty-panel"><h2>No matching venue was returned</h2><p>Try a more specific venue name or neighborhood. No accessibility conclusion can be drawn from an empty search result.</p></section>;
  return <section className="candidates-panel" aria-labelledby="candidate-heading"><div className="section-heading"><div><span className="eyebrow">Choose the exact branch</span><h2 id="candidate-heading">{candidates.length} venue{candidates.length === 1 ? '' : 's'} found</h2></div></div><p className="small muted">A search result is not an accessibility assessment. Check the address before selecting.</p><div className="candidate-list">{candidates.slice(0, 5).map(venue => <article className="candidate-card" key={venue.id}>
    <div className="candidate-icon" aria-hidden="true">⌂</div><div className="candidate-body"><div className="candidate-title"><h3>{venue.name}</h3><span className="status-badge neutral">Not yet assessed</span></div><p>{venue.address || 'Address not supplied by the source'}</p><div className="candidate-meta">{venue.category && <span>{venue.category}</span>}{venue.rating !== null && venue.rating !== undefined && <span>{venue.rating} ★ general venue rating</span>}</div>{venue.provisional && <p className="small warning-text">No usable provider identifier was supplied. Evidence availability may be limited.</p>}<a className="source-link" href={mapsHref(venue)} target="_blank" rel="noopener noreferrer">View {venue.name} venue listing <span aria-hidden="true">↗</span></a></div>
    <button type="button" className="button secondary" disabled={busy} onClick={() => select(venue)}>Investigate this venue <span aria-hidden="true">→</span></button>
  </article>)}</div></section>;
}
