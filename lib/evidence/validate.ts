import type { EvidenceClaim, ExtractedClaim, Feature, Source } from "../contracts";
import { extractedClaimSchema } from "../contracts";
import { relativeAgeInterval, validatedDate } from "./dates";
import { claimIdentityId } from "./identity";
export { claimIdentityId } from "./identity";
export const EXTRACTOR_VERSION = "gemini-public-evidence-v4-explicit-feature";
const FEATURE_CONTEXT: Record<Feature, RegExp> = {
  arrival_step_free: /(?:arrival|drop[- ]?off|parking).*(?:route|path|entrance)|(?:route|path).*(?:parking|drop[- ]?off)/i,
  entrance_step_free: /entrance|entry|door|ramp|steps|stairs/i,
  interior_movement: /inside|interior|aisles|corridor|move|movement|navigate/i,
  accessible_seating: /seating|table|seat/i, accessible_restroom: /restroom|toilet|bathroom|washroom/i,
  accessible_parking: /parking/i, lift_present: /lift|elevator/i, lift_operational: /lift|elevator/i,
};
const SUPPORT: Record<Feature, RegExp> = {
  arrival_step_free: /step[- ]free (?:route|path|arrival)|(?:route|path).*(?:without steps|no steps)|(?:parking|drop[- ]?off).*step[- ]free/i,
  entrance_step_free: /step[- ]free (?:entrance|entry)|(?:entrance|entry).*(?:step[- ]free|no steps|without steps|ramp)|(?:ramp).*(?:entrance|entry)|wheelchair[- ]accessible (?:entrance|entry)/i,
  interior_movement: /wheelchair.*(?:move|navigate|movement|usable|accessible).*(?:inside|interior|aisles|corridor)|(?:inside|interior|aisles|corridor).*wheelchair[- ]accessible|wheelchair[- ]accessible (?:interior|aisles|corridor)/i,
  accessible_seating: /wheelchair[- ]accessible seating|accessible (?:seating|table)|wheelchair.*(?:fit|space).*(?:table|seat)|(?:table|seat).*wheelchair/i,
  accessible_restroom: /wheelchair[- ]accessible (?:restroom|toilet|bathroom|washroom)|accessible (?:restroom|toilet|bathroom|washroom)|\b(?:restroom|toilet|bathroom|washroom) for wheel ?chair users\b/i,
  accessible_parking: /wheelchair[- ]accessible parking|accessible parking/i,
  lift_present: /(?:there is|there was|there are|there were|has|have|had|exists|present).*\b(?:lifts?|elevators?)\b|\b(?:lifts?|elevators?)\b.*(?:exists|present|available)/i,
  lift_operational: /\b(?:lift|elevator)\b.*\b(?:working|operating|operational|worked|running)\b|\b(?:used|rode)\b.*\b(?:lift|elevator)\b/i,
};
const BARRIER: Record<Feature, RegExp> = {
  arrival_step_free: /(?:route|path|arrival|drop[- ]?off|parking).{0,80}(?:stairs|steps|inaccessible|blocked|not accessible|no wheelchair access)|(?:no|not) step[- ]free (?:route|path|arrival)/i,
  entrance_step_free: /(?:entrance|entry|door|ramp).{0,80}(?:stairs|steps|inaccessible|blocked|not accessible|no wheelchair access|too narrow)|(?:stairs|steps|no wheelchair access|not wheelchair[- ]accessible|inaccessible).{0,80}(?:entrance|entry|door)/i,
  interior_movement: /(?:inside|interior|aisles|corridor|move|movement|navigate).{0,80}(?:stairs|steps|inaccessible|blocked|not accessible|too narrow|cannot|unable)/i,
  accessible_seating: /(?:seating|table|seat).{0,80}(?:inaccessible|blocked|not accessible|too narrow|too small|no room|cannot|unable)|(?:no|not) (?:wheelchair[- ]accessible|accessible) (?:seating|tables?|seats?)/i,
  accessible_restroom: /(?:restroom|toilet|bathroom|washroom).{0,80}(?:stairs|steps|inaccessible|closed|not accessible|too narrow|cannot|unable)|(?:no|not) (?:wheelchair[- ]accessible|accessible) (?:restroom|toilet|bathroom|washroom)/i,
  accessible_parking: /(?:no|not) (?:wheelchair[- ]accessible|accessible) parking|parking.{0,80}(?:inaccessible|blocked|closed|not accessible|unavailable)/i,
  lift_present: /(?:no|without) (?:a )?(?:lift|elevator)|(?:lift|elevator).{0,30}(?:absent|not present|not available)/i,
  lift_operational: /(?:lift|elevator).{0,80}(?:broken|out of order|not working|not operating|not operational|closed|not running)/i,
};
const NEGATIVE = /\b(?:no|not|cannot|can't|couldn't|unable|inaccessible|blocked|broken|stairs|steps|out of order|too narrow|too small|no room|closed)\b/i;
const CONDITION = /\b(?:if|unless|only when|on request|after|portable|staff|assistance|requires?|must|need to|wait(?:ed|ing)?)\b/i;
const FUTURE_MODALITY = /\b(?:will|would|could|may|might|planned|planning|proposed|expected|scheduled|tomorrow|soon)\b|\b(?:next|coming)\s+(?:day|week|month|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\b(?:plan|plans|intend|intends)\s+to\b|\bto\s+be\s+(?:built|installed|opened|repaired|provided|accessible)\b/i;
const INSTRUCTION = /ignore (?:all |previous |the )?instructions|system prompt|api[_ ]?key|increase (?:the )?budget|return (?:only )?json|mark .* accessible|pretend|fabricate/i;
function contextFor(source: string, start: number, end: number): string {
  // Include the complete sentence: a model must not cite the positive half of a negative or question.
  const previous = Math.max(source.lastIndexOf(".", start - 1), source.lastIndexOf("\n", start - 1));
  let next = source.indexOf(".", end); if (next < 0) next = source.length;
  const newline = source.indexOf("\n", end); if (newline >= 0) next = Math.min(next, newline);
  return source.slice(previous + 1, next + 1).trim();
}
function negativeText(text: string): boolean { return NEGATIVE.test(text.replace(/\b(?:no|without) (?:steps|stairs|barriers)\b/gi, "")); }
export interface ValidationResult { accepted: EvidenceClaim[]; rejected: { candidate: unknown; reason: string }[] }
export function validateExtractedClaims(candidates: unknown[], sources: Source[], venueId: string, asOf: string): ValidationResult {
  const accepted: EvidenceClaim[] = []; const rejected: ValidationResult["rejected"] = [];
  for (const candidate of candidates) {
    const parsed = extractedClaimSchema.safeParse(candidate); if (!parsed.success) { rejected.push({ candidate, reason: "claim_schema_invalid" }); continue; }
    const extracted: ExtractedClaim = parsed.data;
    const source = sources.find((item) => item.id === extracted.sourceId && item.venueId === venueId);
    if (!source) { rejected.push({ candidate, reason: "source_not_in_corpus" }); continue; }
    if (source.metadata.venueMatch !== "exact") { rejected.push({ candidate, reason: "ambiguous_venue" }); continue; }
    const quoteStart = source.text.indexOf(extracted.originalQuote); const quoteEnd = quoteStart + extracted.originalQuote.length;
    if (quoteStart < 0) { rejected.push({ candidate, reason: "quote_not_exact_substring" }); continue; }
    const context = contextFor(source.text, quoteStart, quoteEnd); const flags: string[] = [];
    if (source.text.indexOf(extracted.originalQuote, quoteStart + 1) >= 0) flags.push("repeated_quote_first_match");
    if (INSTRUCTION.test(context)) { rejected.push({ candidate, reason: "untrusted_instruction_not_observation" }); continue; }
    const scope = { ...extracted.scope, conditions: [...extracted.scope.conditions] };
    if ([scope.entrance, scope.floor, scope.facility, ...scope.conditions].some((value) => value && !source.text.toLowerCase().includes(value.toLowerCase()))) { rejected.push({ candidate, reason: "invented_scope_or_condition" }); continue; }
    let polarity = extracted.polarity;
    // Validation is deliberately narrower than model inference. Unsupported language remains unclear.
    const multilingual = /[\p{Script=Devanagari}\p{Script=Kannada}\p{Script=Han}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(context);
    if (multilingual) { polarity = "unclear"; flags.push("language_semantics_unvalidated"); }
    else if (!FEATURE_CONTEXT[extracted.feature].test(context)) { rejected.push({ candidate, reason: "feature_not_entailed" }); continue; }
    else if (/\?|\b(?:is there|are there|wonder if|might|maybe|would be|hope|wish|advertised|advertises|claimed|claims|supposedly|according to|someone said|friend said|not sure|don't know|uncertain|seems|apparently|they say|it says|website says|sign says|I was told|told me|reportedly|label says|never visited|did not visit|did not use|haven't used)\b|\b(?:other|another|different) (?:branch|location|venue)\b/i.test(context)) { polarity = "unclear"; flags.push("question_or_unverified_attribution"); }
    // An exact quote can omit its sentence's future qualifier. Plans are not observed access.
    else if (FUTURE_MODALITY.test(context)) { polarity = "unclear"; flags.push("future_or_planned_access"); }
    else if (/\b(?:not inaccessible|not broken|not closed|not out of order|no longer broken|no longer inaccessible)\b/i.test(context)) { polarity = "unclear"; flags.push("negation_semantics_uncertain"); }
    else if (CONDITION.test(context)) { polarity = "unclear"; if (!scope.conditions.length) scope.conditions.push(context.slice(0, 240)); flags.push("conditional_access"); }
    else if (negativeText(context)) {
      if (extracted.polarity === "supports") { rejected.push({ candidate, reason: "support_contradicted_by_negative" }); continue; }
      const featureNegative = context.split(/[,;]|\b(?:and|but|while|although|yet)\b/i).some((clause) => FEATURE_CONTEXT[extracted.feature].test(clause) && BARRIER[extracted.feature].test(clause));
      if (extracted.polarity === "barrier" && !featureNegative) { polarity = "unclear"; flags.push("negative_feature_attribution_uncertain"); }
      else polarity = extracted.polarity === "barrier" ? "barrier" : "unclear";
    } else if (extracted.polarity === "barrier") { rejected.push({ candidate, reason: "negative_not_entailed" }); continue; }
    else if (extracted.polarity === "supports" && !SUPPORT[extracted.feature].test(context)) { rejected.push({ candidate, reason: "support_not_entailed" }); continue; }
    if (extracted.feature === "lift_operational" && !/\b(?:working|operating|operational|worked|running|broken|out of order|not working|used|rode)\b/i.test(context)) { polarity = "unclear"; flags.push("lift_presence_is_not_operation"); }
    const date = validatedDate(source.observedAt ?? source.publishedAt, asOf); flags.push(...date.flags);
    if (source.metadata.truncated) flags.push("truncated_source");
    accepted.push({ ...extracted, id: claimIdentityId({ ...extracted, polarity, scope, extractorVersion: EXTRACTOR_VERSION }), venueId, polarity, scope, quoteStart, quoteEnd, jsonPointer: null,
      observedAt: source.observedAt ? date.value : null, publishedAt: source.observedAt ? validatedDate(source.publishedAt, asOf).value : date.value, editedAt: validatedDate(source.editedAt, asOf).value, retrievedAt: source.retrievedAt,
      datePrecision: date.precision === "unknown" && relativeAgeInterval(source.metadata.relativeDate) ? "approximate" : date.precision, temporalKind: extracted.feature === "lift_operational" || /\b(?:closed|broken|out of order|not working|not operating)\b/i.test(context) ? "operational" : "structural", venueMatch: "exact", extractionStatus: "accepted", validationFlags: flags, extractorVersion: EXTRACTOR_VERSION });
  }
  const seen = new Set<string>(); return { accepted: accepted.filter((claim) => { if (seen.has(claim.id)) return false; seen.add(claim.id); return true; }), rejected };
}
