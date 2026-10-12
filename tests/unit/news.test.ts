import { describe, expect, it, vi } from "vitest";
import { NEWS_CACHE_TTL_MS, newsParams, normalizeNews } from "../../lib/news/normalize";
import { sanitizePayload, serpapiSearch } from "../../lib/providers/serpapi";

const venue = { name: "Synthetic Plaza - Mall in Test City", address: "12 Fictional Road, Test District, Test City, India" };
const AS_OF = "2026-10-12T12:00:00.000Z";
const BRIEF_AT = "2026-10-01T12:00:00.000Z";
function article(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Synthetic Plaza in Test City reopens after maintenance", link: "https://synthetic-news.example/story", source: { name: "Synthetic News" }, iso_date: "2026-10-10T12:00:00Z", ...overrides };
}
function normalize(articles: unknown[], briefAt: string | null = BRIEF_AT) {
  return normalizeNews({ news_results: articles }, venue, "Test City", AS_OF, "synthetic-provider-id", briefAt);
}
function fakeFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

describe("separate bounded Google News context", () => {
  it("uses the dedicated engine and one broad quoted venue/area query", () => {
    expect(newsParams(venue, "Test City")).toEqual({ engine: "google_news", q: '"Synthetic Plaza" "Test City" when:90d', hl: "en", gl: "IN", no_cache: "true" });
    expect(newsParams({ name: 'Synthetic "Hotel"\nTest Branch' }, "Test City").q).toBe('"Synthetic Hotel Test Branch" "Test City" when:90d');
    expect(newsParams({ name: "Synthetic Plaza - Test District" }, "Test City").q).toContain('"Synthetic Plaza - Test District"');
    expect(() => newsParams({ name: " " }, "Test City")).toThrow("venue and area");
  });
  it("compacts a commercial listing descriptor without treating its city query as article evidence", () => {
    const cafe = { name: "Casa Fresco, Indiranagar: All-Day Dining & Café", address: "12 Fictional Road, Indiranagar, Bengaluru, India" };
    expect(newsParams(cafe, "Bengaluru").q).toBe('"Casa Fresco" "Bengaluru" when:90d');
    const result = normalizeNews({ news_results: [article({ title: "Casa Fresco announces new seating", link: "https://synthetic-news.example/cafe" })] }, cafe, "Bengaluru", AS_OF, null);
    expect(result.articles[0].relation).toBe("possible_venue");
    expect(normalizeNews({ news_results: [article({ title: "Casa Fresco announces works in Indiranagar" })] }, cafe, "Bengaluru", AS_OF, null).articles[0].relation).toBe("venue_and_area");
  });
  it("keeps only an observed headline, URL, publisher and publication date", () => {
    const result = normalize([article()]);
    expect(result.articles[0]).toMatchObject({ title: article().title, url: article().link, publisher: "Synthetic News", snippet: null, publishedAt: "2026-10-10T12:00:00.000Z", recency: "recent", relation: "venue_and_area", topics: ["closure", "maintenance"], newerThanBrief: true, jsonPointer: "/news_results/0" });
    expect(result).toMatchObject({ retrievedAt: AS_OF, providerSearchId: "synthetic-provider-id", briefGeneratedAt: BRIEF_AT });
    expect(Date.parse(result.expiresAt) - Date.parse(result.retrievedAt)).toBe(NEWS_CACHE_TTL_MS);
    expect(result.limitations.join(" ")).toMatch(/not whether an incident is ongoing/);
    expect(result.limitations.join(" ")).toMatch(/lift operation remains unknown/);
    expect(result.limitations.join(" ")).toMatch(/full articles were not fetched/);
    expect(JSON.stringify(result)).not.toMatch(/originalQuote|polarity|evidence_supports_requirements/);
  });
  it("flattens documented highlights/stories without following coverage tokens", () => {
    const result = normalize([{ story_token: "do-not-follow", highlight: article(), stories: [article({ link: "https://synthetic-news.example/other", title: "Synthetic Plaza construction in Test District" })] }]);
    expect(result.articles).toHaveLength(2);
    expect(result.articles.map((entry) => entry.jsonPointer)).toEqual(["/news_results/0/highlight", "/news_results/0/stories/0"]);
    expect(JSON.stringify(result)).not.toContain("do-not-follow");
  });
  it("does not borrow venue identity from the query or publisher name", () => {
    const result = normalize([
      article({ title: "Synthetic Plaza reports a closure", link: "https://synthetic-news.example/brand" }),
      article({ title: "Test City construction notice", link: "https://synthetic-news.example/area" }),
      article({ title: "A wholly unrelated restaurant reopens", source: { name: "Synthetic Plaza Test City" }, link: "https://synthetic-news.example/unmatched" }),
    ]);
    expect(result.articles.map((entry) => entry.relation)).toEqual(["possible_venue", "area_context", "unmatched"]);
    expect(normalize([article({ title: "Synthetic Plaza construction notice", snippet: "The Test District branch will undergo works." })]).articles[0].relation).toBe("venue_and_area");
  });
  it("requires whole name/area phrases and does not call a generic mall a matched venue", () => {
    expect(normalize([article({ title: "Synthetic Plazarium closes in Test City" })]).articles[0].relation).toBe("area_context");
    expect(normalize([article({ title: "Synthetic Plaza closes in Test Cityville" })]).articles[0].relation).toBe("possible_venue");
    expect(normalizeNews({ news_results: [article({ title: "Mall closes in Test City" })] }, { name: "Mall", address: null }, "Test City", AS_OF, null).articles[0].relation).toBe("area_context");
    expect(normalizeNews({ news_results: [article({ title: "Synthetic Plaza closes in Delhi" })] }, venue, "Delhi", AS_OF, null).articles[0].relation).toBe("venue_and_area");
  });
  it.each([
    ["2026-09-28T12:00:00Z", "recent"],
    ["2026-09-28T11:59:59Z", "older"],
    ["2026-10-13T00:00:00Z", "unknown"],
    ["2026-02-30T00:00:00Z", "unknown"],
    ["2026-10-10T24:00:00Z", "unknown"],
    ["2026-10-10T12:00:00+24:00", "unknown"],
    ["yesterday", "unknown"],
    [undefined, "unknown"],
  ])("publication recency is strict and never inferred from raw dates: %j", (isoDate, expected) => {
    const entry = normalize([article({ iso_date: isoDate, date: "2 hours ago" })]).articles[0];
    expect(entry.recency).toBe(expected); expect(entry.dateLabel).toBe("2 hours ago");
    if (expected === "unknown") { expect(entry.publishedAt).toBeNull(); expect(entry.newerThanBrief).toBeNull(); }
  });
  it("accepts valid ISO time zones across a UTC date boundary", () => {
    expect(normalize([article({ iso_date: "2026-10-10T00:30:00+05:30" })]).articles[0].publishedAt).toBe("2026-10-09T19:00:00.000Z");
  });
  it("compares only publication time to the original checked brief snapshot", () => {
    expect(normalize([article({ iso_date: BRIEF_AT })]).articles[0].newerThanBrief).toBe(false);
    expect(normalize([article({ iso_date: "2026-09-30T12:00:00Z" })]).articles[0].newerThanBrief).toBe(false);
    expect(normalize([article()], null).articles[0].newerThanBrief).toBeNull();
    expect(normalize([article()], "2026-10-13T12:00:00Z").briefGeneratedAt).toBeNull();
  });
  it("empty results remain unknown with the same explicit limitations", () => {
    const result = normalize([]); expect(result.articles).toEqual([]);
    expect(result.limitations.join(" ")).toContain("does not establish that the venue is open or disruption-free");
  });
  it("caps results, deduplicates publisher URLs and keeps matching articles first", () => {
    const result = normalize([
      article({ title: "Unrelated announcement", link: "https://synthetic-news.example/unrelated" }),
      { stories: Array.from({ length: 12 }, (_, index) => article({ link: `https://synthetic-news.example/story-${index}` })) },
      article({ link: "https://synthetic-news.example/story-0#other" }),
    ]);
    expect(result.articles).toHaveLength(12);
    expect(result.articles.every((entry) => entry.relation === "venue_and_area")).toBe(true);
    expect(new Set(result.articles.map((entry) => entry.url)).size).toBe(12);
    expect(result.articles[0].id).toBe(normalize([
      article({ title: "Unrelated announcement", link: "https://synthetic-news.example/unrelated" }),
      { stories: Array.from({ length: 12 }, (_, index) => article({ link: `https://synthetic-news.example/story-${index}` })) },
    ]).articles[0].id);
  });
  it("rejects missing/malformed result arrays and arbitrary upstream errors", () => {
    for (const payload of [{}, { news_results: {} }, { news_results: null }, { news_results: [], error: "Not an empty-results response" }]) {
      expect(() => normalizeNews(payload, venue, "Test City", AS_OF, null)).toThrow();
    }
    expect(() => normalizeNews({ news_results: [] }, venue, "Test City", "invalid", null)).toThrow("retrieval time");
  });
  it("drops unsafe/missing links and provider links, and limits retained text", () => {
    const result = normalize([
      article({ link: "javascript:alert(1)" }), article({ link: "https://serpapi.com/search.json?api_key=private" }),
      article({ link: null }), article({ link: "https://user:password@synthetic-news.example" }),
      article({ title: "x".repeat(500), snippet: "s".repeat(5000), source: { title: "p".repeat(400) }, link: "https://synthetic-news.example/long?api_key=private" }),
    ]);
    expect(result.articles).toHaveLength(1); expect(result.articles[0].title).toHaveLength(300);
    expect(result.articles[0].snippet).toHaveLength(2000); expect(result.articles[0].publisher).toHaveLength(180);
    expect(result.articles[0].url).toBe("https://synthetic-news.example/long");
  });
});

