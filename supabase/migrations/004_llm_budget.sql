-- Gemini has no account-balance API in this application. Its limits are owner-defined
-- attempt caps, never an observed token/request quota or a claimed provider allowance.
-- Preserve all counters and already-applied 001–003 history.
update public.budget_buckets set last_known_provider_remaining=null,checked_at=null,
  metadata=(metadata-'last_known_provider_remaining'-'checked_at'-'protected_reserve')||
    jsonb_build_object('allowance_source','owner_attempt_cap'),updated_at=now()
  where id='global:gemini';
insert into public.job_events(event_type,payload) values('llm_allowance_metadata_corrected',
  jsonb_build_object('provider','gemini','allowance_source','owner_attempt_cap'));

create or replace function public.configure_llm_budget(p_owner_cap integer,p_enabled boolean,p_allow_increase boolean default false)
returns jsonb language plpgsql set search_path = pg_catalog, public as $$
declare b public.budget_buckets; cap integer;
begin
  if p_owner_cap is null or p_owner_cap not between 0 and 1000000 or p_enabled is null or p_allow_increase is null then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  -- A budget-only transaction takes no job/cache locks afterward.
  select * into b from public.budget_buckets where id='global:gemini' for update;
  if not found then return jsonb_build_object('ok',false,'code','not_initialized'); end if;
  if p_allow_increase then cap:=greatest(b.reserved_units,p_owner_cap);
  else cap:=greatest(b.reserved_units,least(b.limit_units,p_owner_cap)); end if;
  update public.budget_buckets set limit_units=cap,enabled=p_enabled,
    last_known_provider_remaining=null,checked_at=null,
    metadata=(metadata-'last_known_provider_remaining'-'checked_at'-'protected_reserve')||
      jsonb_build_object('allowance_source','owner_attempt_cap','owner_requested_cap',p_owner_cap,'configured_at',now()),
    updated_at=now() where id=b.id returning * into b;
  insert into public.job_events(event_type,payload) values('llm_budget_configured',
    jsonb_build_object('provider','gemini','allowance_source','owner_attempt_cap','limit_units',cap,
      'reserved_units',b.reserved_units,'explicit_increase',p_allow_increase));
  return jsonb_build_object('ok',true,'bucket',to_jsonb(b),'allowance_source','owner_attempt_cap',
    'last_known_provider_remaining',null,'checked_at',null);
end $$;

-- Keep the legacy signature compatible while preventing old callers from recording
-- their owner-defined Gemini cap as an invented provider balance.
create or replace function public.reconcile_budget(p_provider text,p_remaining integer,p_protected_reserve integer,p_owner_cap integer,
  p_enabled boolean,p_allow_increase boolean default false) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare b public.budget_buckets; cap integer;
begin
  if p_provider='gemini' then
    return public.configure_llm_budget(p_owner_cap,p_enabled,p_allow_increase);
  end if;
  if p_provider is null or p_provider<>'serpapi' or p_remaining is null or p_remaining<0
    or p_protected_reserve is null or p_protected_reserve<0 or p_owner_cap is null or p_owner_cap<0
    or p_enabled is null or p_allow_increase is null then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  -- Sorted lock order matches reservations including the verification allocation.
  perform 1 from public.budget_buckets where id='global:serpapi' or id='allocation:verification:serpapi' order by id for update;
  select * into b from public.budget_buckets where id='global:serpapi' for update;
  if not found then return jsonb_build_object('ok',false,'code','not_initialized'); end if;
  if p_allow_increase then cap:=greatest(b.reserved_units,least(p_owner_cap,b.reserved_units+greatest(0,p_remaining-p_protected_reserve)));
  else cap:=greatest(b.reserved_units,least(b.limit_units,p_owner_cap,b.reserved_units+greatest(0,p_remaining-p_protected_reserve))); end if;
  update public.budget_buckets set limit_units=cap,enabled=p_enabled,last_known_provider_remaining=p_remaining,checked_at=now(),
    metadata=metadata||jsonb_build_object('last_known_provider_remaining',p_remaining,'checked_at',now(),'protected_reserve',p_protected_reserve),updated_at=now()
    where id=b.id returning * into b;
  insert into public.budget_buckets(id,limit_units,enabled) values('allocation:verification:serpapi',30,p_enabled) on conflict(id)
    do update set enabled=excluded.enabled,updated_at=now();
  insert into public.job_events(event_type,payload) values('budget_reconciled',jsonb_build_object('provider','serpapi','limit_units',cap,'reserved_units',b.reserved_units,'explicit_increase',p_allow_increase));
  return jsonb_build_object('ok',true,'bucket',to_jsonb(b),'last_known_provider_remaining',p_remaining,'checked_at',now());
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
      'preflight_status','reconcile_expired_cache','configure_llm_budget');
  return jsonb_build_object('ok',coalesce(rls_ok and grants_ok and rpc_count=15,false),'migration','004','rpcVersion','2',
    'rlsEnabled',rls_ok,'privateGrants',grants_ok,'searchEnabled',coalesce(b.enabled,false),'limitUnits',b.limit_units,'reservedUnits',b.reserved_units,
    'llmBudgetSource','owner_attempt_cap','llmLimitUnits',llm.limit_units,'llmReservedUnits',llm.reserved_units);
end $$;

revoke execute on function public.configure_llm_budget(integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.configure_llm_budget(integer,boolean,boolean) to service_role;
revoke execute on function public.reconcile_budget(text,integer,integer,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_budget(text,integer,integer,integer,boolean,boolean) to service_role;
revoke execute on function public.preflight_status() from public,anon,authenticated;
grant execute on function public.preflight_status() to service_role;
