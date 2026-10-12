'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { EvidenceImage, Report } from '../lib/contracts';
import { safeImageUrl } from '../lib/evidence/images';
import { formatDate, safeHref } from './ui-contracts';

const DISPLAY_LIMIT = 12;

type GalleryImage = { image: EvidenceImage; url: string; sourceId: string | null };

function availableImages(report: Report): GalleryImage[] {
  const attached = report.sources.flatMap(source => (source.images ?? []).map(image => ({ image, sourceId: source.id })));
  const candidates = [
    ...(report.venue.images ?? []).map(image => ({ image, sourceId: attached.find(item => item.image.url === image.url)?.sourceId ?? null })),
    ...attached,
  ];
  const seen = new Set<string>();
  return candidates.flatMap(item => {
    const url = safeImageUrl(item.image.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ ...item, url }];
  });
}

function SourcePhoto({ entry, index, venueName }: { entry: GalleryImage; index: number; venueName: string }) {
  const [failed, setFailed] = useState(false);
  const sourceLink = safeHref(entry.image.sourceUrl);
  return <figure className="evidence-photo">
    <div className="evidence-photo-frame">
      {failed ? <p className="photo-unavailable">Photo unavailable. The original source link is kept below.</p> : <a href={entry.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Open supplementary photo ${index + 1} for ${venueName}`}>
        <Image src={entry.url} alt={`Supplementary photo ${index + 1} supplied by ${entry.image.attribution} for ${venueName}`} fill unoptimized loading="lazy" sizes="(max-width: 600px) 100vw, 50vw" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </a>}
    </div>
    <figcaption>
      <p className="photo-attribution">{entry.image.attribution}</p>
      <p className="photo-date">Photo date unknown</p>
      <p className="photo-retrieved">Retrieved {formatDate(entry.image.retrievedAt, true)}</p>
      <div className="photo-links">{sourceLink ? <a href={sourceLink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">View original photo source <span aria-hidden="true">↗</span></a> : <span>No public photo source link supplied.</span>}{entry.sourceId && <a href={`#source-${entry.sourceId}`}>Read linked source</a>}</div>
      {sourceLink && <span className="print-url">{sourceLink}</span>}
    </figcaption>
  </figure>;
}

export function EvidenceImages({ report }: { report: Report }) {
  const images = availableImages(report);
  const displayed = images.slice(0, DISPLAY_LIMIT);
  return <section className="evidence-images" aria-labelledby="photos-heading">
    <div className="photo-section-heading"><h3 id="photos-heading">Source photos</h3>{displayed.length > 0 && <span className="count-pill">{displayed.length}</span>}</div>
    <p className="photo-context">Supplementary photos supplied by public sources. Images are not analysed and do not establish accessibility, measurements or current lift operation.</p>
    {displayed.length > 0 ? <><div className="evidence-photo-grid">{displayed.map((entry, index) => <SourcePhoto key={entry.url} entry={entry} index={index} venueName={report.venue.name} />)}</div>{images.length > DISPLAY_LIMIT && <p className="photo-limit">Showing the first {DISPLAY_LIMIT} of {images.length} distinct source photos.</p>}</> : <p className="photo-empty">No usable source photos are available in this saved report. Older reports may not have retained photo references; a new investigation can collect photos when the provider supplies them.</p>}
  </section>;
}
