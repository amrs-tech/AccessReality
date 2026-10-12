-- Explicit, supplementary before-you-go news checks. Existing visit briefs are
-- never modified; the private auxiliary job reuses the same atomic workflow.
do $$
declare c record;
begin
  -- Remove only the two historical checks involving kind. Preserve every lease,
  -- corpus, provider and budget bound, including the expanded investigation cap.
  for c in select conname from pg_constraint
    where conrelid='public.jobs'::regclass and contype='c'
      and pg_get_constraintdef(oid) ~ '\mkind\M' loop
    execute format('alter table public.jobs drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.jobs add constraint jobs_kind_check
  check (kind in ('discovery','investigation','news_check'));
alter table public.jobs add constraint jobs_kind_budget_check check (
  (kind='discovery' and serp_cap<=1 and llm_cap=0)
  or kind='investigation'
  or (kind='news_check' and serp_cap=2 and serp_full_cap=2 and llm_cap=0 and step_cap=4
    and search_mode='legacy' and phase in ('targeted_search','complete','partial','cancelled'))
);
create index jobs_owned_news_parent_latest on public.jobs
  (session_id,(input->>'parentJobId'),created_at desc) where kind='news_check';

-- Generic create_job remains restricted to discovery/investigation. Only this
-- RPC creates a news check, from an owned saved brief and its discovery locality.
create function public.create_news_check(p_session_id uuid,p_parent_job_id uuid,
  p_key text,p_hash text,p_allocation text) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare parent public.jobs; j public.jobs; saved_report jsonb; copied_venue jsonb;
  discovery_id uuid; city text; brief_generated_at text; initial_state jsonb; created boolean;
begin
  if not exists(select 1 from public.demo_sessions where id=p_session_id
    and expires_at>now() and revoked_at is null) then
    return jsonb_build_object('ok',false,'code','not_found');
  end if;
  if p_key is null or length(p_key) not between 16 and 100
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or p_allocation is null or p_allocation not in ('verification','operations') then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  -- The fixed parent-first order serializes same-parent creation and leaves the
  -- parent's state, source corpus and immutable assessment revisions untouched.
  select * into parent from public.jobs where id=p_parent_job_id and session_id=p_session_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if parent.kind<>'investigation' or parent.phase not in ('complete','partial')
    or parent.venue_id is null then return jsonb_build_object('ok',false,'code','invalid_input'); end if;
  copied_venue:=parent.state->'venue';
  if jsonb_typeof(copied_venue) is distinct from 'object'
    or copied_venue->>'id' is distinct from parent.venue_id::text
    or jsonb_typeof(copied_venue->'name') is distinct from 'string'
    or length(trim(copied_venue->>'name')) not between 1 and 240 then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  select a.report into saved_report from public.assessments a
    where a.job_id=parent.id order by a.revision desc limit 1;
  brief_generated_at:=saved_report->>'generatedAt';
  if saved_report is null or jsonb_typeof(saved_report) is distinct from 'object'
    or jsonb_typeof(saved_report->'generatedAt') is distinct from 'string'
    or length(brief_generated_at) not between 1 and 100 then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  begin
    discovery_id:=(parent.input->>'discoveryJobId')::uuid;
    perform brief_generated_at::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end;
  select d.input->>'city' into city from public.jobs d where d.id=discovery_id
    and d.session_id=p_session_id and d.kind='discovery' and d.phase='complete'
    and jsonb_typeof(d.input->'city')='string';
  if city is null or length(trim(city)) not between 2 and 80 then
    return jsonb_build_object('ok',false,'code','invalid_input');
  end if;
  city:=trim(city);
  select * into j from public.jobs where session_id=p_session_id and idempotency_key=p_key for update;
  if found then
    if j.request_hash<>p_hash or j.kind<>'news_check'
      or j.input->>'parentJobId' is distinct from parent.id::text then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return jsonb_build_object('ok',true,'created',false,'job',to_jsonb(j));
  end if;
  initial_state:=jsonb_build_object('venue',copied_venue,'candidates','[]'::jsonb,'requirements','[]'::jsonb,
    'sources','[]'::jsonb,'claims','[]'::jsonb,'report',null,'visitedActionKeys','[]'::jsonb,
    'extractedSourceIds','[]'::jsonb,'cacheHits',0,'reviewsExamined',0,'failedStages','[]'::jsonb,
    'steps',0,'activeMs',0,'targetedActions',0,'noNewEvidence',0,'acceptedBeforeTarget',0,
    'reviewRequests',0,'webRequests',0,'retryCounts','{}'::jsonb,'pendingAction',null,
    'lastActionKey',null,'extractionBatches',0,'plannerMode',null);
  insert into public.jobs(session_id,idempotency_key,request_hash,kind,venue_id,input,phase,state,
    serp_cap,llm_cap,serp_full_cap,search_mode,step_cap)
  values(p_session_id,p_key,p_hash,'news_check',parent.venue_id,
    jsonb_build_object('parentJobId',parent.id,'city',city,'briefGeneratedAt',brief_generated_at,'_allocation',p_allocation),
    'targeted_search',initial_state,2,0,2,'legacy',4)
  on conflict(session_id,idempotency_key) do nothing returning * into j;
  created:=found;
  if not created then
    select * into j from public.jobs where session_id=p_session_id and idempotency_key=p_key;
    if j.request_hash<>p_hash or j.kind<>'news_check'
      or j.input->>'parentJobId' is distinct from parent.id::text then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
  else
    insert into public.job_events(job_id,event_type,payload) values(j.id,'created',
      jsonb_build_object('message','A separate before-you-go news check is ready.'));
  end if;
  return jsonb_build_object('ok',true,'created',created,'job',to_jsonb(j));
end $$;

create or replace function public.preflight_status() returns jsonb
language plpgsql stable set search_path=pg_catalog,public as $$
declare b public.budget_buckets; llm public.budget_buckets; rls_ok boolean; grants_ok boolean; rpc_count integer;
begin
  select * into b from public.budget_buckets where id='global:serpapi';
  select * into llm from public.budget_buckets where id='global:gemini';
  select count(*)=13 and bool_and(c.relrowsecurity) into rls_ok from pg_class c
    where c.relnamespace='public'::regnamespace and c.relname in ('demo_sessions','venues','jobs','budget_buckets','provider_attempts',
      'attempt_budget_reservations','provider_cache','source_snapshots','job_sources','evidence_claims','assessments','job_events','rate_limit_buckets');
  select count(*),bool_and(not p.prosecdef and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')) into rpc_count,grants_ok from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('create_job','create_news_check','claim_step','reserve_provider_attempt','mark_dispatch',
      'commit_step','fail_step','cancel_job','save_assessment','consume_rate_limit','reconcile_budget','retention_cleanup','configure_limits',
      'preflight_status','reconcile_expired_cache','configure_llm_budget','current_search_policy','begin_serpapi_balance_check','reconcile_serpapi_balance');
  return jsonb_build_object('ok',coalesce(rls_ok and grants_ok and rpc_count=19,false),'migration','007','rpcVersion','4',
    'rlsEnabled',rls_ok,'privateGrants',grants_ok,'searchEnabled',coalesce(b.enabled,false),'limitUnits',b.limit_units,'reservedUnits',b.reserved_units,
    'llmBudgetSource','owner_attempt_cap','llmLimitUnits',llm.limit_units,'llmReservedUnits',llm.reserved_units,'searchPolicy',public.current_search_policy());
end $$;
revoke execute on function public.create_news_check(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_news_check(uuid,uuid,text,text,text) to service_role;
revoke execute on function public.preflight_status() from public,anon,authenticated;
grant execute on function public.preflight_status() to service_role;
notify pgrst,'reload schema';
