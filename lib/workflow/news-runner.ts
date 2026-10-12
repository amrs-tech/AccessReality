import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobRow } from './state';
import { db,rpc,selectOne } from '../server/db';
import { requireRpc } from '../server/jobs';
import { env } from '../server/env';
import { AppError } from '../server/errors';
import { hash,stable } from '../server/crypto';
import { serpapiSearch } from '../providers/serpapi';
import { ProviderError } from '../providers/errors';
import { STEP_PROVIDER_DEADLINE_MS } from '../providers/deadlines';
import { newsParams,normalizeNews } from '../news/normalize';

interface NewsDependencies {client?:SupabaseClient;search?:typeof serpapiSearch;refreshCredits?:()=>Promise<unknown>;requestId?:string}
const actionKey='CHECK_VISIT_NEWS';
export async function advanceNewsCheck(sessionId:string,checkId:string,version:number,deps:NewsDependencies={}):Promise<JobRow>{
  const client=deps.client||db(),e=env(),started=Date.now();
  if(deps.refreshCredits)await deps.refreshCredits();
  const held=await rpc('claim_step',{p_session_id:sessionId,p_job_id:checkId,p_expected_version:version},client);
  if(!held.ok){if(['terminal','ambiguous_dispatch'].includes(held.code)&&held.job)return held.job;requireRpc(held);}
  const job=held.job as JobRow;const leaseStarted=Date.now();const state=structuredClone(job.state);
  let attemptId:string|null=null,dispatched=false;
  try{
    if(job.kind!=='news_check'||!state.venue||typeof job.input.city!=='string')throw new AppError('invalid_request',400);
    state.steps=(state.steps||0)+1;state.newsErrorCode=null;state.lastActionKey=actionKey;
    const params=newsParams(state.venue,job.input.city);
    const key=hash(stable({params,version:'visit-watch-news-v1'}));
    if(e.SEARCH_ENABLED!=='true'){
      const cached=await selectOne('provider_cache',{cache_key:key},client);
      if(!cached?.sanitized_payload||Date.parse(cached.expires_at)<=Date.now())throw new AppError('search_disabled',503);
    }
    const reservation=await rpc('reserve_provider_attempt',{p_job_id:job.id,p_lease_token:held.lease_token,p_action_key:actionKey,p_provider:'serpapi',p_cache_key:key,p_params:{...params,adapter_version:'visit-watch-news-v1'},p_engine:'google_news',p_ttl_seconds:3600},client);
    if(reservation.needs_reconciliation)await rpc('reconcile_expired_cache',{p_cache_key:key},client);
    requireRpc(reservation);
    let payload:Record<string,unknown>|null=null,raw:Record<string,unknown>,retrievedAt:string,providerId:string|null;
    if(reservation.kind==='cache'){
      state.cacheHits=(state.cacheHits||0)+1;raw=reservation.payload;retrievedAt=reservation.retrieved_at;providerId=(raw.search_metadata as any)?.id||null;
    }else{
      attemptId=reservation.attempt_id;if(e.SEARCH_ENABLED!=='true')throw new AppError('search_disabled',503);
      if(Date.now()-started>18000)throw new AppError('deadline_before_dispatch',503);
      requireRpc(await rpc('mark_dispatch',{p_attempt_id:attemptId,p_lease_token:held.lease_token},client));dispatched=true;
      const response=await (deps.search||serpapiSearch)(params,{apiKey:e.SERPAPI_API_KEY,timeoutMs:Math.max(1,STEP_PROVIDER_DEADLINE_MS-(Date.now()-started))});
      raw=response.payload;retrievedAt=response.retrievedAt;providerId=response.providerSearchId;payload={...raw,__retrievedAt:retrievedAt};
      console.info(JSON.stringify({requestId:deps.requestId,jobId:job.id,attemptId,engine:'google_news',status:'success',providerSearchId:providerId,durationMs:response.durationMs}));
    }
    state.newsResult=normalizeNews(raw,state.venue,job.input.city,retrievedAt,providerId,job.input.briefGeneratedAt||null);
    state.newsErrorCode=null;state.visitedActionKeys=[...(state.visitedActionKeys||[]),actionKey];state.activeMs=(state.activeMs||0)+Date.now()-started;
    const saved=requireRpc(await rpc('commit_step',{p_job_id:job.id,p_lease_token:held.lease_token,p_expected_version:version,p_phase:'complete',p_state:state,p_attempt_id:attemptId,p_payload:payload,p_sources:[],p_claims:[],p_report:null,p_stop_reason:'no_eligible_actions',p_cache_ttl:3600},client));
    return saved.job;
  }catch(error){
    const provider=error instanceof ProviderError?error:null;const code=provider?.code||(error instanceof AppError?error.code:'upstream_unavailable');
    const prior=state.retryCounts?.[actionKey]||0;
    const retry=code==='busy'||Boolean(provider?.retryable&&!provider.uncertain&&prior<1&&job.serp_reserved<job.serp_cap);
    state.newsErrorCode=code;if(code!=='busy')state.retryCounts={...(state.retryCounts||{}),[actionKey]:prior+1};
    state.activeMs=(state.activeMs||0)+Date.now()-started;
    const serverLeaseUntil=Date.parse((job as any).lease_until||'');
    const databaseNow=Number.isFinite(serverLeaseUntil)?serverLeaseUntil-75000+(Date.now()-leaseStarted):Date.now();
    const retryAt=retry?new Date(databaseNow+Math.max(2000,(provider?.retryAfterSeconds||2)*1000)).toISOString():null;
    const ambiguous=dispatched&&Boolean(provider?.uncertain||!provider);
    console.error(JSON.stringify({requestId:deps.requestId,jobId:job.id,attemptId,errorCode:code,uncertain:ambiguous}));
    const failed=requireRpc(await rpc('fail_step',{p_job_id:job.id,p_lease_token:held.lease_token,p_expected_version:version,p_attempt_id:attemptId,p_code:code,p_uncertain:ambiguous,p_retry_at:retryAt,p_phase:retry?'targeted_search':'partial',p_state:state},client));
    return failed.job;
  }
}
