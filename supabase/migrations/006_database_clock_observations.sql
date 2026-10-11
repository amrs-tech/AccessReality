-- Account observations use the database's clock for elapsed time and freshness.
-- The application host clock can differ from PostgreSQL. Its retrieval timestamp
-- is diagnostic metadata only; it cannot extend freshness or override ordering.
-- Applied 001-005 remain unchanged.
create or replace function public.reconcile_serpapi_balance(p_remaining integer,p_snapshot jsonb,p_checked_at timestamptz,
  p_protected_reserve integer,p_owner_cap integer,p_enabled boolean,p_allow_increase boolean default false,p_preserve_enabled boolean default true) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare b public.budget_buckets; cap integer; sequence_now bigint; started_at timestamptz; estimate bigint;
  snapshot_sequence bigint; pending integer; received_at timestamptz := clock_timestamp();
begin
  if p_remaining is null or p_remaining<0 or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or p_checked_at is null
    or p_protected_reserve is null or p_protected_reserve<0 or p_owner_cap is null or p_owner_cap<0
    or p_enabled is null or p_allow_increase is null or p_preserve_enabled is null then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  begin
    snapshot_sequence:=(p_snapshot->>'sequence')::bigint; pending:=(p_snapshot->>'pending')::integer;
    started_at:=(p_snapshot->>'startedAt')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'code','invalid_input'); end;
  if snapshot_sequence is null or snapshot_sequence<0 or pending is null or pending<0 or started_at is null
    or started_at>received_at or received_at-started_at>interval '60 seconds' then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  perform 1 from public.budget_buckets where id in ('allocation:verification:serpapi','global:serpapi') order by id for update;
  received_at:=clock_timestamp();
  if started_at>received_at or received_at-started_at>interval '60 seconds' then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select * into b from public.budget_buckets where id='global:serpapi';
  if not found then return jsonb_build_object('ok',false,'code','not_initialized'); end if;
  sequence_now:=coalesce((b.metadata->>'reservation_sequence')::bigint,0);
  if snapshot_sequence>sequence_now then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  -- An older HTTP response cannot supersede a newer request's observation.
  if b.metadata ? 'balance_started_at' and started_at<(b.metadata->>'balance_started_at')::timestamptz then
    return jsonb_build_object('ok',true,'ignored',true,'bucket',to_jsonb(b),'policy',public.current_search_policy());
  end if;
  estimate:=greatest(0,p_remaining::bigint-pending-(sequence_now-snapshot_sequence));
  if p_allow_increase then cap:=greatest(b.reserved_units,least(p_owner_cap,b.reserved_units+greatest(0,estimate-p_protected_reserve)));
  else cap:=greatest(b.reserved_units,least(b.limit_units,p_owner_cap,b.reserved_units+greatest(0,estimate-p_protected_reserve))); end if;
  update public.budget_buckets set limit_units=cap,enabled=case when p_preserve_enabled then b.enabled and p_enabled else p_enabled end,last_known_provider_remaining=p_remaining,checked_at=received_at,
    metadata=metadata||jsonb_build_object('last_known_provider_remaining',p_remaining,'checked_at',received_at,'provider_retrieved_at',p_checked_at,'protected_reserve',p_protected_reserve,
      'balance_remaining_estimate',estimate,'balance_sequence',sequence_now,'balance_started_at',started_at),updated_at=now()
    where id=b.id returning * into b;
  insert into public.budget_buckets(id,limit_units,enabled) values('allocation:verification:serpapi',30,b.enabled) on conflict(id)
    do update set enabled=excluded.enabled,updated_at=now();
  insert into public.job_events(event_type,payload) values('budget_reconciled',jsonb_build_object('provider','serpapi','limit_units',cap,
    'reserved_units',b.reserved_units,'explicit_increase',p_allow_increase,'remaining_estimate',estimate,'observed_remaining',p_remaining));
  return jsonb_build_object('ok',true,'bucket',to_jsonb(b),'last_known_provider_remaining',p_remaining,'checked_at',received_at,'provider_retrieved_at',p_checked_at,
    'policy',public.current_search_policy());
end $$;

create or replace function public.preflight_status() returns jsonb
language plpgsql stable set search_path = pg_catalog, public as $$
declare b public.budget_buckets; llm public.budget_buckets; rls_ok boolean; grants_ok boolean; rpc_count integer;
begin
  select * into b from public.budget_buckets where id='global:serpapi';
  select * into llm from public.budget_buckets where id='global:gemini';
  select count(*)=13 and bool_and(c.relrowsecurity) into rls_ok from pg_class c
    where c.relnamespace='public'::regnamespace and c.relname in ('demo_sessions','venues','jobs','budget_buckets','provider_attempts',
      'attempt_budget_reservations','provider_cache','source_snapshots','job_sources','evidence_claims','assessments','job_events','rate_limit_buckets');
  select count(*),bool_and(not p.prosecdef and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')) into rpc_count,grants_ok from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('create_job','claim_step','reserve_provider_attempt','mark_dispatch',
      'commit_step','fail_step','cancel_job','save_assessment','consume_rate_limit','reconcile_budget','retention_cleanup','configure_limits',
      'preflight_status','reconcile_expired_cache','configure_llm_budget','current_search_policy','begin_serpapi_balance_check','reconcile_serpapi_balance');
  return jsonb_build_object('ok',coalesce(rls_ok and grants_ok and rpc_count=18,false),'migration','006','rpcVersion','3',
    'rlsEnabled',rls_ok,'privateGrants',grants_ok,'searchEnabled',coalesce(b.enabled,false),'limitUnits',b.limit_units,'reservedUnits',b.reserved_units,
    'llmBudgetSource','owner_attempt_cap','llmLimitUnits',llm.limit_units,'llmReservedUnits',llm.reserved_units,'searchPolicy',public.current_search_policy());
end $$;

revoke execute on function public.reconcile_serpapi_balance(integer,jsonb,timestamptz,integer,integer,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_serpapi_balance(integer,jsonb,timestamptz,integer,integer,boolean,boolean,boolean) to service_role;
revoke execute on function public.preflight_status() from public,anon,authenticated;
grant execute on function public.preflight_status() to service_role;
notify pgrst, 'reload schema';
