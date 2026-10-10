-- The browser never receives a Supabase credential. There are intentionally no client policies.
do $$
declare table_name text;
begin
  foreach table_name in array array['demo_sessions','venues','jobs','budget_buckets','provider_attempts',
    'attempt_budget_reservations','provider_cache','source_snapshots','job_sources','evidence_claims',
    'assessments','job_events','rate_limit_buckets'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;
revoke all on sequence public.job_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.job_events_id_seq to service_role;
revoke execute on function public.reject_evidence_update() from public, anon, authenticated;
grant execute on function public.reject_evidence_update() to service_role;
alter default privileges in schema public revoke execute on functions from public;
