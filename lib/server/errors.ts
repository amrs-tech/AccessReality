import 'server-only';
export class AppError extends Error {
  constructor(public code:string, public status:number=503, public retryable:boolean=false) { super(code); }
}
export const messages:Record<string,string>={
  configuration_missing:'Owner setup is incomplete. Configure the server environment before searching.',
  dependency_unavailable:'Durable storage is unavailable. No new search was dispatched.',
  not_found:'Investigation not found.', unauthenticated:'Your private session has expired. Sign in again.',
  invalid_code:'The access code was not accepted.', invalid_request:'Check the submitted fields.',
  forbidden:'This request could not be authorized.', busy:'Another step is in progress. Refresh and resume shortly.',
  version_conflict:'The investigation has advanced. Refresh its current state.',
  budget_exhausted:'The permitted attempt allowance is exhausted.', search_disabled:'New searches are disabled by the owner.',
  rate_limited:'Too many requests. Try again after the rate-limit window.', idempotency_conflict:'This request key has already been used for different input.',
  ambiguous_dispatch:'A previous request may have been sent. It will not be replayed automatically.',
  visit_brief_required:'Save a completed or partial visit brief before checking the news.',
};
