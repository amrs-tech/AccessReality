import { randomUUID } from "node:crypto";
import type { Venue } from "../contracts";
import { mapsUrl, object, safeUrl, string } from "../evidence/normalize";
import { ProviderError } from "../providers/errors";
export function normalizeVenue(value: unknown, id?: string): Venue | null {
  const data = object(value); if (!data || !string(data.title, 240)) return null;
  const gps = object(data.gps_coordinates); const googlePlaceId = string(data.place_id, 300), dataCid = string(data.data_cid, 300), dataId = string(data.data_id, 300);
  const venue: Venue = { id: id ?? randomUUID(), name: string(data.title, 240)!, address: string(data.address, 500), googlePlaceId, dataCid, dataId,
    website: safeUrl(data.website), phone: string(data.phone, 100), category: string(data.type, 200) ?? (Array.isArray(data.type) ? string(data.type[0], 200) : null),
    latitude: typeof gps?.latitude === "number" && Math.abs(gps.latitude) <= 90 ? gps.latitude : null,
    longitude: typeof gps?.longitude === "number" && Math.abs(gps.longitude) <= 180 ? gps.longitude : null,
    rating: typeof data.rating === "number" && data.rating >= 0 && data.rating <= 5 ? data.rating : null,
    sourceUrl: null, provisional: !googlePlaceId && !dataCid,
  }; venue.sourceUrl = mapsUrl(venue); return venue;
}
export function normalizeDiscovery(payload: unknown): Venue[] {
  const data = object(payload); if (!data) throw new ProviderError("schema_drift", "Discovery response is not an object");
  const rows = Array.isArray(data.local_results) ? data.local_results : object(data.place_results) ? [data.place_results] : null;
  if (!rows) throw new ProviderError("schema_drift", "Discovery response is missing its documented results field");
  const candidates = rows.slice(0, 5).map((row) => normalizeVenue(row)).filter((venue): venue is Venue => venue !== null);
  if (rows.length && !candidates.length) throw new ProviderError("schema_drift", "Discovery results have no recognizable venue identity");
  return candidates;
}
export function discoveryParams(query: string, city: string): Record<string, string> { return { engine: "google_maps", type: "search", q: `${query.replace(/\s+/g, " ").trim()} in ${city.replace(/\s+/g, " ").trim()} India`, hl: "en" }; }
