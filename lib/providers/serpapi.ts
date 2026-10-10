import "server-only";
import { object, safeUrl, string } from "../evidence/normalize";
import { ProviderError } from "./errors";
export interface SerpApiOptions { apiKey: string; fetch?: typeof fetch; now?: () => Date; timeoutMs?: number }
export interface SerpApiResult { payload: Record<string, unknown>; providerSearchId: string | null; retrievedAt: string; durationMs: number }
const ALLOWED_PARAMS = new Set(["engine", "type", "q", "hl", "gl", "place_id", "data_cid", "data_id", "sort_by", "query", "num", "next_page_token"]);
function retryAfter(value: string | null): number | null { if (!value) return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.min(n, 60) : null; }
async function request(endpoint: "search" | "account", params: Record<string, string>, options: SerpApiOptions): Promise<SerpApiResult> {
  if (!options.apiKey) throw new ProviderError("configuration", "SerpApi is not configured");
  const url = new URL(endpoint === "search" ? "https://serpapi.com/search.json" : "https://serpapi.com/account.json");
  for (const [key, value] of Object.entries(params)) { if (!ALLOWED_PARAMS.has(key) || value.length > 3500) throw new ProviderError("configuration", "Unsupported search parameters"); url.searchParams.set(key, value); }
  if (endpoint === "search" && !["google_maps", "google_maps_reviews", "google"].includes(params.engine)) throw new ProviderError("configuration", "Unsupported search engine");
  url.searchParams.set("api_key", options.apiKey);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; const started = Date.now();
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError("timeout", "SerpApi timed out; the dispatch may have consumed an attempt", false, true)); }, Math.max(1, Math.min(options.timeoutMs ?? 25000, 25000))); });
  try {
    return await Promise.race([(async () => {
    const response = await (options.fetch ?? fetch)(url, { signal: controller.signal, cache: "no-store", redirect: "manual" });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new ProviderError("forbidden", "SerpApi rejected account access");
      if (response.status === 429) throw new ProviderError("quota", "SerpApi rate limit reached", true, false, retryAfter(response.headers.get("retry-after")));
      throw new ProviderError("upstream", `SerpApi returned HTTP ${response.status}`, response.status >= 500, false, retryAfter(response.headers.get("retry-after")));
    }
    const reader = response.body?.getReader(); let body = "";
    if (reader) { const decoder = new TextDecoder(); let bytes = 0;
      while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 1_000_000) { await reader.cancel(); throw new ProviderError("schema_drift", "SerpApi response exceeds the bounded adapter limit"); } body += decoder.decode(chunk.value, { stream: true }); } body += decoder.decode();
    } else body = await response.text();
    let payload: Record<string, unknown> | null; try { payload = object(JSON.parse(body)); } catch { throw new ProviderError("schema_drift", "SerpApi returned invalid JSON"); }
    if (!payload) throw new ProviderError("schema_drift", "SerpApi returned a non-object response");
    if (payload.error !== undefined) throw new ProviderError("provider_error", "SerpApi reported an upstream error");
    return { payload: endpoint === "account" ? payload : sanitizePayload(payload), providerSearchId: string(object(payload.search_metadata)?.id, 100), retrievedAt: (options.now?.() ?? new Date()).toISOString(), durationMs: Date.now() - started };
    })(), deadline]);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError("timeout", "SerpApi timed out; the dispatch may have consumed an attempt", false, true);
    throw new ProviderError("network", "SerpApi connection failed; the dispatch may have consumed an attempt", false, true);
  } finally { if (timer) clearTimeout(timer); }
}
function sanitizedPlace(value: unknown): unknown {
  const place = object(value); if (!place) return null;
  const result: Record<string, unknown> = {};
  for (const [key, max] of Object.entries({ title: 240, place_id: 300, data_cid: 300, data_id: 300, address: 500, phone: 100 })) result[key] = string(place[key], max);
  result.type = Array.isArray(place.type) ? place.type.slice(0, 8).map((entry) => string(entry, 200)).filter(Boolean) : string(place.type, 200);
  result.rating = typeof place.rating === "number" && Number.isFinite(place.rating) ? place.rating : null;
  const gps = object(place.gps_coordinates); result.gps_coordinates = { latitude: typeof gps?.latitude === "number" && Number.isFinite(gps.latitude) ? gps.latitude : null, longitude: typeof gps?.longitude === "number" && Number.isFinite(gps.longitude) ? gps.longitude : null };
  result.website = safeUrl(place.website);
  for (const key of ["extensions", "unsupported_extensions"]) if (place[key] !== undefined) result[key] = Array.isArray(place[key]) ? (place[key] as unknown[]).slice(0, 32).map((item) => { const extension = object(item); return extension && Array.isArray(extension.accessibility) ? { accessibility: extension.accessibility.slice(0, 24).map((v) => typeof v === "string" ? v.slice(0, 300) : null) } : {}; }) : null;
  return result;
}
export function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { search_metadata: { id: string(object(payload.search_metadata)?.id, 100), status: string(object(payload.search_metadata)?.status, 100) } };
  const information = object(payload.search_information);
  if (information?.reviews_results_state !== undefined) out.search_information = { reviews_results_state: string(information.reviews_results_state, 100) };
  if (payload.local_results !== undefined) out.local_results = Array.isArray(payload.local_results) ? payload.local_results.slice(0, 5).map(sanitizedPlace) : null;
  if (payload.place_results !== undefined) out.place_results = sanitizedPlace(payload.place_results);
  if (payload.reviews !== undefined) out.reviews = Array.isArray(payload.reviews) ? payload.reviews.slice(0, 20).map((item) => { const r = object(item); if (!r) return null;
    const e = object(r.extracted_snippet); const original = typeof e?.original === "string" ? e.original : typeof r.snippet === "string" ? r.snippet : "";
    return { review_id: string(r.review_id, 300), link: safeUrl(r.link), snippet: string(r.snippet, 4000), date: string(r.date, 100), iso_date: string(r.iso_date, 100), iso_date_of_last_edit: string(r.iso_date_of_last_edit, 100), language: string(r.language, 50), truncated: original.length > 4000, extracted_snippet: e ? { original: string(e.original, 4000), translated: string(e.translated, 4000) } : null };
  }) : null;
  if (payload.organic_results !== undefined) out.organic_results = Array.isArray(payload.organic_results) ? payload.organic_results.slice(0, 8).map((item) => { const r = object(item); return r ? { title: string(r.title, 300), snippet: string(r.snippet, 4000), link: safeUrl(r.link), date: string(r.date, 100) } : null; }) : null;
  if (payload.topics !== undefined) out.topics = Array.isArray(payload.topics) ? payload.topics.slice(0, 20).map((topic) => ({ keyword: string(object(topic)?.keyword, 100) })) : [];
  const pagination = object(payload.serpapi_pagination); if (pagination) out.serpapi_pagination = { next_page_token: string(pagination.next_page_token, 3000) };
  return out;
}
export function serpapiSearch(params: Record<string, string>, options: SerpApiOptions): Promise<SerpApiResult> { return request("search", params, options); }
export async function inspectAccount(options: SerpApiOptions): Promise<{ remaining: number; checkedAt: string }> {
  const result = await request("account", {}, options); const remaining = result.payload.total_searches_left;
  if (typeof remaining !== "number" || !Number.isSafeInteger(remaining) || remaining < 0) throw new ProviderError("schema_drift", "SerpApi allowance response has no valid remaining count");
  return { remaining, checkedAt: result.retrievedAt };
}
