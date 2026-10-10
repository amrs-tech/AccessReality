-- All functions use invoker privileges. Only service_role can execute them.
-- Global lock order: job row, cache row, sorted budget keys.

create function public.create_job(p_session_id uuid, p_key text, p_hash text, p_kind text,
  p_venue_id uuid, p_input jsonb, p_state jsonb, p_serp_cap integer default 5, p_llm_cap integer default 6) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; created boolean := false; canonical_venue public.venues; matched_venue public.venues;
  observed_place text; observed_cid text; matching_count integer := 0;
begin
  if not exists(select 1 from public.demo_sessions where id=p_session_id and expires_at>now() and revoked_at is null) then
    return jsonb_build_object('ok',false,'code','not_found');
  end if;
  if p_kind not in ('discovery','investigation') or (p_kind='investigation' and p_venue_id is null)
    or p_serp_cap not between 0 and 5 or p_llm_cap not between 0 and 6 then
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
  insert into public.jobs(session_id,idempotency_key,request_hash,kind,venue_id,input,phase,state,serp_cap,llm_cap)
  values(p_session_id,p_key,p_hash,p_kind,p_venue_id,p_input,case when p_kind='discovery' then 'discovery' else 'details' end,
    p_state,case when p_kind='discovery' then least(1,p_serp_cap) else p_serp_cap end,case when p_kind='discovery' then 0 else p_llm_cap end)
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

-- Caller holds job lock. The report records exactly which immutable corpus revision it used.
create function public.insert_assessment_revision(p_job_id uuid,p_profile_hash text,p_requirements jsonb,
  p_algorithm_version text,p_report jsonb,p_is_partial boolean) returns uuid
language plpgsql set search_path = pg_catalog, public as $$
declare assessment_id uuid; source_ids uuid[]; claim_ids uuid[]; revision_no integer;
begin
  select coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) into source_ids
    from jsonb_array_elements(coalesce(p_report->'sources','[]'::jsonb));
  select coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) into claim_ids
    from jsonb_array_elements(coalesce(p_report->'claims','[]'::jsonb));
  if exists(select 1 from unnest(source_ids) s(id) where not exists
    (select 1 from public.job_sources js where js.job_id=p_job_id and js.source_id=s.id)) then
    raise exception 'Report references source outside job corpus' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_report->'claims','[]'::jsonb)) c(value) where not exists
    (select 1 from public.evidence_claims ec join public.job_sources js on js.source_id=ec.source_id
     where js.job_id=p_job_id and ec.id=(c.value->>'id')::uuid and ec.extractor_version=coalesce(c.value->>'extractorVersion',ec.extractor_version))) then
    raise exception 'Report references claim outside job extractor corpus' using errcode='23514';
  end if;
  select coalesce(max(revision),0)+1 into revision_no from public.assessments where job_id=p_job_id;
  insert into public.assessments(job_id,revision,profile_hash,requirements,algorithm_version,report,source_ids,claim_ids,is_partial)
    values(p_job_id,revision_no,p_profile_hash,p_requirements,p_algorithm_version,p_report,source_ids,claim_ids,p_is_partial)
    returning id into assessment_id;
  return assessment_id;
end $$;

create function public.commit_step(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_phase text,
  p_state jsonb,p_attempt_id uuid,p_payload jsonb,p_sources jsonb,p_claims jsonb,p_report jsonb,
  p_stop_reason text,p_cache_ttl integer) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
