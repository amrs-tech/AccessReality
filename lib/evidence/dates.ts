import type { EvidenceClaim, Source } from "../contracts";
export type Freshness = "recent" | "historical" | "unknown" | "uncertain";
const DAY = 86_400_000;
export function validatedDate(value: unknown, asOf: string): { value: string | null; precision: "timestamp" | "day" | "unknown"; flags: string[] } {
  if (value === null || value === undefined || value === "") return { value: null, precision: "unknown", flags: [] };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return { value: null, precision: "unknown", flags: ["malformed_date"] };
  const date = new Date(value); const time = date.getTime();
  if (!Number.isFinite(time) || date.toISOString().slice(0, 10) !== value.slice(0, 10) || time > new Date(asOf).getTime()) return { value: null, precision: "unknown", flags: [time > new Date(asOf).getTime() ? "future_date" : "malformed_date"] };
  return { value, precision: value.length === 10 ? "day" : "timestamp", flags: [] };
}
export function relativeAgeInterval(value: unknown): [number, number] | null {
  if (typeof value !== "string") return null; const match = /^(?:a|an|\d+)\s+(day|week|month|year)s?\s+ago$/i.exec(value.trim()); if (!match) return null;
  const count = /^(a|an)\s/i.test(value) ? 1 : Number.parseInt(value, 10); const unit = match[1].toLowerCase();
  const scales: Record<string, [number, number]> = { day: [1, 1], week: [7, 7], month: [28, 31], year: [365, 366] };
  const [low, high] = scales[unit]; return [count * low, (count + 1) * high];
}
export function freshness(claim: EvidenceClaim, source: Source | undefined, asOf: string): { freshness: Freshness; flags: string[] } {
  const window = claim.temporalKind === "operational" ? 14 : 180;
  const sourceDateFlags = Array.isArray(source?.metadata.sourceDateFlags) ? (source.metadata.sourceDateFlags as unknown[]).filter((flag): flag is string => typeof flag === "string") : [];
  if (source?.metadata.observationDateInvalid) return { freshness: "unknown", flags: ["invalid_source_observation_date", ...sourceDateFlags] };
  if (claim.validationFlags?.some((flag) => ["future_date", "malformed_date"].includes(flag))) return { freshness: "unknown", flags: claim.validationFlags.filter((flag) => ["future_date", "malformed_date"].includes(flag)) };
  // Historical observation wording must never be upgraded by a new publication or edit date.
  if (source?.metadata.historicalObservation || /\b(?:last year|years? ago|last decade)\b/i.test(claim.originalQuote)) return { freshness: "historical", flags: ["explicit_historical_observation"] };
  if ((source?.metadata.relativeObservationUncertain || /\b(?:last month|last week|months? ago|weeks? ago|previous visit|used to|once was)\b/i.test(claim.originalQuote)) && !claim.observedAt) return { freshness: "uncertain", flags: ["relative_observation_requires_confirmation"] };
  // Edit and retrieval dates never upgrade the original observation.
  const parsed = validatedDate(claim.observedAt ?? claim.publishedAt, asOf);
  if (parsed.flags.length) return { freshness: "unknown", flags: parsed.flags };
  if (parsed.value) { const age = (new Date(asOf).getTime() - new Date(parsed.value).getTime()) / DAY; return { freshness: age <= window ? "recent" : "historical", flags: [...parsed.flags, ...sourceDateFlags] }; }
  const interval = relativeAgeInterval(source?.metadata.relativeDate);
  if (interval && source) {
    const fetchAge = (new Date(asOf).getTime() - new Date(source.retrievedAt).getTime()) / DAY;
    const low = interval[0] + fetchAge, high = interval[1] + fetchAge;
    return { freshness: low > window ? "historical" : high <= window ? "recent" : "uncertain", flags: [...parsed.flags, ...sourceDateFlags, "approximate_observation_date"] };
  }
  return { freshness: "unknown", flags: [...parsed.flags, ...sourceDateFlags] };
}
