-- AccessReality P0. UTC timestamps; durable private workflow and audit records.
create extension if not exists pgcrypto;

create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  data_cid text unique,
  data_id text,
  name text not null check (length(name) between 1 and 300),
  address text not null default '' check (length(address) <= 1000),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  website text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash text not null check (length(request_hash) = 64),
  kind text not null check (kind in ('discovery', 'investigation')),
  venue_id uuid references public.venues(id),
  input jsonb not null check (octet_length(input::text) <= 16384),
  phase text not null check (phase in ('discovery','details','reviews','extract','assess','plan','targeted_search','finalize','complete','partial','cancelled')),
  state jsonb not null default '{}' check (octet_length(state::text) <= 524288),
  state_version integer not null default 0 check (state_version >= 0),
  lease_token uuid,
  lease_until timestamptz,
  next_retry_at timestamptz,
  stop_reason text check (stop_reason in ('evidence_sufficient','search_budget_exhausted','llm_budget_exhausted','no_new_evidence','no_eligible_actions','upstream_unavailable','time_limit','cancelled','ambiguous_dispatch')),
  next_action jsonb,
  cached_action_key text,
  visited_action_keys text[] not null default '{}',
  failed_stages text[] not null default '{}',
  serp_cap integer not null check (serp_cap between 0 and 5),
  serp_reserved integer not null default 0 check (serp_reserved >= 0 and serp_reserved <= serp_cap),
  llm_cap integer not null check (llm_cap between 0 and 6),
  llm_reserved integer not null default 0 check (llm_reserved >= 0 and llm_reserved <= llm_cap),
  app_cache_hits integer not null default 0 check (app_cache_hits >= 0),
  step_count integer not null default 0 check (step_count between 0 and 20),
  active_milliseconds integer not null default 0 check (active_milliseconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(session_id, idempotency_key),
  check ((lease_token is null) = (lease_until is null)),
  check ((kind = 'discovery' and serp_cap <= 1 and llm_cap = 0) or kind = 'investigation')
);
create index jobs_session_created on public.jobs(session_id, created_at);

create table public.budget_buckets (
  id text primary key,
  limit_units integer not null check (limit_units >= 0),
  reserved_units integer not null default 0 check (reserved_units >= 0 and reserved_units <= limit_units),
  enabled boolean not null default false,
  last_known_provider_remaining integer check (last_known_provider_remaining >= 0),
  checked_at timestamptz,
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
-- Fail closed until the owner checks real provider allowance and initializes caps.
insert into public.budget_buckets(id, limit_units, enabled) values
  ('global:serpapi', 0, false), ('global:gemini', 0, false), ('allocation:verification:serpapi',30,false);

create table public.provider_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  lease_token uuid not null,
  action_key text not null check (length(action_key) between 1 and 200),
  attempt_number integer not null check (attempt_number between 1 and 2),
  provider text not null check (provider in ('serpapi', 'gemini')),
  cache_key text,
  status text not null check (status in ('reserved_not_dispatched','dispatched','completed','failed','uncertain','released')),
  request_params jsonb not null check (octet_length(request_params::text) <= 16384),
  dispatch_started_at timestamptz,
  finished_at timestamptz,
  provider_search_id text,
  error_code text,
  created_at timestamptz not null default now(),
  unique(job_id, action_key, attempt_number),
  check (status not in ('dispatched','completed','uncertain') or dispatch_started_at is not null)
);
create index attempts_job_status on public.provider_attempts(job_id, status);
create unique index attempts_one_open_per_job on public.provider_attempts(job_id)
  where status in ('reserved_not_dispatched','dispatched');

create table public.attempt_budget_reservations (
  attempt_id uuid not null references public.provider_attempts(id),
  bucket_id text not null references public.budget_buckets(id),
  units integer not null default 1 check (units = 1),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  primary key(attempt_id, bucket_id)
);

