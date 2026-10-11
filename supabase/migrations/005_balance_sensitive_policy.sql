-- Balance-sensitive single-venue investigation bounds. Historical migrations stay immutable.
-- Lock order remains job -> cache -> sorted budget keys. No browser can execute these RPCs.
alter table public.jobs drop constraint jobs_serp_cap_check;
alter table public.jobs add constraint jobs_serp_cap_check check (serp_cap between 0 and 26);
alter table public.jobs drop constraint jobs_llm_cap_check;
alter table public.jobs add constraint jobs_llm_cap_check check (llm_cap between 0 and 56);
alter table public.jobs drop constraint jobs_step_count_check;
alter table public.jobs add constraint jobs_step_count_check check (step_count between 0 and 129);
alter table public.jobs add column serp_full_cap integer;
alter table public.jobs add column search_mode text not null default 'legacy' check (search_mode in ('expanded','conserve','legacy'));
alter table public.jobs add column step_cap integer not null default 20 check (step_cap between 1 and 128);
update public.jobs set serp_full_cap=serp_cap;
alter table public.jobs alter column serp_full_cap set not null;
alter table public.jobs alter column serp_full_cap set default 26;
alter table public.jobs add constraint jobs_serp_full_cap_check check (serp_full_cap between 0 and 26 and serp_cap<=serp_full_cap);
alter table public.jobs alter column step_cap set default 128;
-- Sequence is monotonic even when an undispatched reservation is refunded.
update public.budget_buckets set metadata=metadata||jsonb_build_object('reservation_sequence',
  (select count(*) from public.provider_attempts where provider='serpapi')) where id='global:serpapi';

create function public.current_search_policy(p_full_cap integer default 26) returns jsonb
language plpgsql stable set search_path = pg_catalog, public as $$
declare b public.budget_buckets; estimate bigint; fresh boolean; mode text;
begin
  if p_full_cap is null or p_full_cap not between 0 and 26 then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  select * into b from public.budget_buckets where id='global:serpapi';
  if b.metadata ? 'balance_remaining_estimate' then
    estimate:=greatest(0,(b.metadata->>'balance_remaining_estimate')::bigint-
      greatest(0,coalesce((b.metadata->>'reservation_sequence')::bigint,0)-coalesce((b.metadata->>'balance_sequence')::bigint,0)));
  end if;
  fresh:=b.checked_at is not null and b.checked_at>now()-interval '60 seconds' and b.checked_at<=now()+interval '5 seconds';
  mode:=case when coalesce(fresh,false) and estimate>50 then 'expanded' else 'conserve' end;
  return jsonb_build_object('ok',true,'mode',mode,'effectiveCap',case when mode='expanded' then p_full_cap else least(5,p_full_cap) end,
    'remainingEstimate',estimate,'checkedAt',b.checked_at,'fresh',coalesce(fresh,false),'threshold',50);
end $$;

drop function public.configure_limits(integer,integer);
create function public.configure_limits(p_serp_daily integer,p_serp_session integer default 64,p_allow_increase boolean default false,
  p_gemini_daily integer default 240,p_gemini_session integer default 96) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
