export type ProviderErrorCode = "configuration" | "forbidden" | "quota" | "upstream" | "provider_error" | "schema_drift" | "timeout" | "network" | "invalid_json";
export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string, public retryable = false, public uncertain = false, public retryAfterSeconds: number | null = null) { super(message); this.name = "ProviderError"; }
}