create table public.provider_cache (
  cache_key text primary key check (length(cache_key) = 64),
  engine text not null,
  adapter_version text not null default '1',
  sanitized_payload jsonb check (octet_length(sanitized_payload::text) <= 524288),
  retrieved_at timestamptz,
  expires_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempt_id uuid references public.provider_attempts(id),
  check ((lease_token is null) = (lease_until is null))
);
create index cache_expiration on public.provider_cache(expires_at);

create table public.source_snapshots (
  id uuid primary key,
  venue_id uuid not null references public.venues(id),
  attempt_id uuid references public.provider_attempts(id),
  source_group_key text not null,
  kind text not null check (kind in ('maps_attribute','maps_review','search_snippet')),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  provider_review_id text,
  text text not null check (length(text) <= 4000),
  text_hash text not null check (length(text_hash) = 64),
  published_at timestamptz,
  edited_at timestamptz,
  observed_at timestamptz,
  retrieved_at timestamptz not null,
  metadata jsonb not null default '{}' check (octet_length(metadata::text) <= 65536),
  translated_text text check (length(translated_text) <= 4000),
  created_at timestamptz not null default now(),
  -- Same review/text snapshot can be reused; changed text creates a new immutable snapshot.
  unique(venue_id, source_group_key, text_hash, retrieved_at)
);
create index sources_venue_group on public.source_snapshots(venue_id, source_group_key);

create table public.job_sources (
  job_id uuid not null references public.jobs(id),
  source_id uuid not null references public.source_snapshots(id),
  primary key(job_id, source_id)
);

create table public.evidence_claims (
  id uuid primary key,
  venue_id uuid not null references public.venues(id),
  source_id uuid not null references public.source_snapshots(id),
  feature text not null check (feature in ('arrival_step_free','entrance_step_free','interior_movement','accessible_seating','accessible_restroom','accessible_parking','lift_present','lift_operational')),
  polarity text not null check (polarity in ('supports','barrier','unclear')),
  quote text not null check (length(quote) between 1 and 4000),
  quote_start integer,
  quote_end integer,
  json_pointer text,
  scope jsonb not null check (octet_length(scope::text) <= 8192),
  date_precision text not null check (date_precision in ('timestamp','day','approximate','unknown')),
  temporal_kind text not null check (temporal_kind in ('structural','operational')),
  venue_match text not null check (venue_match in ('exact','ambiguous')),
  extraction_status text not null check (extraction_status in ('accepted','rejected')),
  extractor_version text not null,
  metadata jsonb not null default '{}' check (octet_length(metadata::text) <= 32768),
  created_at timestamptz not null default now(),
  check ((quote_start is null and quote_end is null) or (quote_start >= 0 and quote_end > quote_start)),
  unique(source_id, extractor_version, feature, polarity, quote, scope)
);
create index claims_venue_feature on public.evidence_claims(venue_id, feature, created_at);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  revision integer not null check (revision > 0),
  profile_hash text not null,
  requirements jsonb not null check (octet_length(requirements::text) <= 16384),
  algorithm_version text not null,
  report jsonb not null check (octet_length(report::text) <= 524288),
  source_ids uuid[] not null default '{}',
  claim_ids uuid[] not null default '{}',
  is_partial boolean not null,
  created_at timestamptz not null default now(),
  unique(job_id, revision)
);

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.jobs(id),
  event_type text not null,
  payload jsonb not null default '{}' check (octet_length(payload::text) <= 4096),
  created_at timestamptz not null default now()
);
create index events_job_created on public.job_events(job_id, created_at);

create table public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null,
  count integer not null check (count >= 0),
  expires_at timestamptz not null
);

-- Immutability protects citation offsets and finalized report revisions, including service-role writes.
create function public.reject_evidence_update() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin raise exception 'Immutable evidence or report revision cannot be updated' using errcode = '55000'; end;
$$;
create trigger sources_immutable before update on public.source_snapshots
  for each row execute function public.reject_evidence_update();
create trigger claims_immutable before update on public.evidence_claims
  for each row execute function public.reject_evidence_update();
create trigger assessments_immutable before update on public.assessments
  for each row execute function public.reject_evidence_update();
