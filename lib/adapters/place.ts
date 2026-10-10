import type { EvidenceClaim, Feature, Source, Venue } from "../contracts";
import { claimIdentityId, makeSource, object, string } from "../evidence/normalize";
import { normalizeVenue } from "./maps";
import { ProviderError } from "../providers/errors";
export const ATTRIBUTE_MAPPING_VERSION = "maps-accessibility-labels-v1";
const LABELS: Record<string, Feature> = {
  "Wheelchair accessible entrance": "entrance_step_free", "Wheelchair accessible restroom": "accessible_restroom",
  "Wheelchair accessible seating": "accessible_seating", "Wheelchair accessible parking lot": "accessible_parking",
};
export function detailsParams(venue: Venue): Record<string, string> {
  if (venue.googlePlaceId) return { engine: "google_maps", place_id: venue.googlePlaceId, hl: "en" };
  if (venue.dataCid) return { engine: "google_maps", data_cid: venue.dataCid, hl: "en" };
  throw new ProviderError("configuration", "This candidate has no usable place identifier");
}
export function normalizeDetails(payload: unknown, venue: Venue, retrievedAt: string, providerSearchId: string | null): { venue: Venue; sources: Source[]; claims: EvidenceClaim[] } {
  const place = object(object(payload)?.place_results); if (!place) throw new ProviderError("schema_drift", "Place response is missing place_results");
  const foundPlaceId = string(place.place_id), foundCid = string(place.data_cid);
  if ((venue.googlePlaceId && foundPlaceId && foundPlaceId !== venue.googlePlaceId) || (venue.dataCid && foundCid && foundCid !== venue.dataCid)) throw new ProviderError("schema_drift", "Place response does not match the selected branch");
  const normalized = normalizeVenue(place, venue.id); const updatedVenue = normalized ? { ...venue, ...normalized, googlePlaceId: normalized.googlePlaceId ?? venue.googlePlaceId, dataCid: normalized.dataCid ?? venue.dataCid, dataId: normalized.dataId ?? venue.dataId } : venue;
  const sources: Source[] = [], claims: EvidenceClaim[] = [];
  for (const field of ["unsupported_extensions", "extensions"] as const) {
    const extensions = place[field]; if (extensions === undefined) continue;
    if (!Array.isArray(extensions)) throw new ProviderError("schema_drift", "Place accessibility extension shape changed");
    extensions.slice(0, 32).forEach((extension, index) => {
      const accessibility = object(extension)?.accessibility; if (!Array.isArray(accessibility)) return;
      accessibility.slice(0, 24).forEach((value, itemIndex) => {
        if (typeof value !== "string") return;
        const feature = LABELS[value]; const polarity = field === "unsupported_extensions" ? "barrier" : "supports";
        const pointer = `/place_results/${field}/${index}/accessibility/${itemIndex}`;
        const source = makeSource({ venueId: venue.id, kind: "maps_attribute", text: value, sourceUrl: updatedVenue.sourceUrl, providerReviewId: null, providerSearchId, engine: "google_maps", retrievedAt,
          publishedAt: null, editedAt: null, observedAt: null, selectionMethod: "discovery_attribute", metadata: { jsonPointer: pointer, literalValue: value, venueMatch: "exact", mapped: Boolean(feature), mappingVersion: ATTRIBUTE_MAPPING_VERSION,
            qualification: feature === "entrance_step_free" ? "A broad entrance usability attribute does not establish the full step-free arrival path." : null } });
        sources.push(source); if (!feature) return;
        const scope = { entrance: null, floor: null, facility: null, conditions: [] };
        claims.push({ id: claimIdentityId({ sourceId: source.id, feature, polarity, originalQuote: value, scope, extractorVersion: ATTRIBUTE_MAPPING_VERSION }), venueId: venue.id, sourceId: source.id, feature, polarity, originalQuote: value, scope, quoteStart: null, quoteEnd: null, jsonPointer: pointer,
          observedAt: null, publishedAt: null, editedAt: null, retrievedAt, datePrecision: "unknown", temporalKind: "structural", venueMatch: "exact", extractionStatus: "accepted", extractorVersion: ATTRIBUTE_MAPPING_VERSION, validationFlags: ["undated_listing_attribute", ...(feature === "entrance_step_free" ? ["broad_entrance_attribute"] : [])] });
      });
    });
  }
  return { venue: updatedVenue, sources, claims };
}
