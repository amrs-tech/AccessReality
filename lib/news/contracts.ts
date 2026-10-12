export type NewsTopic = "closure" | "maintenance" | "weather" | "incident" | "access" | "general";
export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  snippet: string | null;
  publishedAt: string | null;
  dateLabel: string | null;
  recency: "recent" | "older" | "unknown";
  relation: "venue_and_area" | "possible_venue" | "area_context" | "unmatched";
  topics: NewsTopic[];
  newerThanBrief: boolean | null;
  jsonPointer?: string;
}
export interface NewsCheckResult {
  articles: NewsArticle[];
  retrievedAt: string;
  expiresAt: string;
  query: string;
  providerSearchId: string | null;
  briefGeneratedAt: string | null;
  limitations: string[];
}
export interface PublicNewsCheck {
  id: string;
  parentJobId: string;
  phase: string;
  stateVersion: number;
  providerAttempts: number;
  appCacheHits: number;
  searchCap: number;
  result: NewsCheckResult | null;
  nextRetryAt: string | null;
  canResume: boolean;
  stopReason: string | null;
  errorCode: string | null;
}
