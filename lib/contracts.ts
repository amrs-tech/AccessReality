import { z } from "zod";

export const FEATURES = ["arrival_step_free", "entrance_step_free", "interior_movement", "accessible_seating", "accessible_restroom", "accessible_parking", "lift_present", "lift_operational"] as const;
export const featureSchema = z.enum(FEATURES);
export type Feature = z.infer<typeof featureSchema>;
export const FEATURE_LABELS: Record<Feature, string> = {
  arrival_step_free: "Step-free arrival", entrance_step_free: "Step-free entrance", interior_movement: "Wheelchair-usable internal movement",
  accessible_seating: "Accessible seating/table space", accessible_restroom: "Accessible restroom", accessible_parking: "Accessible parking",
  lift_present: "Lift access", lift_operational: "Lift operation",
};
export const prioritySchema = z.enum(["must_have", "preferred", "not_needed"]);
export type Priority = z.infer<typeof prioritySchema>;
export const requirementScopeSchema = z.object({ entrance: z.string().max(120).nullable(), floor: z.string().max(120).nullable(), facility: z.string().max(120).nullable() }).strict();
export const requirementSchema = z.object({ feature: featureSchema, priority: prioritySchema, scope: requirementScopeSchema.optional() }).strict();
export const requirementsSchema = z.array(requirementSchema).max(8).refine((value) => new Set(value.map((item) => item.feature)).size === value.length, "Duplicate features are not allowed");
export type Requirement = z.infer<typeof requirementSchema>;
export type Requirements = Requirement[];
// Public provider photo references only. Photos are supplementary and never assessed.
export const evidenceImageSchema = z.object({
  id: z.string().max(100), url: z.string().max(2048), sourceUrl: z.string().max(2048).nullable(),
  providerSearchId: z.string().max(100).nullable(), retrievedAt: z.string(), capturedAt: z.null(),
  jsonPointer: z.string().max(180), attribution: z.enum(["Google Maps listing", "Google Maps review photo"]),
}).strict();
export type EvidenceImage = z.infer<typeof evidenceImageSchema>;
export const venueSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(240), address: z.string().max(500).nullable(),
  googlePlaceId: z.string().max(300).nullable(), dataCid: z.string().max(300).nullable(), dataId: z.string().max(300).nullable(),
  website: z.string().nullable(), phone: z.string().max(100).nullable(), category: z.string().max(200).nullable(), sourceUrl: z.string().nullable(),
  latitude: z.number().nullable(), longitude: z.number().nullable(), rating: z.number().nullable(), provisional: z.boolean(),
  images: z.array(evidenceImageSchema).max(4).optional(),
});
export type Venue = z.infer<typeof venueSchema>;
export const sourceSchema = z.object({
  id: z.string(), venueId: z.string(), kind: z.enum(["maps_attribute", "maps_review", "search_snippet"]), text: z.string().max(4000),
  sourceUrl: z.string().nullable(), providerReviewId: z.string().nullable(), providerSearchId: z.string().nullable(), engine: z.string(),
  retrievedAt: z.string(), publishedAt: z.string().nullable(), editedAt: z.string().nullable(), observedAt: z.string().nullable(),
  selectionMethod: z.enum(["newest", "keyword", "discovery_attribute", "web_query"]), sourceGroupKey: z.string(),
  metadata: z.record(z.string(), z.unknown()), translatedText: z.string().max(4000).nullable().optional(),
  images: z.array(evidenceImageSchema).max(2).optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export type SourceKind = Source["kind"];
export const claimScopeSchema = requirementScopeSchema.extend({ conditions: z.array(z.string().min(1).max(240)).max(6) });
export const extractedClaimSchema = z.object({ sourceId: z.string().min(1).max(100), feature: featureSchema, polarity: z.enum(["supports", "barrier", "unclear"]), originalQuote: z.string().min(1).max(1600), scope: claimScopeSchema }).strict();
export const extractionSchema = z.object({ claims: z.array(extractedClaimSchema).max(64) }).strict();
export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;
export const evidenceClaimSchema = extractedClaimSchema.extend({
  id: z.string(), venueId: z.string(), quoteStart: z.number().int().nonnegative().nullable(), quoteEnd: z.number().int().nonnegative().nullable(), jsonPointer: z.string().nullable(),
  observedAt: z.string().nullable(), publishedAt: z.string().nullable(), editedAt: z.string().nullable(), retrievedAt: z.string(),
  datePrecision: z.enum(["timestamp", "day", "approximate", "unknown"]), temporalKind: z.enum(["structural", "operational"]), venueMatch: z.enum(["exact", "ambiguous"]), extractionStatus: z.enum(["accepted", "rejected"]),
  validationFlags: z.array(z.string()).optional(), extractorVersion: z.string().optional(),
});
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;
export type Polarity = EvidenceClaim["polarity"];
export type RequirementStatus = "supported" | "barrier_reported" | "conflicting" | "insufficient" | "historical_only";
export interface RequirementAssessment {
  feature: Feature; priority: Priority; scope?: Requirement["scope"]; status: RequirementStatus; claimIds: string[]; sourceIds: string[];
  explanation: string; barrierToConfirm: boolean; conditions: string[]; dataQualityFlags: string[];
}
export type OverallFit = "reported_barrier" | "needs_confirmation" | "evidence_supports_requirements";
export interface Report {
  venue: Venue; requirements: RequirementAssessment[]; claims: EvidenceClaim[]; sources: Source[]; overall: OverallFit; generatedAt: string;
  isPartial: boolean; questions: string[]; limitations: string[]; algorithmVersion: string; extractorVersion: string; reviewsExamined: number;
}
export type Phase = "details" | "reviews" | "extract" | "assess" | "plan" | "targeted_search" | "finalize" | "complete" | "partial" | "cancelled";
export const discoveryInputSchema = z.object({ query: z.string().trim().min(2).max(160), city: z.string().trim().min(2).max(80), country: z.literal("India"), idempotencyKey: z.string().min(16).max(100) }).strict();
export const investigationInputSchema = z.object({ discoveryJobId: z.uuid(), candidateId: z.string().min(1).max(100), requirements: requirementsSchema, idempotencyKey: z.string().min(16).max(100) }).strict();
export const reassessInputSchema = z.object({ requirements: requirementsSchema }).strict();
export const stepInputSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const sessionInputSchema = z.object({ accessCode: z.string().min(1).max(256) }).strict();
export interface PublicJob {
  id: string; kind: "discovery" | "investigation" | "news_check"; phase: string; stateVersion: number; venue: Venue | null; candidates: Venue[];
  requirements: Requirement[]; report: Report | null; providerAttempts: number; appCacheHits: number; searchCap: number; llmAttempts: number; llmCap: number;
  sourceCount: number; reviewsExamined: number; events: { id?: string; type: string; message: string; createdAt: string }[];
  stopReason: string | null; nextRetryAt: string | null; canResume: boolean; remainingAction: string | null;
  discoveryJobId: string | null; candidateId: string | null; lastKnownProviderRemaining: number | null; allowanceCheckedAt: string | null;
  searchMode?: 'expanded' | 'conserve' | 'legacy'; effectiveProviderRemaining?: number | null;
}
