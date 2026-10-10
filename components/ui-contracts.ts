// Browser projection only. Server routes validate all inputs and retain provider secrets.
import type { Feature, Requirements, PublicJob, Venue } from '../lib/contracts';
export type { Feature, Requirements, Priority, Venue } from '../lib/contracts';
export type Job = PublicJob;

export const defaultRequirements: Requirements = [
  { feature: 'arrival_step_free', priority: 'not_needed' }, { feature: 'entrance_step_free', priority: 'must_have' },
  { feature: 'interior_movement', priority: 'not_needed' }, { feature: 'accessible_seating', priority: 'not_needed' },
  { feature: 'accessible_restroom', priority: 'not_needed' }, { feature: 'accessible_parking', priority: 'not_needed' },
  { feature: 'lift_present', priority: 'not_needed' }, { feature: 'lift_operational', priority: 'not_needed' },
];

export const featureLabels: Record<Feature, string> = {
  arrival_step_free: 'Step-free arrival', entrance_step_free: 'Step-free entrance',
  interior_movement: 'Wheelchair-usable movement', accessible_seating: 'Accessible seating',
  accessible_restroom: 'Accessible restroom', accessible_parking: 'Accessible parking',
  lift_present: 'Lift presence', lift_operational: 'Lift operation',
};

export function safeHref(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}

export function formatDate(value?: string | null, includeTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', ...(includeTime ? { timeStyle: 'short', timeZone: 'Asia/Kolkata' } : { timeZone: 'UTC' }) }).format(new Date(value)) + (includeTime ? ' IST' : '');
}

export function mapsHref(venue: Venue) {
  const observed = safeHref(venue.sourceUrl);
  if (observed && /(^|\.)google\.[a-z.]+$/.test(new URL(observed).hostname) && new URL(observed).pathname.includes('/maps')) return observed;
  const params = new URLSearchParams({ api: '1', query: [venue.name, venue.address].filter(Boolean).join(', ') });
  if (venue.googlePlaceId) params.set('query_place_id', venue.googlePlaceId);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
