import type { Feature, Source, Venue } from "../contracts";
import { makeSource, object, string } from "../evidence/normalize";
import { snippetVenueMatch } from "../evidence/venue-match";
import { ProviderError } from "../providers/errors";
export const FEATURE_TERMS: Record<Feature, string> = { arrival_step_free: "step free arrival parking drop off", entrance_step_free: "wheelchair entrance ramp", interior_movement: "wheelchair inside movement", accessible_seating: "wheelchair seating table", accessible_restroom: "wheelchair accessible restroom toilet", accessible_parking: "accessible parking", lift_present: "lift elevator", lift_operational: "lift elevator working broken" };
function quoted(value: string): string { return `"${value.replace(/["\\\r\n]/g, " ").replace(/\s+/g, " ").trim()}"`; }
export function webParams(venue: Venue, feature: Feature, ownedDomain = false): Record<string, string> {
  const query = [quoted(venue.name), venue.address ? quoted(venue.address) : "", FEATURE_TERMS[feature]];
  if (ownedDomain && venue.website) { try { query.unshift(`site:${new URL(venue.website).hostname}`); } catch { /* A bad provider URL is never fetched. */ } }
  return { engine: "google", q: query.filter(Boolean).join(" "), gl: "in", hl: "en" };
}
export function normalizeWeb(payload: unknown, venue: Venue, retrievedAt: string, providerSearchId: string | null): Source[] {
  const data = object(payload);
  if (data?.error !== undefined) {
    if (data.error === "Google hasn't returned any results for this query." && object(data.search_metadata)?.status === "Success"
      && object(data.search_information)?.organic_results_state === "Fully empty"
      && (data.organic_results === undefined || (Array.isArray(data.organic_results) && data.organic_results.length === 0))) return [];
    throw new ProviderError("provider_error", "Web search returned an unrecognized error");
  }
  if (!data || !Array.isArray(data.organic_results)) throw new ProviderError("schema_drift", "Web response is missing organic_results");
  return data.organic_results.slice(0, 8).flatMap((item) => {
    const result = object(item); if (!result) return []; const snippet = string(result.snippet, 8000), title = string(result.title, 300); if (!snippet) return [];
    return [makeSource({ venueId: venue.id, kind: "search_snippet", text: snippet, sourceUrl: string(result.link, 2048), providerReviewId: null, providerSearchId, engine: "google", retrievedAt,
      publishedAt: null, editedAt: null, observedAt: null, selectionMethod: "web_query", metadata: { title, relativeDate: string(result.date, 100), venueMatch: snippetVenueMatch(venue, title ?? "", snippet), truncated: true, qualification: "Search snippet only; full page was not reviewed." } })];
  });
}
