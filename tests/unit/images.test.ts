import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeImageUrl } from "../../lib/evidence/images";
import { sanitizePayload } from "../../lib/providers/serpapi";
import { normalizeDetails } from "../../lib/adapters/place";
import { normalizeReviews } from "../../lib/adapters/reviews";
import { immutableTextBatches } from "../../lib/evidence/normalize";
import { publicExtractionInput } from "../../lib/providers/gemini";
import { buildReport } from "../../lib/assessment";
import { ADAPTER_VERSION, cacheKey } from "../../lib/workflow/cache";
import { stable } from "../../lib/server/crypto";
import type { Venue } from "../../lib/contracts";

const asOf = "2026-10-12T06:00:00.000Z";
const venue: Venue = { id: "synthetic-photo-venue", name: "Synthetic Photo Cafe", address: "Synthetic Street", googlePlaceId: "synthetic-place-id", dataCid: null, dataId: null, website: null, phone: null, category: null, sourceUrl: null, latitude: null, longitude: null, rating: null, provisional: false };
const photo = (n: number) => `https://lh3.googleusercontent.com/p/synthetic-photo-${n}=w400-h300-k-no`;
const reviewLink = "https://www.google.com/maps/reviews/data=synthetic-review";

describe("supplementary public photos", () => {
  it("accepts only documented public Google photo hosts and paths", () => {
    for (const host of ["lh1", "lh2", "lh3", "lh4", "lh5", "lh6"]) for (const path of ["p", "gps-cs-s", "grass-cs"]) {
      const url = `https://${host}.googleusercontent.com/${path}/synthetic-photo=w150-h150-k-no-p`;
      expect(safeImageUrl(url)).toBe(url);
    }
  });

  it("rejects profiles, credentials, redirects, arbitrary hosts, ports and unsafe schemes", () => {
    const rejected = [
      "https://lh3.googleusercontent.com/a-/synthetic-profile=s120-c",
      "https://lh3.googleusercontent.com/a/synthetic-profile=s120-c",
      "https://lh3.googleusercontent.com/local-reviews/synthetic-profile=s120-c",
      "https://lh3.googleusercontent.com/proxy/synthetic",
      "https://lh7.googleusercontent.com/p/synthetic",
      "https://lh3.googleusercontent.com.evil.example/p/synthetic",
      "https://photos.example/p/synthetic",
      "https://serpapi.com/images/url/synthetic",
      "http://lh3.googleusercontent.com/p/synthetic",
      "//lh3.googleusercontent.com/p/synthetic",
      "javascript:alert(1)", "data:image/svg+xml,synthetic", "file:///synthetic",
      "https://name:credential@lh3.googleusercontent.com/p/synthetic",
      "https://lh3.googleusercontent.com:443/p/synthetic",
      "https://lh3.googleusercontent.com:8443/p/synthetic",
      `${photo(1)}?api_key=synthetic-secret`, `${photo(1)}?api%5fkey=synthetic-secret`,
      `${photo(1)}?TOKEN=synthetic-secret`, `${photo(1)}?authorization=synthetic-secret`,
      `${photo(1)}#synthetic-secret`, "https://lh3.googleusercontent.com/p/%2Fsynthetic",
      "https://lh3.googleusercontent.com/p/../a-/synthetic", ` ${photo(1)}`,
      `${photo(1)}\n`, `https://lh3.googleusercontent.com/p/${"x".repeat(2048)}`,
    ];
    for (const url of rejected) expect(safeImageUrl(url), url).toBeNull();
    for (const value of [null, undefined, {}, 1]) expect(safeImageUrl(value)).toBeNull();
  });

  it("sanitizes documented fields while preserving provenance positions and excluding private profiles", () => {
    const payload = sanitizePayload({ place_results: { title: venue.name, place_id: venue.googlePlaceId, thumbnail: photo(0), photos_link: "https://serpapi.com/?api_key=synthetic-secret", images: [{ thumbnail: "https://lh3.googleusercontent.com/a-/private-profile" }, { thumbnail: photo(1), title: "Private nested title", private: "synthetic-secret" }, { thumbnail: photo(2) }, { thumbnail: photo(3) }, { thumbnail: photo(4) }] },
      reviews: [{ review_id: "synthetic-review", snippet: "A public text excerpt.", images: ["https://lh3.googleusercontent.com/a-/private-profile", photo(1), photo(2)], user: { name: "Private reviewer name", thumbnail: photo(3) } }] });
    expect((payload.place_results as Record<string, unknown>).images).toEqual([null, { thumbnail: photo(1) }, { thumbnail: photo(2) }, { thumbnail: photo(3) }]);
    expect((payload.reviews as Record<string, unknown>[])[0].images).toEqual([null, photo(1)]);
    expect(JSON.stringify(payload)).not.toMatch(/synthetic-secret|Private reviewer|Private nested|private-profile|photos_link|api_key/);
    const listing = normalizeDetails(payload, venue, asOf, "synthetic-search");
    expect(listing.venue.images?.[1].jsonPointer).toBe("/place_results/images/1/thumbnail");
    const review = normalizeReviews(payload, venue, asOf, "synthetic-search");
    expect(review.sources[0].images?.[0].jsonPointer).toBe("/reviews/0/images/1");
  });

  it("records bounded listing references without manufacturing accessibility text or photo dates", () => {
    const payload = { place_results: { title: venue.name, place_id: venue.googlePlaceId, thumbnail: photo(0), images: Array.from({ length: 8 }, (_, n) => ({ thumbnail: photo(n), title: "Entrance with wheelchair ramp" })) } };
    const result = normalizeDetails(payload, venue, asOf, "synthetic-search");
    expect(result.venue.images).toHaveLength(4);
    expect(result.sources).toEqual([]); expect(result.claims).toEqual([]);
    expect(result.venue.images?.every((image) => image.capturedAt === null && image.retrievedAt === asOf && image.sourceUrl === result.venue.sourceUrl && image.providerSearchId === "synthetic-search")).toBe(true);
    expect(JSON.stringify(result.venue.images)).not.toContain("Entrance with wheelchair ramp");
    const report = buildReport({ venue: result.venue, requirements: [{ feature: "entrance_step_free", priority: "must_have" }], sources: result.sources, claims: result.claims, asOf });
    expect(report.overall).toBe("needs_confirmation"); expect(report.requirements[0].status).toBe("insufficient");
  });

  it("keeps earlier listing image snapshots when a later details response has no images", () => {
    const first = normalizeDetails({ place_results: { title: venue.name, place_id: venue.googlePlaceId, thumbnail: photo(0) } }, venue, asOf, "synthetic-search").venue;
    const later = normalizeDetails({ place_results: { title: venue.name, place_id: venue.googlePlaceId } }, first, "2026-10-12T07:00:00Z", "later-search");
    expect(later.venue.images).toEqual(first.images);
  });

  it("photo identity is repeatable for the same observation and changes for later observations", () => {
    const payload = { place_results: { title: venue.name, place_id: venue.googlePlaceId, thumbnail: photo(0) } };
    const first = normalizeDetails(payload, venue, asOf, "synthetic-search").venue.images![0];
    expect(normalizeDetails(payload, venue, asOf, "synthetic-search").venue.images![0]).toEqual(first);
    expect(normalizeDetails(payload, venue, "2026-10-12T07:00:00Z", "synthetic-search").venue.images![0].id).not.toBe(first.id);
  });

  it("keeps review-linked photos with original publication metadata but unknown photo capture dates", () => {
    const result = normalizeReviews({ reviews: [{ review_id: "synthetic-review", link: reviewLink, snippet: "The entrance has steps.", iso_date: "2025-01-01T00:00:00Z", iso_date_of_last_edit: asOf, images: [photo(1), photo(2), photo(3)], user: { name: "Private reviewer name", thumbnail: photo(4) } }] }, venue, asOf, "synthetic-search");
    const source = result.sources[0];
    expect(source.images).toHaveLength(2); expect(source.text).toBe("The entrance has steps.");
    expect(source.publishedAt).toBe("2025-01-01T00:00:00Z");
    expect(source.images?.every((image) => image.sourceUrl === reviewLink && image.capturedAt === null && image.attribution === "Google Maps review photo")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Private reviewer name|synthetic-photo-4/);
    expect(JSON.stringify(publicExtractionInput([source], venue))).not.toMatch(/googleusercontent|images|capturedAt/);
  });

  it("retains distinct identified photo-only reviews, with no invented text and no extraction batches", () => {
    const result = normalizeReviews({ reviews: [{ review_id: "synthetic-review-1", link: reviewLink, images: [photo(1)] }, { review_id: "synthetic-review-2", images: [photo(2)] }, { images: [photo(3)] }, { review_id: "synthetic-review-4", images: ["https://lh3.googleusercontent.com/a-/private-profile"] }] }, venue, asOf, "synthetic-search");
    expect(result.sources).toHaveLength(2); expect(result.reviewsExamined).toBe(4);
    expect(result.sources.every((source) => source.text === "" && source.translatedText === null)).toBe(true);
    expect(new Set(result.sources.map((source) => source.sourceGroupKey)).size).toBe(2);
    expect(immutableTextBatches(result.sources)).toEqual([]);
    const report = buildReport({ venue, requirements: [{ feature: "lift_operational", priority: "must_have" }], sources: result.sources, claims: [], asOf });
    expect(report.overall).toBe("needs_confirmation"); expect(report.claims).toEqual([]);
  });

  it("malformed or absent optional photo fields do not fail text extraction or create placeholders", () => {
    const listing = normalizeDetails({ place_results: { title: venue.name, place_id: venue.googlePlaceId, thumbnail: { url: photo(1) }, images: { thumbnail: photo(2) } } }, venue, asOf, null);
    expect(listing.venue.images).toBeUndefined();
    const result = normalizeReviews({ reviews: [{ review_id: "synthetic-review", snippet: "Literal text survives.", images: [{ thumbnail: photo(1) }], user: { thumbnail: photo(2) } }] }, venue, asOf, null);
    expect(result.sources[0].images).toBeUndefined(); expect(immutableTextBatches(result.sources)[0][0].text).toBe("Literal text survives.");
  });

  it("invalid branch details cannot attach photos to the selected venue", () => {
    expect(() => normalizeDetails({ place_results: { title: venue.name, place_id: "another-branch", thumbnail: photo(1) } }, venue, asOf, null)).toThrow("Place response does not match the selected branch");
  });

  it("refreshes Maps photo caches while preserving existing Google snippet cache identity", () => {
    const oldKey = (params: Record<string, string>) => createHash("sha256").update(stable({ params, version: "serpapi-shapes-v1", locale: params.hl || "en" })).digest("hex");
    const google = { engine: "google", q: "Synthetic venue access", hl: "en" };
    const place = { engine: "google_maps", place_id: "synthetic-place-id", hl: "en" };
    const reviews = { engine: "google_maps_reviews", place_id: "synthetic-place-id", hl: "en" };
    expect(cacheKey(google)).toBe(oldKey(google));
    expect(cacheKey(place)).not.toBe(oldKey(place)); expect(cacheKey(reviews)).not.toBe(oldKey(reviews));
    expect(ADAPTER_VERSION).toBe("serpapi-shapes-v2-images");
  });
});
