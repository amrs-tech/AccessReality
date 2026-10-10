import type { Feature, RequirementAssessment, Source, Venue } from "../contracts";
import { FEATURE_LABELS } from "../contracts";
import { detailsParams } from "../adapters/place";
import { reviewsParams } from "../adapters/reviews";
import { FEATURE_TERMS, webParams } from "../adapters/web";
import { ADAPTER_VERSION, hash } from "../evidence/normalize";
export type ActionKind = "FETCH_DETAILS" | "FETCH_NEWEST_REVIEWS" | "SEARCH_REVIEWS_FEATURE" | "SEARCH_WEB_FEATURE" | "STOP";
export interface AllowedAction { id: string; kind: ActionKind; feature: Feature | null; params: Record<string, string>; key: string; reason: string }
function action(kind: ActionKind, params: Record<string, string>, feature: Feature | null, reason: string): AllowedAction { const key = `${kind}:${hash(JSON.stringify(params))}`; return { id: feature ? `${kind}:${feature}${params.q?.startsWith("site:") ? ":venue_domain" : ""}` : kind, kind, feature, params, key, reason }; }
export function detailsAction(venue: Venue): AllowedAction { return action("FETCH_DETAILS", detailsParams(venue), null, "Checking the selected branch's Maps accessibility attributes."); }
export function newestReviewsAction(venue: Venue): AllowedAction { return action("FETCH_NEWEST_REVIEWS", reviewsParams(venue), null, "Checking a dated sample of the newest visitor reviews."); }
export const stopAction = (): AllowedAction => action("STOP", {}, null, "No further permitted evidence action is needed.");
export function eligibleActions(input: { venue: Venue; assessments: RequirementAssessment[]; sources: Source[]; visitedActionKeys: string[]; searchAttempts: number; searchCap: number; llmAttempts: number; llmCap: number; targetedReviewAttempts: number; webAttempts: number }): AllowedAction[] {
  const stop = stopAction(); if (input.searchAttempts >= input.searchCap || input.llmCap - input.llmAttempts < 1) return [stop];
  const unresolved = input.assessments.filter((r) => r.priority === "must_have" && r.status !== "supported");
  const ranked = [...unresolved].sort((a, b) => Number(b.status === "conflicting") - Number(a.status === "conflicting") || a.sourceIds.length - b.sourceIds.length);
  const highest = ranked[0]; if (!highest) return [stop]; const menu: AllowedAction[] = [];
  if (input.targetedReviewAttempts < 1 && (input.venue.dataId || input.venue.googlePlaceId)) menu.push(action("SEARCH_REVIEWS_FEATURE", reviewsParams(input.venue, FEATURE_TERMS[highest.feature].split(" ")[0]), highest.feature, `${FEATURE_LABELS[highest.feature]} evidence is unresolved; checking venue-specific keyword reviews.`));
  if (input.webAttempts < 2) {
    menu.push(action("SEARCH_WEB_FEATURE", webParams(input.venue, highest.feature), highest.feature, `${FEATURE_LABELS[highest.feature]} evidence is unresolved; checking branch-specific search snippets.`));
    if (input.venue.website) menu.push(action("SEARCH_WEB_FEATURE", webParams(input.venue, highest.feature, true), highest.feature, `${FEATURE_LABELS[highest.feature]} evidence is unresolved; checking the observed venue domain.`));
  }
  return [...menu.filter((candidate) => !input.visitedActionKeys.includes(candidate.key)), stop];
}
export function deterministicFallback(menu: AllowedAction[]): { action: AllowedAction; reason: string; plannerMode: "deterministic_fallback" } {
  const selected = menu.find((a) => a.kind === "SEARCH_REVIEWS_FEATURE") ?? menu.find((a) => a.kind !== "STOP") ?? stopAction();
  return { action: selected, reason: selected.reason, plannerMode: "deterministic_fallback" };
}
export function cacheKey(params: Record<string, string>, venueId: string | null = null): string {
  if (Object.keys(params).some((key) => /api_key|authorization|secret|password|credential/i.test(key))) throw new Error("Secrets are forbidden in cache parameters");
  const normalized = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value.replace(/\s+/g, " ").trim()]));
  return hash(JSON.stringify({ adapterVersion: ADAPTER_VERSION, locale: "en", venueId, params: normalized }));
}
export function cacheTtlSeconds(kind: "discovery" | ActionKind): number { return kind === "FETCH_DETAILS" ? 86400 : 21600; }