<<step_commit>>
declare j public.jobs; a public.provider_attempts; c public.provider_cache; s jsonb; ec jsonb;
  source_id uuid; source_venue uuid; source_hash text; source_group text; existing_id uuid; assessment_id uuid;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.lease_token is distinct from p_lease_token or j.lease_until<=now()
    or j.state_version<>p_expected_version or j.phase in ('complete','partial','cancelled') then
    return jsonb_build_object('ok',false,'code','stale_lease');
  end if;
  if not exists(select 1 from public.demo_sessions where id=j.session_id and expires_at>now() and revoked_at is null) then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if jsonb_array_length(coalesce(p_sources,'[]'))>64 or jsonb_array_length(coalesce(p_claims,'[]'))>128
    or p_cache_ttl not between 0 and 86400 then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  if p_attempt_id is not null then
    select * into a from public.provider_attempts where id=p_attempt_id and job_id=j.id for update;
    if not found or a.status<>'dispatched' or a.lease_token<>p_lease_token then return jsonb_build_object('ok',false,'code','stale_attempt'); end if;
    if a.cache_key is not null then
      select * into c from public.provider_cache where cache_key=a.cache_key for update;
      if c.attempt_id is distinct from a.id or c.lease_until<=now() then return jsonb_build_object('ok',false,'code','stale_cache_lease'); end if;
    end if;
  elsif exists(select 1 from public.provider_attempts where job_id=j.id and status in ('reserved_not_dispatched','dispatched')) then
    return jsonb_build_object('ok',false,'code','attempt_required');
  end if;
  for s in select value from jsonb_array_elements(coalesce(p_sources,'[]')) loop
    source_id := (s->>'id')::uuid;
    source_venue := coalesce(s->>'venueId',s->>'venue_id')::uuid;
    if source_venue is distinct from j.venue_id then raise exception 'Source venue mismatch' using errcode='23514'; end if;
    -- Built-in hash works even when Supabase installs pgcrypto in its extensions schema.
    source_hash := encode(sha256(convert_to(s->>'text','UTF8')),'hex');
    source_group := coalesce(s->>'sourceGroupKey',s->>'source_group_key',source_hash);
    insert into public.source_snapshots(id,venue_id,attempt_id,source_group_key,kind,source_url,provider_review_id,text,text_hash,
      published_at,edited_at,observed_at,retrieved_at,metadata,translated_text)
    values(source_id,source_venue,p_attempt_id,source_group,s->>'kind',coalesce(s->>'sourceUrl',s->>'source_url'),
      coalesce(s->>'providerReviewId',s->>'provider_review_id'),s->>'text',source_hash,
      coalesce(s->>'publishedAt',s->>'published_at')::timestamptz,coalesce(s->>'editedAt',s->>'edited_at')::timestamptz,
      coalesce(s->>'observedAt',s->>'observed_at')::timestamptz,coalesce(s->>'retrievedAt',s->>'retrieved_at')::timestamptz,
      jsonb_build_object('original',s),coalesce(s->>'translatedText',s->>'translated_text')) on conflict do nothing;
    select id into existing_id from public.source_snapshots where venue_id=source_venue and source_group_key=source_group and text_hash=source_hash
      and retrieved_at=coalesce(s->>'retrievedAt',s->>'retrieved_at')::timestamptz;
    if existing_id is distinct from source_id then
      raise exception 'Source identity must remain stable across cache reuse' using errcode='23514';
    end if;
    insert into public.job_sources(job_id,source_id) values(j.id,source_id) on conflict do nothing;
  end loop;
  for ec in select value from jsonb_array_elements(coalesce(p_claims,'[]')) loop
    source_id := coalesce(ec->>'sourceId',ec->>'source_id')::uuid;
    if not exists(select 1 from public.job_sources js join public.source_snapshots ss on ss.id=js.source_id
      where js.job_id=j.id and ss.id=step_commit.source_id and ss.venue_id=j.venue_id
      and (ec->>'extractionStatus'='rejected' or ec->>'extraction_status'='rejected'
        or position(coalesce(ec->>'originalQuote',ec->>'quote') in ss.text)>0)) then
      raise exception 'Claim provenance mismatch' using errcode='23514';
    end if;
    if coalesce(ec->>'venueId',ec->>'venue_id')::uuid is distinct from j.venue_id then raise exception 'Claim venue mismatch' using errcode='23514'; end if;
    insert into public.evidence_claims(id,venue_id,source_id,feature,polarity,quote,quote_start,quote_end,json_pointer,scope,
      date_precision,temporal_kind,venue_match,extraction_status,extractor_version,metadata)
    values((ec->>'id')::uuid,j.venue_id,source_id,ec->>'feature',ec->>'polarity',coalesce(ec->>'originalQuote',ec->>'quote'),
      coalesce(ec->>'quoteStart',ec->>'quote_start')::integer,coalesce(ec->>'quoteEnd',ec->>'quote_end')::integer,
      coalesce(ec->>'jsonPointer',ec->>'json_pointer'),ec->'scope',coalesce(ec->>'datePrecision',ec->>'date_precision'),
      coalesce(ec->>'temporalKind',ec->>'temporal_kind'),coalesce(ec->>'venueMatch',ec->>'venue_match'),
      coalesce(ec->>'extractionStatus',ec->>'extraction_status'),coalesce(ec->>'extractorVersion',ec->>'extractor_version','extract-v1'),
      jsonb_build_object('original',ec)) on conflict do nothing;
  end loop;
  if p_report is not null then
    assessment_id := public.insert_assessment_revision(j.id,p_report->>'profile_hash',p_report->'requirements',
      p_report->>'algorithm_version',p_report->'report',coalesce((p_report->>'is_partial')::boolean,false));
  end if;
  if p_attempt_id is not null then
    update public.provider_attempts set status='completed',finished_at=now(),
      provider_search_id=coalesce(p_payload->>'providerSearchId',p_payload->>'provider_search_id',p_payload#>>'{search_metadata,id}') where id=a.id;
    if a.cache_key is not null then
      update public.provider_cache set sanitized_payload=p_payload,retrieved_at=coalesce((p_payload->>'__retrievedAt')::timestamptz,now()),expires_at=now()+make_interval(secs=>p_cache_ttl),
        lease_token=null,lease_until=null where cache_key=a.cache_key and attempt_id=a.id;
    end if;
  end if;
  update public.jobs set phase=p_phase,state=p_state,state_version=state_version+1,lease_token=null,lease_until=null,
    next_action=p_state->'nextAction',stop_reason=p_stop_reason,updated_at=now(),
    active_milliseconds=active_milliseconds+least(75000,greatest(0,(extract(epoch from (now()-(j.lease_until-interval '75 seconds')))*1000)::integer)),
    visited_action_keys=case when p_attempt_id is not null then array_append(visited_action_keys,a.action_key)
      when j.cached_action_key is not null then array_append(visited_action_keys,j.cached_action_key) else visited_action_keys end,
    cached_action_key=null,
    finished_at=case when p_phase in ('complete','partial','cancelled') then now() else null end
    where id=j.id returning * into j;
  insert into public.job_events(job_id,event_type,payload) values(j.id,'step_committed',jsonb_build_object('phase',p_phase,'version',j.state_version,'attempt_id',p_attempt_id,
    'message',left(p_state->>'lastMessage',500),'planner_mode',p_state->>'plannerMode'));
  -- Bound per-job operational traces while keeping provider/budget audit independently.
  delete from public.job_events where job_id=j.id and id not in (select id from public.job_events where job_id=j.id order by id desc limit 100);
  return jsonb_build_object('ok',true,'job',to_jsonb(j),'assessment_id',assessment_id);
end $$;

create function public.fail_step(p_job_id uuid,p_lease_token uuid,p_expected_version integer,p_attempt_id uuid,
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

create function public.cancel_job(p_session_id uuid,p_job_id uuid) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; a public.provider_attempts;
begin
  select * into j from public.jobs where id=p_job_id and session_id=p_session_id for update;
  if not found or not exists(select 1 from public.demo_sessions where id=p_session_id and expires_at>now() and revoked_at is null) then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if j.phase in ('complete','partial','cancelled') then return jsonb_build_object('ok',true,'job',to_jsonb(j)); end if;
  for a in select * from public.provider_attempts where job_id=j.id and status in ('reserved_not_dispatched','dispatched') order by cache_key nulls first loop
    if a.status='reserved_not_dispatched' then perform public.release_undispatched_attempt(a.id,'cancelled_before_dispatch');
    else
      if a.cache_key is not null then perform 1 from public.provider_cache where cache_key=a.cache_key for update; end if;
      update public.provider_attempts set status='uncertain',finished_at=now(),error_code='cancelled_after_dispatch' where id=a.id;
      update public.provider_cache set lease_token=null,lease_until=null where cache_key=a.cache_key and attempt_id=a.id;
    end if;
  end loop;
  update public.jobs set phase='cancelled',state_version=state_version+1,lease_token=null,lease_until=null,
    next_retry_at=null,stop_reason='cancelled',finished_at=now(),updated_at=now() where id=j.id returning * into j;
  insert into public.job_events(job_id,event_type) values(j.id,'cancelled');
  return jsonb_build_object('ok',true,'job',to_jsonb(j));
end $$;

create function public.save_assessment(p_session_id uuid,p_job_id uuid,p_expected_version integer,p_profile_hash text,
  p_requirements jsonb,p_algorithm_version text,p_report jsonb,p_is_partial boolean) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; assessment_id uuid;
begin
  select * into j from public.jobs where id=p_job_id and session_id=p_session_id for update;
  if not found or j.kind<>'investigation' or not exists(select 1 from public.demo_sessions where id=p_session_id and expires_at>now() and revoked_at is null) then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if j.state_version<>p_expected_version then return jsonb_build_object('ok',false,'code','version_conflict'); end if;
  if j.lease_token is not null then return jsonb_build_object('ok',false,'code','busy'); end if;
  assessment_id := public.insert_assessment_revision(j.id,p_profile_hash,p_requirements,p_algorithm_version,p_report,p_is_partial);
  -- Corpus arrays already live once in the checkpoint. The immutable assessment retains the complete report.
  update public.jobs set state=state||jsonb_build_object('requirements',p_requirements,
      'report',p_report||jsonb_build_object('sources','[]'::jsonb,'claims','[]'::jsonb)),
    input=input||jsonb_build_object('requirements',p_requirements),state_version=state_version+1,updated_at=now()
    where id=j.id returning * into j;
  insert into public.job_events(job_id,event_type) values(j.id,'reassessed');
  return jsonb_build_object('ok',true,'job',to_jsonb(j),'assessment_id',assessment_id);
end $$;

create function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare r public.rate_limit_buckets;
begin
  if length(p_key)>200 or p_limit not between 1 and 1000 or p_window_seconds not between 1 and 86400 then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  insert into public.rate_limit_buckets(key,window_start,count,expires_at) values(p_key,now(),0,now()+make_interval(secs=>p_window_seconds)) on conflict do nothing;
  select * into r from public.rate_limit_buckets where key=p_key for update;
  if r.expires_at<=now() then
    update public.rate_limit_buckets set window_start=now(),count=0,expires_at=now()+make_interval(secs=>p_window_seconds) where key=p_key returning * into r;
  end if;
  if r.count>=p_limit then return jsonb_build_object('ok',true,'allowed',false,'count',r.count,'retry_after_seconds',greatest(1,ceil(extract(epoch from r.expires_at-now()))::integer)); end if;
  update public.rate_limit_buckets set count=count+1 where key=p_key returning * into r;
  return jsonb_build_object('ok',true,'allowed',true,'count',r.count,'retry_after_seconds',0);
end $$;

create function public.reconcile_budget(p_provider text,p_remaining integer,p_protected_reserve integer,p_owner_cap integer,
  p_enabled boolean,p_allow_increase boolean default false) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare b public.budget_buckets; cap integer;
begin
  if p_provider not in ('serpapi','gemini') or p_remaining<0 or p_protected_reserve<0 or p_owner_cap<0 then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  -- This function locks only a budget row; it never acquires a job/cache lock afterward.
  -- The verification allocation sorts before the global bucket, matching reservation lock order.
  perform 1 from public.budget_buckets where id='global:'||p_provider
    or (p_provider='serpapi' and id='allocation:verification:serpapi') order by id for update;
  select * into b from public.budget_buckets where id='global:'||p_provider for update;
  if not found then return jsonb_build_object('ok',false,'code','not_initialized'); end if;
  if p_allow_increase then cap := greatest(b.reserved_units,least(p_owner_cap,b.reserved_units+greatest(0,p_remaining-p_protected_reserve)));
  else cap := greatest(b.reserved_units,least(b.limit_units,p_owner_cap,b.reserved_units+greatest(0,p_remaining-p_protected_reserve))); end if;
  update public.budget_buckets set limit_units=cap,enabled=p_enabled,last_known_provider_remaining=p_remaining,checked_at=now(),
    metadata=metadata||jsonb_build_object('last_known_provider_remaining',p_remaining,'checked_at',now(),'protected_reserve',p_protected_reserve),updated_at=now()
    where id=b.id returning * into b;
  if p_provider='serpapi' then
    insert into public.budget_buckets(id,limit_units,enabled) values('allocation:verification:serpapi',30,p_enabled) on conflict(id)
      do update set enabled=excluded.enabled,updated_at=now();
  end if;
  insert into public.job_events(event_type,payload) values('budget_reconciled',jsonb_build_object('provider',p_provider,'limit_units',cap,'reserved_units',b.reserved_units,'explicit_increase',p_allow_increase));
  return jsonb_build_object('ok',true,'bucket',to_jsonb(b),'last_known_provider_remaining',p_remaining,'checked_at',now());
end $$;

create function public.retention_cleanup(p_dry_run boolean default true) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare caches integer; jobs_count integer; sources_count integer; rates integer; locked_job record; expired_jobs uuid[] := '{}';
begin
  select count(*) into caches from public.provider_cache where retrieved_at<now()-interval '7 days' and lease_token is null and sanitized_payload is not null;
  select count(*) into jobs_count from public.jobs where updated_at<now()-interval '30 days' and lease_token is null and (input<>'{}' or state<>'{}');
  select count(*) into sources_count from public.source_snapshots ss where ss.created_at<now()-interval '30 days'
    and not exists(select 1 from public.job_sources js join public.jobs j on j.id=js.job_id where js.source_id=ss.id and j.updated_at>=now()-interval '30 days');
  select count(*) into rates from public.rate_limit_buckets where expires_at<now();
  if not p_dry_run then
    -- Owner maintenance only. Never delete provider attempts or reservation/budget audit.
    -- Hold the affected job rows before any cache/source writes; the fixed ID list prevents later reverse locks.
    for locked_job in select id from public.jobs where updated_at<now()-interval '30 days' and lease_token is null order by id for update loop
      expired_jobs := array_append(expired_jobs,locked_job.id);
    end loop;
    perform 1 from public.provider_cache where retrieved_at<now()-interval '7 days' and lease_token is null order by cache_key for update;
    update public.provider_cache set sanitized_payload=null where retrieved_at<now()-interval '7 days' and lease_token is null;
    delete from public.assessments where job_id=any(expired_jobs);
    delete from public.job_sources where job_id=any(expired_jobs);
    delete from public.evidence_claims where source_id in (select ss.id from public.source_snapshots ss where ss.created_at<now()-interval '30 days' and not exists(select 1 from public.job_sources js where js.source_id=ss.id));
    delete from public.source_snapshots ss where ss.created_at<now()-interval '30 days' and not exists(select 1 from public.job_sources js where js.source_id=ss.id);
    delete from public.job_events where job_id=any(expired_jobs);
    update public.jobs set input='{}',state='{}' where id=any(expired_jobs);
    delete from public.rate_limit_buckets where expires_at<now();
    delete from public.demo_sessions s where expires_at<now()-interval '30 days' and not exists(select 1 from public.jobs j where j.session_id=s.id);
  end if;
  return jsonb_build_object('ok',true,'dry_run',p_dry_run,'cache_payloads',caches,'jobs',jobs_count,'sources',sources_count,'rate_limits',rates);
end $$;

-- Internal helper: caller must already hold the job row lock. It never refunds dispatches.
create function public.release_undispatched_attempt(p_attempt_id uuid, p_reason text) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare a public.provider_attempts; r record;
begin
  select * into a from public.provider_attempts where id=p_attempt_id for update;
  if not found or a.status<>'reserved_not_dispatched' or a.dispatch_started_at is not null then return; end if;
  if a.cache_key is not null then
    perform 1 from public.provider_cache where cache_key=a.cache_key for update;
  end if;
  perform 1 from public.budget_buckets where id in
    (select bucket_id from public.attempt_budget_reservations where attempt_id=a.id and released_at is null)
    order by id for update;
  for r in select * from public.attempt_budget_reservations where attempt_id=a.id and released_at is null order by bucket_id loop
    update public.budget_buckets set reserved_units=reserved_units-r.units,updated_at=now() where id=r.bucket_id;
    update public.attempt_budget_reservations set released_at=now(),release_reason=p_reason
      where attempt_id=a.id and bucket_id=r.bucket_id;
  end loop;
  update public.jobs set serp_reserved=serp_reserved-case when a.provider='serpapi' then 1 else 0 end,
    llm_reserved=llm_reserved-case when a.provider='gemini' then 1 else 0 end where id=a.job_id;
  update public.provider_attempts set status='released',finished_at=now(),error_code=p_reason where id=a.id;
  update public.provider_cache set lease_token=null,lease_until=null,attempt_id=null
    where cache_key=a.cache_key and attempt_id=a.id;
  insert into public.job_events(job_id,event_type,payload) values(a.job_id,'reservation_released',jsonb_build_object('attempt_id',a.id,'reason',p_reason));
end $$;

create function public.claim_step(p_session_id uuid,p_job_id uuid,p_expected_version integer) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; a public.provider_attempts; token uuid := gen_random_uuid(); ambiguous boolean := false;
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
  if j.step_count>=20 or j.active_milliseconds>=300000 then
    update public.jobs set phase='partial',stop_reason='time_limit',state_version=state_version+1,
      lease_token=null,lease_until=null,finished_at=now(),updated_at=now() where id=j.id returning * into j;
    return jsonb_build_object('ok',false,'code','terminal','job',to_jsonb(j));
  end if;
  update public.jobs set lease_token=token,lease_until=now()+interval '75 seconds',next_retry_at=null,
    cached_action_key=null,step_count=step_count+1,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('ok',true,'lease_token',token,'state_version',j.state_version,'job',to_jsonb(j));
end $$;

create function public.reserve_provider_attempt(p_job_id uuid,p_lease_token uuid,p_action_key text,p_provider text,
  p_cache_key text,p_params jsonb,p_engine text,p_ttl_seconds integer) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; c public.provider_cache; a public.provider_attempts; prior public.provider_attempts;
  keys text[]; b public.budget_buckets; attempt_no integer; token uuid := gen_random_uuid(); global_key text;
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
  if (p_provider='serpapi' and j.serp_reserved>=j.serp_cap) or (p_provider='gemini' and j.llm_reserved>=j.llm_cap) then
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
        coalesce((select (metadata->>'session_limit')::integer from public.budget_buckets where id='global:serpapi'),12) else 24 end,true) on conflict do nothing;
    elsif global_key like 'day:%' then
      insert into public.budget_buckets(id,limit_units,enabled) values(global_key,case when p_provider='serpapi' then
        coalesce((select (metadata->>'daily_limit')::integer from public.budget_buckets where id='global:serpapi'),30) else 120 end,true) on conflict do nothing;
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
  insert into public.provider_attempts(job_id,lease_token,action_key,attempt_number,provider,cache_key,status,request_params)
    values(j.id,p_lease_token,p_action_key,attempt_no,p_provider,p_cache_key,'reserved_not_dispatched',p_params) returning * into a;
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

create function public.mark_dispatch(p_attempt_id uuid,p_lease_token uuid) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare j public.jobs; a public.provider_attempts;
begin
  select j0.* into j from public.jobs j0 join public.provider_attempts a0 on a0.job_id=j0.id where a0.id=p_attempt_id for update of j0;
  select * into a from public.provider_attempts where id=p_attempt_id for update;
  if j.id is null or j.lease_token is distinct from p_lease_token or j.lease_until<=now() or j.phase in ('complete','partial','cancelled')
    or a.lease_token<>p_lease_token or a.status<>'reserved_not_dispatched' then
    return jsonb_build_object('ok',false,'code','stale_lease');
  end if;
  if not exists(select 1 from public.demo_sessions where id=j.session_id and expires_at>now() and revoked_at is null) then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- The kill switch is checked again immediately before dispatch.
  if not exists(select 1 from public.budget_buckets where id='global:'||a.provider and enabled) then
    perform public.release_undispatched_attempt(a.id,'search_disabled_before_dispatch');
    return jsonb_build_object('ok',false,'code','search_disabled');
  end if;
  update public.provider_attempts set status='dispatched',dispatch_started_at=now() where id=a.id;
  insert into public.job_events(job_id,event_type,payload) values(j.id,'dispatch_started',jsonb_build_object('attempt_id',a.id));
  return jsonb_build_object('ok',true,'attempt_id',a.id);
end $$;

-- Apply after ALL function definitions: no client can execute any workflow or helper RPC.
create function public.configure_limits(p_serp_daily integer,p_serp_session integer default 12) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
begin
  if p_serp_daily not between 0 and 1000 or p_serp_session not between 0 and 1000 then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  -- Budget-only transaction never takes a job/cache lock. Use the same sorted key order.
  perform 1 from public.budget_buckets where id='global:serpapi' or id like 'day:%:serpapi' or id like 'session:%:serpapi' order by id for update;
  update public.budget_buckets set metadata=metadata||jsonb_build_object('daily_limit',p_serp_daily,'session_limit',p_serp_session),updated_at=now()
    where id='global:serpapi';
  update public.budget_buckets set limit_units=greatest(reserved_units,least(limit_units,p_serp_daily)),updated_at=now() where id like 'day:%:serpapi';
  update public.budget_buckets set limit_units=greatest(reserved_units,least(limit_units,p_serp_session)),updated_at=now() where id like 'session:%:serpapi';
  insert into public.job_events(event_type,payload) values('limits_configured',jsonb_build_object('daily_limit',p_serp_daily,'session_limit',p_serp_session));
  return jsonb_build_object('ok',true,'daily_limit',p_serp_daily,'session_limit',p_serp_session);
end $$;

create function public.preflight_status() returns jsonb
language plpgsql stable set search_path = pg_catalog, public as $$
declare b public.budget_buckets; rls_ok boolean; grants_ok boolean; rpc_count integer;
begin
  select * into b from public.budget_buckets where id='global:serpapi';
  select count(*)=13 and bool_and(c.relrowsecurity) into rls_ok from pg_class c
    where c.relnamespace='public'::regnamespace and c.relname in ('demo_sessions','venues','jobs','budget_buckets','provider_attempts',
      'attempt_budget_reservations','provider_cache','source_snapshots','job_sources','evidence_claims','assessments','job_events','rate_limit_buckets');
  select count(*),bool_and(not p.prosecdef and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')) into rpc_count,grants_ok from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('create_job','claim_step','reserve_provider_attempt','mark_dispatch',
      'commit_step','fail_step','cancel_job','save_assessment','consume_rate_limit','reconcile_budget','retention_cleanup','configure_limits','preflight_status','reconcile_expired_cache');
  return jsonb_build_object('ok',coalesce(rls_ok and grants_ok and rpc_count=14,false),'migration','003','rpcVersion','1',
    'rlsEnabled',rls_ok,'privateGrants',grants_ok,'searchEnabled',coalesce(b.enabled,false),'limitUnits',b.limit_units,'reservedUnits',b.reserved_units);
end $$;

create function public.reconcile_expired_cache(p_cache_key text) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare hint public.provider_cache; c public.provider_cache; a public.provider_attempts; j public.jobs;
begin
  -- Inspect without locking to find the owner, then take locks in job/cache/budget order.
  select * into hint from public.provider_cache where cache_key=p_cache_key;
  if not found or hint.attempt_id is null then return jsonb_build_object('ok',true,'kind','nothing_to_reconcile'); end if;
  select * into a from public.provider_attempts where id=hint.attempt_id;
  select * into j from public.jobs where id=a.job_id for update;
  select * into c from public.provider_cache where cache_key=p_cache_key for update;
  if c.attempt_id is distinct from hint.attempt_id then return jsonb_build_object('ok',false,'code','busy'); end if;
  if c.lease_until>now() or j.lease_until>now() then return jsonb_build_object('ok',false,'code','busy'); end if;
  select * into a from public.provider_attempts where id=c.attempt_id for update;
  if a.status='reserved_not_dispatched' then
    perform public.release_undispatched_attempt(a.id,'abandoned_cache_before_dispatch');
    update public.jobs set lease_token=null,lease_until=null,state_version=state_version+1,updated_at=now() where id=j.id;
    return jsonb_build_object('ok',true,'kind','released');
  elsif a.status='dispatched' then
    update public.provider_attempts set status='uncertain',finished_at=now(),error_code='abandoned_cache_after_dispatch' where id=a.id;
    update public.provider_cache set lease_token=null,lease_until=null where cache_key=c.cache_key;
    update public.jobs set phase='partial',stop_reason='ambiguous_dispatch',lease_token=null,lease_until=null,
      state_version=state_version+1,failed_stages=array_append(failed_stages,j.phase),finished_at=now(),updated_at=now() where id=j.id;
    insert into public.job_events(job_id,event_type) values(j.id,'ambiguous_dispatch');
    return jsonb_build_object('ok',true,'kind','uncertain');
  end if;
  return jsonb_build_object('ok',true,'kind',a.status);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_job','release_undispatched_attempt','claim_step',
      'reserve_provider_attempt','mark_dispatch','insert_assessment_revision','commit_step','fail_step','cancel_job',
      'save_assessment','consume_rate_limit','reconcile_budget','retention_cleanup','configure_limits','preflight_status','reconcile_expired_cache') loop
    execute format('revoke execute on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