begin
  if p_serp_daily is null or p_serp_daily not between 0 and 1000 or p_serp_session is null or p_serp_session not between 0 and 1000
    or p_gemini_daily is null or p_gemini_daily not between 0 and 1000 or p_gemini_session is null or p_gemini_session not between 0 and 1000
    or p_allow_increase is null then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  perform 1 from public.budget_buckets where id in ('global:serpapi','global:gemini') or id like 'day:%' or id like 'session:%' order by id for update;
  update public.budget_buckets set metadata=metadata||jsonb_build_object('daily_limit',p_serp_daily,'session_limit',p_serp_session),updated_at=now() where id='global:serpapi';
  update public.budget_buckets set metadata=metadata||jsonb_build_object('daily_limit',p_gemini_daily,'session_limit',p_gemini_session),updated_at=now() where id='global:gemini';
  update public.budget_buckets set limit_units=greatest(reserved_units,case when p_allow_increase then p_serp_daily else least(limit_units,p_serp_daily) end),updated_at=now() where id like 'day:%:serpapi';
  update public.budget_buckets set limit_units=greatest(reserved_units,case when p_allow_increase then p_serp_session else least(limit_units,p_serp_session) end),updated_at=now() where id like 'session:%:serpapi';
  update public.budget_buckets set limit_units=greatest(reserved_units,case when p_allow_increase then p_gemini_daily else least(limit_units,p_gemini_daily) end),updated_at=now() where id like 'day:%:gemini';
  update public.budget_buckets set limit_units=greatest(reserved_units,case when p_allow_increase then p_gemini_session else least(limit_units,p_gemini_session) end),updated_at=now() where id like 'session:%:gemini';
  insert into public.job_events(event_type,payload) values('limits_configured',jsonb_build_object('daily_limit',p_serp_daily,'session_limit',p_serp_session,
    'gemini_daily_limit',p_gemini_daily,'gemini_session_limit',p_gemini_session,'explicit_increase',p_allow_increase));
  return jsonb_build_object('ok',true,'daily_limit',p_serp_daily,'session_limit',p_serp_session,
    'gemini_daily_limit',p_gemini_daily,'gemini_session_limit',p_gemini_session,'explicit_increase',p_allow_increase);
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
  return jsonb_build_object('ok',coalesce(rls_ok and grants_ok and rpc_count=18,false),'migration','005','rpcVersion','3',
    'rlsEnabled',rls_ok,'privateGrants',grants_ok,'searchEnabled',coalesce(b.enabled,false),'limitUnits',b.limit_units,'reservedUnits',b.reserved_units,
    'llmBudgetSource','owner_attempt_cap','llmLimitUnits',llm.limit_units,'llmReservedUnits',llm.reserved_units,'searchPolicy',public.current_search_policy());
end $$;

create function public.begin_serpapi_balance_check() returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare b public.budget_buckets; pending integer;
begin
  select * into b from public.budget_buckets where id='global:serpapi' for update;
  if not found then return jsonb_build_object('ok',false,'code','not_initialized'); end if;
  select count(*) into pending from public.provider_attempts where provider='serpapi' and status in ('reserved_not_dispatched','dispatched');
  return jsonb_build_object('ok',true,'snapshot',jsonb_build_object('sequence',coalesce((b.metadata->>'reservation_sequence')::bigint,0),
    'pending',pending,'startedAt',clock_timestamp()));
end $$;

create function public.reconcile_serpapi_balance(p_remaining integer,p_snapshot jsonb,p_checked_at timestamptz,
  p_protected_reserve integer,p_owner_cap integer,p_enabled boolean,p_allow_increase boolean default false,p_preserve_enabled boolean default true) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare b public.budget_buckets; cap integer; sequence_now bigint; started_at timestamptz; estimate bigint;
  snapshot_sequence bigint; pending integer;
begin
  if p_remaining is null or p_remaining<0 or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or p_checked_at is null or p_checked_at>clock_timestamp()+interval '5 seconds'
    or p_protected_reserve is null or p_protected_reserve<0 or p_owner_cap is null or p_owner_cap<0
    or p_enabled is null or p_allow_increase is null or p_preserve_enabled is null then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  begin
    snapshot_sequence:=(p_snapshot->>'sequence')::bigint; pending:=(p_snapshot->>'pending')::integer;
    started_at:=(p_snapshot->>'startedAt')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'code','invalid_input'); end;
  if snapshot_sequence is null or snapshot_sequence<0 or pending is null or pending<0 or started_at is null
    or started_at>p_checked_at or p_checked_at-started_at>interval '60 seconds' then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  perform 1 from public.budget_buckets where id in ('allocation:verification:serpapi','global:serpapi') order by id for update;
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
  update public.budget_buckets set limit_units=cap,enabled=case when p_preserve_enabled then b.enabled and p_enabled else p_enabled end,last_known_provider_remaining=p_remaining,checked_at=p_checked_at,
    metadata=metadata||jsonb_build_object('last_known_provider_remaining',p_remaining,'checked_at',p_checked_at,'protected_reserve',p_protected_reserve,
      'balance_remaining_estimate',estimate,'balance_sequence',sequence_now,'balance_started_at',started_at),updated_at=now()
    where id=b.id returning * into b;
  insert into public.budget_buckets(id,limit_units,enabled) values('allocation:verification:serpapi',30,b.enabled) on conflict(id)
    do update set enabled=excluded.enabled,updated_at=now();
  insert into public.job_events(event_type,payload) values('budget_reconciled',jsonb_build_object('provider','serpapi','limit_units',cap,
    'reserved_units',b.reserved_units,'explicit_increase',p_allow_increase,'remaining_estimate',estimate,'observed_remaining',p_remaining));
  return jsonb_build_object('ok',true,'bucket',to_jsonb(b),'last_known_provider_remaining',p_remaining,'checked_at',p_checked_at,
    'policy',public.current_search_policy());
