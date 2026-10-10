import type { Source, Venue } from "../contracts";
import { dedupeSources, makeSource, object, string } from "../evidence/normalize";
import { ProviderError } from "../providers/errors";
export function reviewsParams(venue: Venue, query?: string, nextPageToken?: string): Record<string, string> {
  const id: Record<string, string> | null = venue.dataId ? { data_id: venue.dataId } : venue.googlePlaceId ? { place_id: venue.googlePlaceId } : null;
  if (!id) throw new ProviderError("configuration", "No observed review identifier is available");
  const params: Record<string, string> = { engine: "google_maps_reviews", ...id, hl: "en", sort_by: "newestFirst" };
  if (query) { params.query = query; params.num = "20"; }
  if (nextPageToken) { params.next_page_token = nextPageToken; params.num = "20"; } return params;
}
export function normalizeReviews(payload: unknown, venue: Venue, retrievedAt: string, providerSearchId: string | null, targeted = false): { sources: Source[]; reviewsExamined: number; nextPageToken: string | null; topics: string[] } {
  const data = object(payload); if (!data || !Array.isArray(data.reviews)) throw new ProviderError("schema_drift", "Review response is missing reviews");
  const sources: Source[] = [];
  for (const item of data.reviews.slice(0, 20)) {
    const review = object(item); if (!review) continue; const extracted = object(review.extracted_snippet);
    const original = string(extracted?.original, 16000) ?? string(review.snippet, 16000); if (!original) continue;
    sources.push(makeSource({ venueId: venue.id, kind: "maps_review", text: original, translatedText: string(extracted?.translated, 4000), sourceUrl: string(review.link, 2048), providerReviewId: string(review.review_id, 300), providerSearchId, engine: "google_maps_reviews", retrievedAt,
      publishedAt: string(review.iso_date, 100), editedAt: string(review.iso_date_of_last_edit, 100), observedAt: null, selectionMethod: targeted ? "keyword" : "newest", metadata: { relativeDate: string(review.date, 100), venueMatch: "exact", originalLanguage: string(review.language, 50), truncated: Boolean(review.truncated), sample: targeted ? "Keyword-filtered reviews; not all reviews" : "Newest sampled reviews; not all reviews" } }));
  }
  return { sources: dedupeSources(sources), reviewsExamined: data.reviews.slice(0, 20).length, nextPageToken: string(object(data.serpapi_pagination)?.next_page_token, 3000),
    topics: Array.isArray(data.topics) ? data.topics.slice(0, 20).map((topic) => string(object(topic)?.keyword, 100)).filter((topic): topic is string => topic !== null) : [] };
}
