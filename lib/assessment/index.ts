import type { EvidenceClaim, OverallFit, Report, Requirement, RequirementAssessment, Source, Venue } from "../contracts";
import { freshness } from "../evidence/dates";
import { dedupeSources } from "../evidence/normalize";
import { EXTRACTOR_VERSION } from "../evidence/validate";
export const ASSESSMENT_VERSION = "conservative-requirement-fit-v1";
const scopeFields = ["entrance", "floor", "facility"] as const;
function normalized(value: string | null | undefined): string | null { return value?.trim().toLowerCase() ?? null; }
export function scopesComparable(left: EvidenceClaim["scope"], right: EvidenceClaim["scope"]): boolean {
  return scopeFields.every((key) => !normalized(left[key]) || !normalized(right[key]) || normalized(left[key]) === normalized(right[key]));
}
export function scopeApplicable(claim: EvidenceClaim, requirement: Requirement, positive = false): boolean {
  return scopeFields.every((key) => {
    const required = normalized(requirement.scope?.[key]), actual = normalized(claim.scope[key]);
    if (required) return positive ? actual === required : actual === null || actual === required;
    return positive ? actual === null : true;
  });
}
export function assessRequirement(requirement: Requirement, claims: EvidenceClaim[], sources: Source[], asOf: string): RequirementAssessment {
  const relevant = claims.filter((claim) => claim.feature === requirement.feature && claim.extractionStatus === "accepted" && claim.venueMatch === "exact" && scopeApplicable(claim, requirement));
  const dated = relevant.map((claim) => ({ claim, ...freshness(claim, sources.find((s) => s.id === claim.sourceId), asOf) }));
  const positives = dated.filter((e) => e.claim.polarity === "supports" && !e.claim.scope.conditions.length);
  const negatives = dated.filter((e) => e.claim.polarity === "barrier");
  const conditions = [...new Set(relevant.flatMap((claim) => claim.scope.conditions))];
  const conflicts = positives.some((positive) => negatives.some((negative) => scopesComparable(positive.claim.scope, negative.claim.scope)));
  let status: RequirementAssessment["status"] = "insufficient";
  if (conflicts) status = "conflicting";
  else if (negatives.some((e) => e.freshness === "recent")) {
    const differentEntrance = positives.some((p) => !scopeApplicable(p.claim, requirement, true) && negatives.some((n) => !scopesComparable(p.claim.scope, n.claim.scope)));
    status = differentEntrance ? "insufficient" : "barrier_reported";
  } else if (positives.some((e) => e.freshness === "recent" && scopeApplicable(e.claim, requirement, true)) && !conditions.length && !relevant.some((c) => c.polarity === "unclear") && !negatives.length) status = "supported";
  else if (dated.length && dated.every((e) => e.freshness === "historical") && !conditions.length && !relevant.some((c) => c.polarity === "unclear")) status = "historical_only";
  const explanations: Record<RequirementAssessment["status"], string> = {
    supported: requirement.feature === "lift_operational" ? "Reported working on the source date; confirm operation before arrival." : "Recent public observation supports this requirement for the matching scope; current conditions still need confirmation.",
    barrier_reported: "A recent visitor observation reports a barrier for this requirement.",
    conflicting: "Supporting and barrier evidence coexist for comparable access scope. Both remain visible.",
    historical_only: "Only older dated evidence is available. It does not establish current conditions.",
    insufficient: conditions.length ? "Access depends on an unresolved condition. Confirm the arrangement with the venue." : relevant.length ? "Evidence has unknown dates, unclear content or unmatched access scope. This requirement remains unknown." : "No usable accessibility evidence was found for this requirement.",
  };
  return { ...requirement, status, claimIds: relevant.map((c) => c.id), sourceIds: [...new Set(relevant.map((c) => c.sourceId))], explanation: explanations[status], barrierToConfirm: negatives.length > 0 && status !== "barrier_reported", conditions,
    dataQualityFlags: [...new Set([...dated.flatMap((entry) => entry.flags), ...relevant.flatMap((claim) => claim.validationFlags ?? [])])] };
}
export function overallFit(requirements: RequirementAssessment[], isPartial: boolean): OverallFit {
  const must = requirements.filter((r) => r.priority === "must_have");
  if (must.some((r) => r.status === "barrier_reported")) return "reported_barrier";
  if (!must.length || isPartial || must.some((r) => r.status !== "supported")) return "needs_confirmation";
  return "evidence_supports_requirements";
}
const QUESTION_TEMPLATES: Record<Requirement["feature"], string> = {
  arrival_step_free: "Is there a step-free route from the drop-off or parking area to the entrance?",
  entrance_step_free: "Which entrance provides step-free access, and is it available to customers today?",
  interior_movement: "Is there a step-free route from the entrance to the requested seating or service area, with space for a wheelchair?",
  accessible_seating: "Is there customer seating and table space that can accommodate a wheelchair?",
  accessible_restroom: "Is the accessible restroom open to customers today, and is the route to it step-free?",
  accessible_parking: "Is accessible parking available, and is there a step-free route from it to the entrance?",
  lift_present: "Is there a lift serving the floor and facility I need to reach?",
  lift_operational: "Is the lift operating today and available to customers on the required floor?",
};
export function confirmationQuestions(requirements: RequirementAssessment[], claims: EvidenceClaim[]): string[] {
  const selected = requirements.filter((r) => r.priority !== "not_needed");
  if (!selected.some((r) => r.priority === "must_have")) return ["Which requirements are must-haves for this visit?", ...selected.slice(0, 2).map((r) => QUESTION_TEMPLATES[r.feature])];
  const rank = (r: RequirementAssessment) => (r.priority === "must_have" ? 0 : 10) + (r.status === "conflicting" || r.barrierToConfirm || r.status === "barrier_reported" ? 0 : r.status === "supported" ? 3 : 1);
  return [...selected].sort((a, b) => rank(a) - rank(b)).slice(0, 3).map((r) => {
    if (r.feature === "lift_operational") { const barrier = claims.find((c) => r.claimIds.includes(c.id) && c.polarity === "barrier"); const date = barrier?.observedAt ?? barrier?.publishedAt;
      if (date) return `A visitor reported a lift issue on ${date.slice(0, 10)}. Is the lift operating today and serving the required floor?`;
    }
    return QUESTION_TEMPLATES[r.feature];
  });
}
export function buildReport(input: { venue: Venue; requirements: Requirement[]; claims: EvidenceClaim[]; sources: Source[]; asOf: string; isPartial?: boolean; limitations?: string[]; reviewsExamined?: number }): Report {
  const sources = dedupeSources(input.sources); const ids = new Set(sources.map((s) => s.id));
  // This corpus must be the investigation's linked snapshots, never all venue history.
  const claims = input.claims.filter((c) => c.venueId === input.venue.id && ids.has(c.sourceId));
  const requirements = input.requirements.filter((r) => r.priority !== "not_needed").map((r) => assessRequirement(r, claims, sources, input.asOf));
  const isPartial = input.isPartial ?? false;
  const reviewsExamined = input.reviewsExamined ?? sources.filter((s) => s.kind === "maps_review").length;
  const limitations = [...(input.limitations ?? []), `Examined ${reviewsExamined} sampled visitor reviews; this does not cover all reviews.`, "Public evidence cannot guarantee current conditions or legal accessibility compliance."];
  if (sources.some((s) => s.kind === "search_snippet")) limitations.push("Web evidence consists of search snippets; full pages were not reviewed.");
  if (sources.some((s) => s.selectionMethod === "keyword")) limitations.push("Some reviews were selected by an accessibility keyword and are not a representative sample.");
  if (claims.some((c) => !c.observedAt && !c.publishedAt)) limitations.push("Some source dates are unknown; retrieval time does not establish observation time.");
  if (sources.some((s) => s.metadata.truncated)) limitations.push("Some public text was truncated to the extraction limit.");
  if (sources.some((s) => s.metadata.venueMatch === "ambiguous")) limitations.push("Ambiguous branch matches are excluded from assessment.");
  if (claims.some((c) => c.validationFlags?.includes("language_semantics_unvalidated"))) limitations.push("Unvalidated multilingual wording remains unclear.");
  if (isPartial) limitations.push("An evidence or extraction stage could not be completed; favorable fit is unavailable.");
  return { venue: input.venue, requirements, claims, sources, overall: overallFit(requirements, isPartial), generatedAt: input.asOf, isPartial, questions: confirmationQuestions(requirements, claims), limitations: [...new Set(limitations)], algorithmVersion: ASSESSMENT_VERSION, extractorVersion: EXTRACTOR_VERSION, reviewsExamined };
}