end $$;

-- Compatibility for owner scripts. Fresh HTTP callers must use begin + reconcile_serpapi_balance.
create or replace function public.reconcile_budget(p_provider text,p_remaining integer,p_protected_reserve integer,p_owner_cap integer,
  p_enabled boolean,p_allow_increase boolean default false) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare snapshot jsonb;
begin
  if p_provider='gemini' then return public.configure_llm_budget(p_owner_cap,p_enabled,p_allow_increase); end if;
  if p_provider is distinct from 'serpapi' then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  -- This compatibility wrapper performs both operations in one transaction. Take
  -- every later budget lock in sorted order before begin's global lock.
  perform 1 from public.budget_buckets where id in ('allocation:verification:serpapi','global:serpapi') order by id for update;
  snapshot:=public.begin_serpapi_balance_check();
  if not coalesce((snapshot->>'ok')::boolean,false) then return snapshot; end if;
  return public.reconcile_serpapi_balance(p_remaining,snapshot->'snapshot',clock_timestamp(),p_protected_reserve,p_owner_cap,p_enabled,p_allow_increase,false);
end $$;

-- Keep existing callers compatible with the additional optional step bound.
drop function public.create_job(uuid,text,text,text,uuid,jsonb,jsonb,integer,integer);
create function public.create_job(p_session_id uuid, p_key text, p_hash text, p_kind text,
  p_venue_id uuid, p_input jsonb, p_state jsonb, p_serp_cap integer default 26, p_llm_cap integer default 56, p_step_cap integer default 128) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; created boolean := false; canonical_venue public.venues; matched_venue public.venues;
  observed_place text; observed_cid text; matching_count integer := 0; policy jsonb; effective_cap integer; mode text;