describe("Google News server-only provider boundary", () => {
  it("uses one fixed-endpoint request and removes credentials, pictures and profile details", async () => {
    const raw = { search_metadata: { id: "synthetic-search", status: "Success", json_endpoint: "https://serpapi.com/?api_key=private" }, search_parameters: { api_key: "private" }, news_results: [article({ snippet: "Supplied public snippet", thumbnail: "private-image", story_token: "private-token", source: { name: "Synthetic News", authors: ["private-author"], icon: "private-icon" } })] };
    const fetcher = fakeFetch(raw);
    const response = await serpapiSearch(newsParams(venue, "Test City"), { apiKey: "test-only-secret", fetch: fetcher, now: () => new Date(AS_OF) });
    expect(fetcher).toHaveBeenCalledTimes(1); const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url)).toContain("https://serpapi.com/search.json?"); expect(String(url)).toContain("engine=google_news");
    expect(String(url)).toContain("no_cache=true");
    expect(options?.cache).toBe("no-store"); expect(options?.redirect).toBe("manual");
    expect(response.providerSearchId).toBe("synthetic-search");
    expect(JSON.stringify(response.payload)).not.toMatch(/private|api_key|search_parameters|thumbnail|authors|story_token/);
    expect(normalizeNews(response.payload, venue, "Test City", response.retrievedAt, response.providerSearchId).articles[0].snippet).toBe("Supplied public snippet");
  });
  it.each(["google", "google_maps", "google_maps_reviews"])("the explicit fresh-news flag never broadens existing engine parameters: %s", async (engine) => {
    const fetcher = fakeFetch({});
    await expect(serpapiSearch({ engine, no_cache: "true" }, { apiKey: "test", fetch: fetcher })).rejects.toMatchObject({ code: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("only the fixed fresh-news flag is accepted, without dispatching invalid values", async () => {
    const fetcher = fakeFetch({});
    await expect(serpapiSearch({ engine: "google_news", no_cache: "false" }, { apiKey: "test", fetch: fetcher })).rejects.toMatchObject({ code: "configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes grouped response positions and nested malformed fields without retaining secrets", () => {
    const payload = sanitizePayload({ news_results: [{ title: "Group", highlight: article(), stories: [null, article({ source: { name: { secret: "private" } }, snippet: { secret: "private" } }), { nested: { secret: "private" } }], unrelated: "private" }] });
    const result = normalizeNews(payload, venue, "Test City", AS_OF, null);
    expect(result.articles).toHaveLength(1); expect(result.articles[0].jsonPointer).toBe("/news_results/0/highlight");
    expect(JSON.stringify(payload)).not.toContain("private");
  });
  it("bounds grouped provider leaves and does not let later pages or token URLs through", () => {
    const payload = sanitizePayload({ news_results: Array.from({ length: 20 }, (_, group) => ({ stories: Array.from({ length: 20 }, (_, index) => article({ link: `https://synthetic-news.example/${group}-${index}` })), serpapi_link: "private", story_token: "private" })) });
    expect((payload.news_results as unknown[])).toHaveLength(12);
    const links = JSON.stringify(payload).match(/https:\/\/synthetic-news.example\//g) ?? [];
    expect(links).toHaveLength(32); expect(JSON.stringify(payload)).not.toContain("private");
    expect(normalizeNews(payload, venue, "Test City", AS_OF, null).articles).toHaveLength(12);
  });
  it("accepts only completed successes and never suppresses an unverified empty error", async () => {
    for (const status of [undefined, "Processing", "Error"]) {
      await expect(serpapiSearch(newsParams(venue, "Test City"), { apiKey: "test", fetch: fakeFetch({ search_metadata: { status }, news_results: [] }) })).rejects.toMatchObject({ code: "schema_drift" });
    }
    await expect(serpapiSearch(newsParams(venue, "Test City"), { apiKey: "test", fetch: fakeFetch({ search_metadata: { status: "Success" }, search_information: { organic_results_state: "Fully empty" }, error: "Google hasn't returned any results for this query." }) })).rejects.toMatchObject({ code: "provider_error" });
    const response = await serpapiSearch(newsParams(venue, "Test City"), { apiKey: "test", fetch: fakeFetch({ search_metadata: { status: "Success" }, news_results: [] }) });
    expect(response.payload.news_results).toEqual([]);
  });
  it("accepts the observed completed empty Google News shape and retains its provenance", async () => {
    const response = await serpapiSearch(newsParams(venue, "Test City"), { apiKey: "test", now: () => new Date(AS_OF), fetch: fakeFetch({
      search_metadata: { id: "synthetic-empty-news", status: "Success" },
      search_information: { news_results_state: "Fully empty" },
      error: "Google News hasn't returned any results for this query.",
    }) });
    expect(response.providerSearchId).toBe("synthetic-empty-news");
    const result = normalizeNews(response.payload, venue, "Test City", response.retrievedAt, response.providerSearchId);
    expect(result.articles).toEqual([]);
    expect(result.retrievedAt).toBe(AS_OF);
    expect(result.limitations).toContain("No matching reports does not establish that the venue is open or disruption-free.");
  });
  it.each([
    { search_metadata: { status: "Error" } },
    { search_information: { news_results_state: "Unknown" } },
    { news_results: [article()] },
    { error: "Google News upstream service failed." },
  ])("does not turn an error or contradictory empty-news response into a successful check: %j", async override => {
    await expect(serpapiSearch(newsParams(venue, "Test City"), { apiKey: "test", fetch: fakeFetch({
      search_metadata: { status: "Success" }, search_information: { news_results_state: "Fully empty" },
      error: "Google News hasn't returned any results for this query.", ...override,
    }) })).rejects.toMatchObject({ code: "provider_error" });
  });
});
