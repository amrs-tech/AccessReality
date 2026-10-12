import type { Venue } from "../contracts";
import { identityUuid } from "../evidence/identity";
import { object, safeUrl, string } from "../evidence/normalize";
import { ProviderError } from "../providers/errors";
import type { NewsArticle, NewsCheckResult, NewsTopic } from "./contracts";

export const NEWS_NORMALIZATION_VERSION = "serpapi-google-news-v1";
export const NEWS_CACHE_TTL_MS = 60 * 60_000;
const DAY = 86_400_000;
const MAX_ARTICLES = 12;
type NewsVenue = Pick<Venue, "name" | "address">;

function normalizedWords(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}
function commercialName(value: string): string {
  // Remove a provider's descriptive listing suffix, while retaining actual branch names.
  return value.split(/[,|:]|\s+[–—-]\s+(?=(?:mall|shopping (?:mall|centre|center)|restaurant|cafe|café|hotel)\s+in\b)/i)[0]
    .replace(/["“”\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}
export function newsParams(venue: Pick<Venue, "name">, city: string): Record<string, string> {
  const name = commercialName(venue.name);
  const area = city.replace(/["“”\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name || !area) throw new ProviderError("configuration", "A venue and area are required for the news check");
  // An explicit check searches this venue broadly. Keyword filtering can hide relevant reports.
  return { engine: "google_news", q: `"${name}" "${area}" when:90d`, hl: "en", gl: "IN", no_cache: "true" };
}
function hasPhrase(text: string, phrase: string): boolean {
  return Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
}
function articleRelation(venue: NewsVenue, city: string, text: string): NewsArticle["relation"] {
  const normalized = normalizedWords(text);
  const name = normalizedWords(commercialName(venue.name));
  const genericName = /^(?:mall|restaurant|cafe|café|hotel|shopping (?:centre|center|mall))$/.test(name);
  const nameMatch = !genericName && hasPhrase(normalized, name);
  const locality = [normalizedWords(city), ...(venue.address?.split(",") ?? []).map(normalizedWords)
    .filter((part) => part.length >= 3 && !/^(?:india|karnataka|tamil nadu|maharashtra|kerala|telangana|delhi|new delhi|\d+)$/.test(part)),
  ].filter((part) => part.length >= 3);
  const areaMatch = locality.some((part) => hasPhrase(normalized, part));
  if (nameMatch && areaMatch) return "venue_and_area";
  if (nameMatch) return "possible_venue";
  return areaMatch ? "area_context" : "unmatched";
}
function topics(text: string): NewsTopic[] {
  // These are literal headline/snippet topics, never statements that an incident is ongoing.
  const result: NewsTopic[] = [];
  if (/\b(?:closure|closed|closing|shutdown|shut down|reopen(?:s|ed|ing)?)\b/i.test(text)) result.push("closure");
  if (/\b(?:renovat\w*|construction|maintenance|refurbish\w*|repair\w*|outage|power cut(?:s)?|lift|elevator|escalator)\b/i.test(text)) result.push("maintenance");
  if (/\b(?:flood\w*|monsoon|storm\w*|cyclone|heavy rain\w*)\b/i.test(text)) result.push("weather");
  if (/\b(?:fire|evacuat\w*|accident|collapse)\b/i.test(text)) result.push("incident");
  if (/\b(?:wheelchair|accessib\w*|ramp|step free|step-free|entrance)\b/i.test(text)) result.push("access");
  return result.length ? result : ["general"];
}
function publicationDate(value: unknown, asOf: string): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day); calendar.setUTCHours(0, 0, 0, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  if (match[4] && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59)) return null;
  if (match[7] && match[7] !== "Z" && (Number(match[7].slice(1, 3)) > 23 || Number(match[7].slice(4, 6)) > 59)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.parse(asOf) ? new Date(time).toISOString() : null;
}
function articleUrl(value: unknown): string | null {
  const url = safeUrl(value);
  if (!url || /(?:^|\.)serpapi\.com$/i.test(new URL(url).hostname)) return null;
  const parsed = new URL(url); parsed.hash = ""; return parsed.toString();
}
interface Candidate { value: Record<string, unknown>; pointer: string }
function newsCandidates(payload: Record<string, unknown>): Candidate[] {
  if (payload.error !== undefined) throw new ProviderError("provider_error", "Google News reported an upstream error");
  if (!Array.isArray(payload.news_results)) throw new ProviderError("schema_drift", "Google News response is missing news_results");
  const candidates: Candidate[] = [];
  const add = (value: unknown, pointer: string) => { const entry = object(value); if (entry && candidates.length < 32) candidates.push({ value: entry, pointer }); };
  for (const [index, value] of payload.news_results.slice(0, 12).entries()) {
    const entry = object(value); if (!entry) continue;
    if (entry.title !== undefined || entry.link !== undefined) add(entry, `/news_results/${index}`);
    if (entry.highlight !== undefined) add(entry.highlight, `/news_results/${index}/highlight`);
    if (Array.isArray(entry.stories)) for (const [storyIndex, story] of entry.stories.slice(0, 12).entries()) add(story, `/news_results/${index}/stories/${storyIndex}`);
  }
  return candidates;
}
export function normalizeNews(payload: Record<string, unknown>, venue: NewsVenue, city: string, retrievedAt: string, providerSearchId: string | null, briefGeneratedAt: string | null = null): NewsCheckResult {
  const retrievedTime = Date.parse(retrievedAt);
  if (!Number.isFinite(retrievedTime)) throw new ProviderError("schema_drift", "The news check has no valid retrieval time");
  const checkedAt = new Date(retrievedTime).toISOString();
  const briefAt = publicationDate(briefGeneratedAt, checkedAt);
  const articles: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const candidate of newsCandidates(payload)) {
    const entry = candidate.value, title = string(entry.title, 300), url = articleUrl(entry.link);
    if (!title || !url || seen.has(url)) continue;
    const publisher = object(entry.source);
    const snippet = string(entry.snippet, 2000);
    const publishedAt = publicationDate(entry.iso_date, checkedAt);
    const text = `${title} ${snippet ?? ""}`;
    seen.add(url);
    articles.push({
      id: identityUuid({ kind: NEWS_NORMALIZATION_VERSION, providerSearchId, url, title, publishedAt, retrievedAt: checkedAt, jsonPointer: candidate.pointer }),
      title, url, publisher: string(publisher?.name, 180) ?? string(publisher?.title, 180) ?? string(entry.source, 180), snippet,
      publishedAt, dateLabel: string(entry.date, 100),
      recency: publishedAt ? (retrievedTime - Date.parse(publishedAt) <= 14 * DAY ? "recent" : "older") : "unknown",
      relation: articleRelation(venue, city, text), topics: topics(text),
      newerThanBrief: publishedAt && briefAt ? Date.parse(publishedAt) > Date.parse(briefAt) : null,
      jsonPointer: candidate.pointer,
    });
  }
  const relationOrder: Record<NewsArticle["relation"], number> = { venue_and_area: 0, possible_venue: 1, area_context: 2, unmatched: 3 };
  articles.sort((a, b) => relationOrder[a.relation] - relationOrder[b.relation] || (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  return {
    articles: articles.slice(0, MAX_ARTICLES), retrievedAt: checkedAt, expiresAt: new Date(retrievedTime + NEWS_CACHE_TTL_MS).toISOString(),
    query: newsParams(venue, city).q, providerSearchId, briefGeneratedAt: briefAt,
    limitations: [
      "Publication dates describe when a report was published, not whether an incident is ongoing. Current lift operation remains unknown.",
      "Only supplied news headlines and snippets were reviewed; full articles were not fetched. Topic labels describe their text.",
      "No matching reports does not establish that the venue is open or disruption-free.",
      "A venue name and area mention may still describe another branch. Confirm the exact address and current conditions with the venue.",
      "This bounded check searches one page of news from the past 90 days; coverage and source dates may be incomplete.",
    ],
  };
}
