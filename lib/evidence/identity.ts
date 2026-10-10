import { createHash } from "node:crypto";
import type { EvidenceClaim } from "../contracts";
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** UUID v8: custom SHA-256 name identity, not RFC UUID v5's SHA-1 algorithm. */
export function identityUuid(value: unknown): string {
  const bytes = createHash("sha256").update(stable(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type ClaimIdentity = Pick<EvidenceClaim, "sourceId" | "feature" | "polarity" | "originalQuote" | "scope"> & { extractorVersion?: string };
export function claimIdentityId(claim: ClaimIdentity): string {
  const scope = { entrance: claim.scope.entrance ?? null, floor: claim.scope.floor ?? null, facility: claim.scope.facility ?? null, conditions: claim.scope.conditions ?? [] };
  return identityUuid({ kind: "claim-v1", sourceId: claim.sourceId, extractorVersion: claim.extractorVersion ?? "extract-v1", feature: claim.feature, polarity: claim.polarity, originalQuote: claim.originalQuote, scope });
}
