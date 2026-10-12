// Leave time for the workflow to persist its result within the 60-second route
// and 75-second database lease. A timeout never authorizes an automatic replay.
export const PROVIDER_TIMEOUT_MS = 40_000;
export const STEP_PROVIDER_DEADLINE_MS = 50_000;

export function providerTimeoutMs(requested?: number): number {
  return Math.max(1, Math.min(requested ?? PROVIDER_TIMEOUT_MS, PROVIDER_TIMEOUT_MS));
}