begin
  if not exists(select 1 from public.demo_sessions where id=p_session_id and expires_at>now() and revoked_at is null) then
    return jsonb_build_object('ok',false,'code','not_found');
  end if;
  if p_kind not in ('discovery','investigation') or (p_kind='investigation' and p_venue_id is null)
    or p_serp_cap not between 0 and 26 or p_llm_cap not between 0 and 56 or p_step_cap not between 1 and 128 then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  if p_kind='investigation' then
    if p_state#>>'{venue,id}' is distinct from p_venue_id::text then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
    observed_place := p_state#>>'{venue,googlePlaceId}';
    observed_cid := p_state#>>'{venue,dataCid}';
    insert into public.venues(id,google_place_id,data_cid,data_id,name,address,latitude,longitude,website,phone)
      values(p_venue_id,p_state#>>'{venue,googlePlaceId}',p_state#>>'{venue,dataCid}',p_state#>>'{venue,dataId}',
        p_state#>>'{venue,name}',coalesce(p_state#>>'{venue,address}',''),(p_state#>>'{venue,latitude}')::double precision,
        (p_state#>>'{venue,longitude}')::double precision,p_state#>>'{venue,website}',p_state#>>'{venue,phone}')
      on conflict do nothing;
    -- Provider identifiers, never names, resolve separately discovered copies of the same branch.
    -- Lock both possible identity matches in sorted order. Two distinct matches are a conflict, never a merge.
    for matched_venue in select * from public.venues where
      (observed_place is not null and google_place_id=observed_place) or
      (observed_cid is not null and data_cid=observed_cid) or
      (observed_place is null and observed_cid is null and id=p_venue_id) order by id for update loop
      matching_count := matching_count+1;
      if matching_count=1 then canonical_venue:=matched_venue; end if;
    end loop;
    if matching_count<>1 or (canonical_venue.google_place_id is not null and observed_place is not null
      and canonical_venue.google_place_id<>observed_place)
      or (canonical_venue.data_cid is not null and observed_cid is not null and canonical_venue.data_cid<>observed_cid) then
      return jsonb_build_object('ok',false,'code','venue_identity_conflict');
    end if;
    begin
      -- Enrich a previously CID-only/place-only record using newly observed identifiers; never overwrite known IDs.
      update public.venues v set google_place_id=coalesce(v.google_place_id,observed_place),data_cid=coalesce(v.data_cid,observed_cid),
        data_id=coalesce(v.data_id,p_state#>>'{venue,dataId}') where v.id=canonical_venue.id returning v.* into canonical_venue;
    exception when unique_violation then
      -- A concurrent enrichment may have bound this identifier to another record after the match query.
      return jsonb_build_object('ok',false,'code','venue_identity_conflict');
    end;
    p_venue_id := canonical_venue.id;
    p_state := jsonb_set(p_state,'{venue,id}',to_jsonb(p_venue_id::text));
  end if;
  -- Existing idempotent jobs return without changing their budget policy.
  select * into j from public.jobs where session_id=p_session_id and idempotency_key=p_key for update;
  if found then
    if j.request_hash<>p_hash then return jsonb_build_object('ok',false,'code','idempotency_conflict'); end if;
    return jsonb_build_object('ok',true,'created',false,'job',to_jsonb(j));
  end if;
  perform 1 from public.budget_buckets where id='global:serpapi' for update;
  policy:=public.current_search_policy(p_serp_cap);
  effective_cap:=case when p_kind='discovery' then least(1,p_serp_cap) else (policy->>'effectiveCap')::integer end;
  mode:=case when p_kind='discovery' then 'legacy' else policy->>'mode' end;
  insert into public.jobs(session_id,idempotency_key,request_hash,kind,venue_id,input,phase,state,serp_cap,llm_cap,serp_full_cap,search_mode,step_cap)
  values(p_session_id,p_key,p_hash,p_kind,p_venue_id,p_input,case when p_kind='discovery' then 'discovery' else 'details' end,
    p_state,effective_cap,case when p_kind='discovery' then 0 else p_llm_cap end,case when p_kind='discovery' then least(1,p_serp_cap) else p_serp_cap end,mode,case when p_kind='discovery' then 20 else p_step_cap end)
  on conflict(session_id,idempotency_key) do nothing returning * into j;
  created := found;
  if not created then
    select * into j from public.jobs where session_id=p_session_id and idempotency_key=p_key;
    if j.request_hash<>p_hash then return jsonb_build_object('ok',false,'code','idempotency_conflict'); end if;
  else
    insert into public.job_events(job_id,event_type) values(j.id,'created');
  end if;
  return jsonb_build_object('ok',true,'created',created,'job',to_jsonb(j));
end $$;

create or replace function public.claim_step(p_session_id uuid,p_job_id uuid,p_expected_version integer) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; a public.provider_attempts; token uuid := gen_random_uuid(); ambiguous boolean := false; policy jsonb;
begin
  select * into j from public.jobs where id=p_job_id and session_id=p_session_id for update;
  if not found or not exists(select 1 from public.demo_sessions where id=p_session_id and expires_at>now() and revoked_at is null) then
    return jsonb_build_object('ok',false,'code','not_found');
  end if;
  if j.phase in ('complete','partial','cancelled') then return jsonb_build_object('ok',false,'code','terminal','job',to_jsonb(j)); end if;
  if j.state_version<>p_expected_version then return jsonb_build_object('ok',false,'code','version_conflict','job',to_jsonb(j)); end if;
  if j.lease_until>now() or j.next_retry_at>now() then return jsonb_build_object('ok',false,'code','busy','job',to_jsonb(j)); end if;
  if j.lease_token is not null then
    for a in select * from public.provider_attempts where job_id=j.id and status in ('reserved_not_dispatched','dispatched') order by cache_key nulls first loop
      if a.status='reserved_not_dispatched' then
        perform public.release_undispatched_attempt(a.id,'lease_expired_before_dispatch');
      else
        if a.cache_key is not null then perform 1 from public.provider_cache where cache_key=a.cache_key for update; end if;
        update public.provider_attempts set status='uncertain',finished_at=now(),error_code='lease_expired_after_dispatch' where id=a.id;
        update public.provider_cache set lease_token=null,lease_until=null where cache_key=a.cache_key and attempt_id=a.id;
        ambiguous := true;
      end if;
    end loop;
  end if;
  if ambiguous then
    update public.jobs set phase='partial',stop_reason='ambiguous_dispatch',state_version=state_version+1,
      lease_token=null,lease_until=null,finished_at=now(),updated_at=now(),failed_stages=array_append(failed_stages,j.phase)
      where id=j.id returning * into j;
    insert into public.job_events(job_id,event_type) values(j.id,'ambiguous_dispatch');
    return jsonb_build_object('ok',false,'code','ambiguous_dispatch','job',to_jsonb(j));
  end if;
  if j.kind='investigation' and j.search_mode<>'legacy' then
    perform 1 from public.budget_buckets where id='global:serpapi' for update;
    policy:=public.current_search_policy(j.serp_full_cap);
    update public.jobs set serp_cap=greatest(serp_reserved,(policy->>'effectiveCap')::integer),search_mode=policy->>'mode'
      where id=j.id returning * into j;
  end if;
  if (j.step_count>=j.step_cap or j.active_milliseconds>=300000) and j.phase<>'finalize' then
    update public.jobs set phase='partial',stop_reason='time_limit',state_version=state_version+1,
      lease_token=null,lease_until=null,finished_at=now(),updated_at=now() where id=j.id returning * into j;
    return jsonb_build_object('ok',false,'code','terminal','job',to_jsonb(j));
  end if;
  update public.jobs set lease_token=token,lease_until=now()+interval '75 seconds',next_retry_at=null,
    cached_action_key=null,step_count=step_count+1,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'lease_token',token,'state_version',j.state_version,'job',to_jsonb(j));
end $$;

create or replace function public.reserve_provider_attempt(p_job_id uuid,p_lease_token uuid,p_action_key text,p_provider text,
  p_cache_key text,p_params jsonb,p_engine text,p_ttl_seconds integer) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; c public.provider_cache; a public.provider_attempts; prior public.provider_attempts;
  keys text[]; b public.budget_buckets; attempt_no integer; token uuid := gen_random_uuid(); global_key text; policy jsonb; effective_cap integer; sequence_now bigint;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.lease_token is distinct from p_lease_token or j.lease_until<=now() or j.phase in ('complete','partial','cancelled') then
    return jsonb_build_object('ok',false,'code','stale_lease');
  end if;
  if not exists(select 1 from public.demo_sessions where id=j.session_id and expires_at>now() and revoked_at is null) then
    return jsonb_build_object('ok',false,'code','not_found');
  end if;
  if p_provider not in ('serpapi','gemini') or p_ttl_seconds<0 or p_ttl_seconds>86400
    or p_params ?| array['api_key','key','authorization','cookie','access_code','service_role_key'] then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  if exists(select 1 from public.provider_attempts where job_id=j.id and action_key=p_action_key and status in ('completed','uncertain'))
    or p_action_key=any(j.visited_action_keys) then
    return jsonb_build_object('ok',false,'code','action_completed');
  end if;
  if exists(select 1 from public.provider_attempts where job_id=j.id and status in ('reserved_not_dispatched','dispatched')) then
    return jsonb_build_object('ok',false,'code','busy');
  end if;
  if p_cache_key is not null then
    insert into public.provider_cache(cache_key,engine,adapter_version) values(p_cache_key,p_engine,coalesce(p_params->>'adapter_version','1')) on conflict do nothing;
    select * into c from public.provider_cache where cache_key=p_cache_key for update;
    if c.expires_at>now() and c.sanitized_payload is not null then
      update public.jobs set app_cache_hits=app_cache_hits+1,cached_action_key=p_action_key where id=j.id;
      insert into public.job_events(job_id,event_type,payload) values(j.id,'cache_hit',jsonb_build_object('action_key',p_action_key));
      return jsonb_build_object('ok',true,'kind','cache','payload',c.sanitized_payload,'retrieved_at',c.retrieved_at);
    end if;
    if c.lease_until>now() then return jsonb_build_object('ok',false,'code','busy'); end if;
    if c.attempt_id is not null then
      select * into prior from public.provider_attempts where id=c.attempt_id;
      if prior.status in ('dispatched','uncertain') then
        -- Do not acquire another job lock while holding this cache lock. Its owner reconciles it on resume.
        return jsonb_build_object('ok',false,'code',case when prior.status='uncertain' then 'ambiguous_dispatch' else 'busy' end,
          'needs_reconciliation',prior.status='dispatched');
      elsif prior.status='reserved_not_dispatched' then
        return jsonb_build_object('ok',false,'code','busy','needs_reconciliation',true);
      end if;
    end if;
  end if;
  if p_provider='gemini' and j.llm_reserved>=j.llm_cap then
    return jsonb_build_object('ok',false,'code','budget_exhausted');
  end if;
  select coalesce(max(attempt_number),0)+1 into attempt_no from public.provider_attempts where job_id=j.id and action_key=p_action_key;
  if attempt_no>2 then return jsonb_build_object('ok',false,'code','retry_exhausted'); end if;
  global_key := 'global:'||p_provider;
  keys := array[global_key,'session:'||j.session_id::text||':'||p_provider,'day:'||to_char(now() at time zone 'UTC','YYYY-MM-DD')||':'||p_provider];
  if p_provider='serpapi' and j.input->>'_allocation'='verification' then keys:=array_append(keys,'allocation:verification:serpapi'); end if;
  -- Insert keys in the same order in which they will be locked, including concurrent first use.
  foreach global_key in array array(select unnest(keys) order by 1) loop
    if global_key like 'session:%' then
      insert into public.budget_buckets(id,limit_units,enabled) values(global_key,case when p_provider='serpapi' then
        coalesce((select (metadata->>'session_limit')::integer from public.budget_buckets where id='global:serpapi'),64) else coalesce((select (metadata->>'session_limit')::integer from public.budget_buckets where id='global:gemini'),96) end,true) on conflict do nothing;
    elsif global_key like 'day:%' then
      insert into public.budget_buckets(id,limit_units,enabled) values(global_key,case when p_provider='serpapi' then
        coalesce((select (metadata->>'daily_limit')::integer from public.budget_buckets where id='global:serpapi'),60) else coalesce((select (metadata->>'daily_limit')::integer from public.budget_buckets where id='global:gemini'),240) end,true) on conflict do nothing;
    end if;
  end loop;
  if not exists(select 1 from public.budget_buckets where id='global:'||p_provider) then
    return jsonb_build_object('ok',false,'code','search_disabled');
  end if;
  if (select count(*) from public.budget_buckets where id=any(keys))<>cardinality(keys) then
    return jsonb_build_object('ok',false,'code','search_disabled');
  end if;
  for b in select * from public.budget_buckets where id=any(keys) order by id for update loop
    if not b.enabled then return jsonb_build_object('ok',false,'code','search_disabled'); end if;
    if b.reserved_units>=b.limit_units then return jsonb_build_object('ok',false,'code','budget_exhausted'); end if;
  end loop;
  if p_provider='serpapi' then
    if j.kind='investigation' and j.search_mode<>'legacy' then
      policy:=public.current_search_policy(j.serp_full_cap); effective_cap:=(policy->>'effectiveCap')::integer;
      update public.jobs set serp_cap=greatest(serp_reserved,effective_cap),search_mode=policy->>'mode' where id=j.id returning * into j;
    else effective_cap:=j.serp_cap; end if;
    if j.serp_reserved>=effective_cap then
      return jsonb_build_object('ok',false,'code','budget_exhausted','budgetScope','job','effectiveSearchCap',effective_cap,'job',to_jsonb(j));
    end if;
    select coalesce((metadata->>'reservation_sequence')::bigint,0)+1 into sequence_now from public.budget_buckets where id='global:serpapi';
    update public.budget_buckets set metadata=metadata||jsonb_build_object('reservation_sequence',sequence_now) where id='global:serpapi';
  end if;
  insert into public.provider_attempts(job_id,lease_token,action_key,attempt_number,provider,cache_key,status,request_params)
    values(j.id,p_lease_token,p_action_key,attempt_no,p_provider,p_cache_key,'reserved_not_dispatched',case when p_provider='serpapi' then p_params||jsonb_build_object('_reservation_sequence',sequence_now) else p_params end) returning * into a;
  update public.budget_buckets set reserved_units=reserved_units+1,updated_at=now() where id=any(keys);
  insert into public.attempt_budget_reservations(attempt_id,bucket_id) select a.id,unnest(keys);
  update public.jobs set serp_reserved=serp_reserved+case when p_provider='serpapi' then 1 else 0 end,
    llm_reserved=llm_reserved+case when p_provider='gemini' then 1 else 0 end where id=j.id;
  if p_cache_key is not null then
    update public.provider_cache set lease_token=token,lease_until=j.lease_until,attempt_id=a.id where cache_key=p_cache_key;
  end if;
  insert into public.job_events(job_id,event_type,payload) values(j.id,'attempt_reserved',jsonb_build_object('attempt_id',a.id,'provider',p_provider,'action_key',p_action_key));
  return jsonb_build_object('ok',true,'kind','reserved','attempt_id',a.id,'cache_lease_token',token);
end $$;

create or replace function public.mark_dispatch(p_attempt_id uuid,p_lease_token uuid) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; a public.provider_attempts; b public.budget_buckets; policy jsonb; estimate bigint; effective_cap integer;
begin
  select j0.* into j from public.jobs j0 join public.provider_attempts a0 on a0.job_id=j0.id where a0.id=p_attempt_id for update of j0;
  select * into a from public.provider_attempts where id=p_attempt_id for update;
  if j.id is null or j.lease_token is distinct from p_lease_token or j.lease_until<=now() or j.phase in ('complete','partial','cancelled')
    or a.lease_token<>p_lease_token or a.status<>'reserved_not_dispatched' then
    return jsonb_build_object('ok',false,'code','stale_lease');
  end if;
  if not exists(select 1 from public.demo_sessions where id=j.session_id and expires_at>now() and revoked_at is null) then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- Acquire any cache lock before budgets, including possible undispatched release below.
  if a.cache_key is not null then perform 1 from public.provider_cache where cache_key=a.cache_key for update; end if;
  perform 1 from public.budget_buckets where id in
    (select bucket_id from public.attempt_budget_reservations where attempt_id=a.id and released_at is null) order by id for update;
  if a.provider='serpapi' and j.kind='investigation' and j.search_mode<>'legacy' then
    policy:=public.current_search_policy(j.serp_full_cap);
    -- The account estimate already debits this still-undispatched attempt. Add it back
    -- for the last-moment decision; concurrent reservations remain conservatively debited.
    estimate:=case when policy->>'remainingEstimate' is null then null else (policy->>'remainingEstimate')::bigint+1 end;
    effective_cap:=case when coalesce((policy->>'fresh')::boolean,false) and estimate>50 then j.serp_full_cap else least(5,j.serp_full_cap) end;
    if j.serp_reserved>effective_cap then
      perform public.release_undispatched_attempt(a.id,'low_balance_before_dispatch');
      update public.jobs set serp_cap=greatest(serp_reserved,effective_cap),search_mode='conserve' where id=j.id;
      return jsonb_build_object('ok',false,'code','budget_exhausted','budgetScope','job','effectiveSearchCap',effective_cap);
    end if;
    update public.jobs set serp_cap=greatest(serp_reserved,effective_cap),search_mode=case when effective_cap=j.serp_full_cap and coalesce((policy->>'fresh')::boolean,false) and estimate>50 then 'expanded' else 'conserve' end where id=j.id;
  end if;
  -- The kill switch is checked again immediately before dispatch.
  if not exists(select 1 from public.budget_buckets where id='global:'||a.provider and enabled) then
    perform public.release_undispatched_attempt(a.id,'search_disabled_before_dispatch');
    return jsonb_build_object('ok',false,'code','search_disabled');
  end if;
  update public.provider_attempts set status='dispatched',dispatch_started_at=now() where id=a.id;
  insert into public.job_events(job_id,event_type,payload) values(j.id,'dispatch_started',jsonb_build_object('attempt_id',a.id));
  return jsonb_build_object('ok',true,'attempt_id',a.id);
end $$;

create or replace function public.fail_step(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_attempt_id uuid,
  p_code text,p_uncertain boolean,p_retry_at timestamptz,p_phase text,p_state jsonb) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; a public.provider_attempts; ambiguous boolean := false;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.lease_token is distinct from p_lease_token or j.lease_until<=now() or j.state_version<>p_expected_version
    or j.phase in ('complete','partial','cancelled') then return jsonb_build_object('ok',false,'code','stale_lease'); end if;
  if p_attempt_id is not null then
    select * into a from public.provider_attempts where id=p_attempt_id and job_id=j.id for update;
    if not found or a.lease_token<>p_lease_token then return jsonb_build_object('ok',false,'code','stale_attempt'); end if;
    if a.status='reserved_not_dispatched' then perform public.release_undispatched_attempt(a.id,'failure_before_dispatch');
    elsif a.status='dispatched' then
      if a.cache_key is not null then perform 1 from public.provider_cache where cache_key=a.cache_key for update; end if;
      ambiguous := p_uncertain;
      update public.provider_attempts set status=case when p_uncertain then 'uncertain' else 'failed' end,
        error_code=left(p_code,100),finished_at=now() where id=a.id;
      update public.provider_cache set lease_token=null,lease_until=null where cache_key=a.cache_key and attempt_id=a.id;
    elsif a.status='released' and a.dispatch_started_at is null then
      -- mark_dispatch may have atomically released this same lease's attempt after
      -- a low balance or kill-switch transition. Save the checkpoint without
      -- refunding again or changing the existing release audit.
      null;
    else return jsonb_build_object('ok',false,'code','stale_attempt'); end if;
  end if;
  update public.jobs set phase=case when ambiguous then 'partial' else p_phase end,state=p_state,state_version=state_version+1,
    lease_token=null,lease_until=null,next_retry_at=case when ambiguous or p_retry_at is null then null else least(p_retry_at,now()+interval '60 seconds') end,
    failed_stages=case when p_code='busy' then failed_stages else array_append(failed_stages,j.phase) end,
    stop_reason=case when ambiguous then 'ambiguous_dispatch' when p_phase='partial' then 'upstream_unavailable' else null end,
    active_milliseconds=active_milliseconds+least(75000,greatest(0,(extract(epoch from (now()-(j.lease_until-interval '75 seconds')))*1000)::integer)),
    finished_at=case when ambiguous or p_phase='partial' then now() else null end,updated_at=now()
    where id=j.id returning * into j;
  insert into public.job_events(job_id,event_type,payload) values(j.id,'step_failed',jsonb_build_object('code',left(p_code,100),'uncertain',ambiguous,'attempt_id',p_attempt_id));
  return jsonb_build_object('ok',true,'job',to_jsonb(j));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_job','claim_step','reserve_provider_attempt','mark_dispatch','reconcile_budget',
      'configure_limits','preflight_status','current_search_policy','begin_serpapi_balance_check','reconcile_serpapi_balance','fail_step') loop
    execute format('revoke execute on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
