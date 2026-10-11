import type { Feature, RequirementAssessment, Source, Venue } from "../contracts";
import { FEATURE_LABELS } from "../contracts";
import { detailsParams } from "../adapters/place";
import { reviewsParams } from "../adapters/reviews";
import { webParams } from "../adapters/web";
import { ADAPTER_VERSION, hash } from "../evidence/normalize";
export type ActionKind = "FETCH_DETAILS" | "FETCH_NEWEST_REVIEWS" | "SEARCH_REVIEWS_FEATURE" | "SEARCH_WEB_FEATURE" | "STOP";
export interface AllowedAction { id: string; kind: ActionKind; feature: Feature | null; params: Record<string, string>; key: string; reason: string }
function action(kind: ActionKind, params: Record<string, string>, feature: Feature | null, reason: string): AllowedAction { const key = `${kind}:${hash(JSON.stringify(params))}`; return { id: feature ? `${kind}:${feature}${params.q?.startsWith("site:") ? ":venue_domain" : ""}` : kind, kind, feature, params, key, reason }; }
export function detailsAction(venue: Venue): AllowedAction { return action("FETCH_DETAILS", detailsParams(venue), null, "Checking the selected branch's Maps accessibility attributes."); }
export function newestReviewsAction(venue: Venue): AllowedAction { return action("FETCH_NEWEST_REVIEWS", reviewsParams(venue), null, "Checking a dated sample of the newest visitor reviews."); }
export const stopAction = (): AllowedAction => action("STOP", {}, null, "No further permitted evidence action is needed.");
export function featureReviewQuery(feature: Feature): string {
  return ({ accessible_restroom: "wheelchair restroom", accessible_parking: "accessible parking", lift_present: "lift elevator", lift_operational: "lift elevator", entrance_step_free: "wheelchair entrance", arrival_step_free: "wheelchair parking", interior_movement: "wheelchair", accessible_seating: "wheelchair seating" } satisfies Record<Feature, string>)[feature];
}
export function targetedSearchParams(venue: Venue, id: string, feature: Feature): Record<string, string> {
  return id.startsWith("SEARCH_REVIEWS_FEATURE") ? reviewsParams(venue, featureReviewQuery(feature)) : webParams(venue, feature, id.endsWith(":venue_domain") || id.endsWith(":1"));
}
export interface EvidenceMenuInput {
  venue: Venue; assessments: RequirementAssessment[]; visitedActionKeys: string[];
  expanded: boolean; reviewRequests: number; webRequests: number; noNewEvidence: number; balanced?: boolean;
}
/** A finite menu, with equal coverage of unresolved must-haves before a feature gets another check. */
export function evidenceMenu(input: EvidenceMenuInput): AllowedAction[] {
  if (!input.expanded && input.noNewEvidence >= 2) return [];
  const gaps = input.assessments.filter((r) => r.priority === "must_have" && r.status !== "supported")
    .sort((a, b) => Number(b.status === "conflicting") - Number(a.status === "conflicting") || a.sourceIds.length - b.sourceIds.length);
  const seen = new Set(input.visitedActionKeys);
  const make = (feature: Feature, kind: "SEARCH_REVIEWS_FEATURE" | "SEARCH_WEB_FEATURE", suffix = ""): AllowedAction => {
    const id = `${kind}:${feature}${suffix}`;
    const candidate = action(kind, targetedSearchParams(input.venue, id, feature), feature,
      `${FEATURE_LABELS[feature]} needs confirmation; checking ${kind === "SEARCH_REVIEWS_FEATURE" ? "venue-specific reviews" : suffix === ":venue_domain" || suffix === ":1" ? "the observed venue domain" : "branch-specific search snippets"}.`);
    return { ...candidate, id };
  };
  const available = (candidate: AllowedAction): boolean => !seen.has(candidate.id) && !seen.has(candidate.key)
    && !(candidate.id.endsWith(":general") && seen.has(candidate.id.replace(/:general$/, ":0")))
    && !(candidate.id.endsWith(":venue_domain") && seen.has(candidate.id.replace(/:venue_domain$/, ":1")));
  if (!input.expanded) {
    const highest = gaps[0]; if (!highest) return [];
    const menu: AllowedAction[] = [];
    if (input.reviewRequests < 2 && (input.venue.dataId || input.venue.googlePlaceId)) menu.push(make(highest.feature, "SEARCH_REVIEWS_FEATURE"));
    if (input.webRequests < 2 && (input.webRequests === 0 || input.venue.website)) menu.push(make(highest.feature, "SEARCH_WEB_FEATURE", `:${input.webRequests}`));
    return menu.filter(available);
  }
  const ranked = gaps.map((gap) => {
    const menu: AllowedAction[] = [];
    if (input.venue.dataId || input.venue.googlePlaceId) menu.push(make(gap.feature, "SEARCH_REVIEWS_FEATURE"));
    menu.push(make(gap.feature, "SEARCH_WEB_FEATURE", ":general"));
    if (input.venue.website) menu.push(make(gap.feature, "SEARCH_WEB_FEATURE", ":venue_domain"));
    const completed = input.visitedActionKeys.filter((id) => id === `SEARCH_REVIEWS_FEATURE:${gap.feature}` || id.startsWith(`SEARCH_WEB_FEATURE:${gap.feature}:`)).length;
    return { menu: menu.filter(available), completed };
  }).filter((entry) => entry.menu.length);
  if (!ranked.length) return [];
  if (input.balanced === false) return ranked.flatMap((entry) => entry.menu);
  const leastChecked = Math.min(...ranked.map((entry) => entry.completed));
  return ranked.filter((entry) => entry.completed === leastChecked).flatMap((entry) => entry.menu);
}
export function eligibleActions(input: { venue: Venue; assessments: RequirementAssessment[]; sources: Source[]; visitedActionKeys: string[]; searchAttempts: number; searchCap: number; llmAttempts: number; llmCap: number; targetedReviewAttempts: number; webAttempts: number; expanded?: boolean }): AllowedAction[] {
  const stop = stopAction(); if (input.searchAttempts >= input.searchCap || input.llmCap - input.llmAttempts < 1) return [stop];
  return [...evidenceMenu({ venue: input.venue, assessments: input.assessments, visitedActionKeys: input.visitedActionKeys,
    expanded: input.expanded ?? false, reviewRequests: input.targetedReviewAttempts + 1, webRequests: input.webAttempts, noNewEvidence: 0 }), stop];
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
