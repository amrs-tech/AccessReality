import type { Venue } from "../contracts";
export function snippetVenueMatch(venue: Venue, title: string, snippet: string): "exact" | "ambiguous" {
  const normalize = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  const text = normalize(`${title} ${snippet}`); const name = normalize(venue.name);
  if (!text.includes(name) || !venue.address) return "ambiguous";
  // Require branch context, never a brand name alone. At least one meaningful address component must match.
  const branchParts = venue.address.split(",").map(normalize).filter((part) => part.length > 4 && !/^(india|karnataka|bengaluru|bangalore|\d+)$/.test(part));
  return branchParts.some((part) => text.includes(part)) ? "exact" : "ambiguous";
}
