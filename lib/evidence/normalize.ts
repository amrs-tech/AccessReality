import { createHash } from "node:crypto";
import type { Source, Venue } from "../contracts";
import { validatedDate } from "./dates";
import { identityUuid } from "./identity";
export { claimIdentityId } from "./identity";

export const ADAPTER_VERSION = "serpapi-normalization-v1";
export function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function string(value: unknown, max = 1000): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    for (const key of [...url.searchParams.keys()]) if (/key|token|secret|password|authorization|credential/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return null; }
}
export function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function mapsUrl(venue: Pick<Venue, "name" | "address" | "googlePlaceId">): string {
  const url = new URL("https://www.google.com/maps/search/"); url.searchParams.set("api", "1"); url.searchParams.set("query", [venue.name, venue.address].filter(Boolean).join(" "));
  if (venue.googlePlaceId) url.searchParams.set("query_place_id", venue.googlePlaceId); return url.toString();
}
export function sourceGroupKey(venueId: string, reviewId: string | null, sourceUrl: string | null, text: string): string {
  return reviewId ? hash(`${venueId}:review:${reviewId}`) : hash(`${venueId}:${sourceUrl ?? ""}:${text.replace(/\s+/g, " ").trim()}`);
}
export function redactPersonalText(text: string): string {
  const mask = (value: string) => " ".repeat(value.length);
  return text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, mask)
    .replace(/\b(?:my name is|my diagnosis is|I (?:was diagnosed with|suffer from)|I have (?:a disability|multiple sclerosis|cerebral palsy|paralysis|arthritis|Parkinson['’]?s?|a spinal cord injury|MS))\b[^.!?\n]{0,120}/gi, mask)
    .replace(/\b(?:my phone(?: number)? is|call me at)\s*[+\d() -]{6,30}/gi, mask);
}
export function makeSource(input: Omit<Source, "id" | "sourceGroupKey" | "text"> & { text: string; id?: string }): Source {
  const rawText = input.text; const redacted = redactPersonalText(rawText); const text = redacted.slice(0, 4000); const sourceUrl = safeUrl(input.sourceUrl);
  const retrievedAt = new Date(input.retrievedAt).toISOString();
  const published = validatedDate(input.publishedAt, retrievedAt), edited = validatedDate(input.editedAt, retrievedAt), suppliedObserved = validatedDate(input.observedAt, retrievedAt);
  const explicitDate = /\b(?:visited|was there|my visit was)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})\b/i.exec(text);
  const observed = explicitDate ? validatedDate(explicitDate[1], retrievedAt) : null;
  const invalidSourceDates: Record<string, string> = {};
  for (const [key, raw, parsed] of [["publishedAt", input.publishedAt, published], ["editedAt", input.editedAt, edited], ["observedAt", input.observedAt, suppliedObserved]] as const) if (raw && parsed.flags.length) invalidSourceDates[key] = raw.slice(0, 100);
  const sourceDateFlags = [...published.flags.map((flag) => `publication_${flag}`), ...edited.flags.map((flag) => `edit_${flag}`), ...suppliedObserved.flags.map((flag) => `observation_${flag}`), ...(observed?.flags ?? []).map((flag) => `explicit_observation_${flag}`)];
  const groupBase = sourceGroupKey(input.venueId, input.providerReviewId, sourceUrl, text);
  const groupKey = input.kind === "maps_attribute" && typeof input.metadata.jsonPointer === "string" ? hash(`${groupBase}:${input.metadata.jsonPointer}`) : groupBase;
  const sourceId = identityUuid({ kind: "source-snapshot-v1", venueId: input.venueId, sourceGroupKey: groupKey, textHash: hash(text), retrievedAt });
  return { ...input, id: input.id ?? sourceId, sourceUrl, text, retrievedAt, publishedAt: published.value, editedAt: edited.value,
    observedAt: input.observedAt ? suppliedObserved.value : observed?.value ?? null,
    sourceGroupKey: groupKey,
    metadata: { ...input.metadata, textHash: hash(text), evidenceGroupKey: hash(`${input.venueId}:${text.replace(/\s+/g, " ").trim()}`), truncated: rawText.length > 4000 || Boolean(input.metadata.truncated), redactedPersonalDetails: rawText !== redacted, observationDateInvalid: Boolean(observed?.flags.length || suppliedObserved.flags.length || published.flags.length), sourceDateFlags, invalidSourceDates,
      historicalObservation: /\b(?:last year|years? ago|last decade)\b/i.test(text), relativeObservationUncertain: /\b(?:last month|last week|months? ago|weeks? ago|previous visit|used to|once was)\b/i.test(text) },
  };
}
export function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>(); return sources.filter((source) => { const snapshot = `${source.sourceGroupKey}:${hash(source.text)}`; if (seen.has(snapshot)) return false; seen.add(snapshot); return true; });
}
export function immutableTextBatches(sources: Source[]): Source[][] {
  const batches: Source[][] = []; let batch: Source[] = []; let size = 0;
  // Ambiguous branches remain in the ledger but cannot enter production claim extraction.
  for (const source of dedupeSources(sources).filter((s) => s.kind !== "maps_attribute" && s.text.trim().length > 0 && s.metadata.venueMatch === "exact")) {
    if ((size + source.text.length > 24000 || batch.length >= 32) && batch.length) { batches.push(batch); batch = []; size = 0; }
    batch.push(source); size += source.text.length;
  }
  if (batch.length) batches.push(batch); return batches;
}
