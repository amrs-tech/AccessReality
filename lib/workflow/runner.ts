import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Feature,Source,EvidenceClaim,Report } from '../contracts';
import { db,rpc,selectOne } from '../server/db';
import { env } from '../server/env';
import { AppError } from '../server/errors';
import { requireRpc } from '../server/jobs';
import { hash,stable } from '../server/crypto';
import { discoveryParams,normalizeDiscovery } from '../adapters/maps';
import { detailsParams,normalizeDetails } from '../adapters/place';
import { reviewsParams,normalizeReviews } from '../adapters/reviews';
import { normalizeWeb } from '../adapters/web';
import { serpapiSearch,type SerpApiResult } from '../providers/serpapi';
import { ProviderError } from '../providers/errors';
import { extractClaims,chooseAction } from '../providers/gemini';
import { validateExtractedClaims,EXTRACTOR_VERSION } from '../evidence/validate';
import { claimIdentityId } from '../evidence/identity';
import { dedupeSources,immutableTextBatches } from '../evidence/normalize';
import { buildReport as assess } from '../assessment';
import { evidenceMenu,stopAction,targetedSearchParams,type AllowedAction } from './actions';
import { cacheKey,cacheTtl,ADAPTER_VERSION } from './cache';
import { type JobRow,type JobState } from './state';

export interface RunnerDependencies {client?:SupabaseClient;search?:typeof serpapiSearch;extract?:typeof extractClaims;plan?:typeof chooseAction;clock?:()=>Date;requestId?:string;refreshCredits?:()=>Promise<unknown>}
const acceptedCount=(s:JobState)=>s.claims.filter(c=>c.extractionStatus==='accepted').length;
export function buildReport(job:JobRow,asOf:Date):Report {
  if(!job.state.venue)throw new AppError('invalid_request',400);
  return assess({venue:job.state.venue,requirements:job.state.requirements,sources:job.state.sources,claims:job.state.claims,asOf:asOf.toISOString(),isPartial:job.state.failedStages.length>0||job.phase==='partial',limitations:job.state.failedStages.map(f=>`Stage unavailable or incomplete: ${f}.`),reviewsExamined:job.state.reviewsExamined});
}
interface MenuAction {id:string;feature:Feature;reason:string;kind:'reviews'|'web'}
export function eligibleMenu(job:JobRow,cacheCandidates=false):MenuAction[] {
  const s=job.state;const report=s.report;if(!report||!s.venue)return [];
  if(job.llm_reserved>=job.llm_cap)return [];
  return evidenceMenu({venue:s.venue,assessments:report.requirements,visitedActionKeys:s.visitedActionKeys,
    expanded:job.search_mode==='expanded'||(cacheCandidates&&(job.serp_full_cap??job.serp_cap)>5),balanced:!cacheCandidates,
    reviewRequests:s.reviewRequests,webRequests:s.webRequests,noNewEvidence:s.noNewEvidence})
    .map(action=>({id:action.id,feature:action.feature!,reason:action.reason,kind:action.kind==='SEARCH_REVIEWS_FEATURE'?'reviews':'web'}));
}
export async function advanceJob(sessionId:string,jobId:string,version:number,deps:RunnerDependencies={}):Promise<JobRow> {
  const client=deps.client||db();const e=env();const now=deps.clock||(()=>new Date());const started=Date.now();
  if(deps.refreshCredits)await deps.refreshCredits();
  const lease=await rpc('claim_step',{p_session_id:sessionId,p_job_id:jobId,p_expected_version:version},client);
  if(!lease.ok){if(['terminal','ambiguous_dispatch'].includes(lease.code)&&lease.job)return lease.job;requireRpc(lease);}
  const job=lease.job as JobRow;const s=structuredClone(job.state);let phase:JobRow['phase']=job.phase;let stopReason:string|null=null;
  let attemptId:string|null=null,dispatched=false,payload:Record<string,unknown>|null=null,ttl=0;
  let newSources:Source[]=[],newClaims:EvidenceClaim[]=[];let report:Report|null=null;
  const flagCorpusLimit=()=>{if(!s.failedStages.includes('corpus_limit'))s.failedStages.push('corpus_limit');};
  const expandedCorpus=(job.serp_full_cap??job.serp_cap)>5;
  const corpusBounds=expandedCorpus?{sources:160,text:128000,claims:192,quotes:48000}:{sources:60,text:48000,claims:96,quotes:24000};
  const outstandingSources=()=>s.sources.filter(source=>source.kind!=='maps_attribute'&&source.text.trim().length>0&&source.metadata.venueMatch==='exact'&&!s.extractedSourceIds.includes(source.id));
  const boundPhotos=()=>{
    let photoRoom=24;
    if(s.venue?.images){s.venue.images=s.venue.images.slice(0,Math.min(4,photoRoom));photoRoom-=s.venue.images.length;}
    s.sources=s.sources.map(source=>{if(!source.images?.length)return source;const images=source.images.slice(0,Math.min(2,photoRoom));photoRoom-=images.length;return {...source,images};});
  };
  const allowedMenu=async():Promise<MenuAction[]>=>{
    const menu=eligibleMenu({...job,state:s},job.serp_reserved>=job.serp_cap);
    if(job.serp_reserved<job.serp_cap)return menu;
    const cached=await Promise.all(menu.map(async action=>{
      const value=await selectOne('provider_cache',{cache_key:cacheKey(targetedSearchParams(s.venue!,action.id,action.feature))},client);
      return value?.sanitized_payload&&Date.parse(value.expires_at)>now().getTime()?action:null;
    }));
    return cached.filter((action):action is MenuAction=>action!==null);
  };
  let actionKey='';
  const reserve=async(provider:'serpapi'|'gemini',params:Record<string,string>,key:string,cache:string|null=null)=>{
    actionKey=key;s.lastActionKey=key;
    if(provider==='serpapi'&&e.SEARCH_ENABLED!=='true') {
      const cached=cache?await selectOne('provider_cache',{cache_key:cache},client):null;
      if(!cached?.sanitized_payload||Date.parse(cached.expires_at)<=now().getTime())throw new AppError('search_disabled',503);
    }
    const reservation=await rpc('reserve_provider_attempt',{p_job_id:job.id,p_lease_token:lease.lease_token,p_action_key:key,p_provider:provider,p_cache_key:cache,p_params:{...params,adapter_version:ADAPTER_VERSION},p_engine:params.engine||'gemini',p_ttl_seconds:ttl},client);
    if(reservation.needs_reconciliation&&cache)await rpc('reconcile_expired_cache',{p_cache_key:cache},client);
    requireRpc(reservation);
    if(reservation.kind==='cache'){s.cacheHits++;return reservation;}
    attemptId=reservation.attempt_id;
    if(provider==='serpapi'&&e.SEARCH_ENABLED!=='true')throw new AppError('search_disabled',503);
    if(Date.now()-started>18000)throw new AppError('deadline_before_dispatch',503);
    requireRpc(await rpc('mark_dispatch',{p_attempt_id:attemptId,p_lease_token:lease.lease_token},client));dispatched=true;
    return reservation;
  };
  const search=async(params:Record<string,string>,key:string):Promise<SerpApiResult>=>{
    ttl=cacheTtl(key);const reservation=await reserve('serpapi',params,key,cacheKey(params));
    if(params.engine==='google_maps_reviews')s.reviewRequests++;
    if(params.engine==='google')s.webRequests++;
    if(reservation.kind==='cache')return {payload:reservation.payload,retrievedAt:reservation.retrieved_at,providerSearchId:reservation.payload.search_metadata?.id||null,durationMs:0};
    const result=await (deps.search||serpapiSearch)(params,{apiKey:e.SERPAPI_API_KEY,timeoutMs:Math.max(1,Math.min(25000,35000-(Date.now()-started)))});payload={...result.payload,__retrievedAt:result.retrievedAt};
    console.info(JSON.stringify({requestId:deps.requestId,jobId:job.id,attemptId,engine:params.engine,status:'success',durationMs:result.durationMs,providerSearchId:result.providerSearchId}));
    return result;
  };
  try {
    s.steps++;s.lastMessage='';boundPhotos();
    if(phase!=='finalize'&&(s.steps>=Math.min(job.step_cap??20,e.MAX_WORKFLOW_STEPS)||s.activeMs>=300000)) {
      stopReason='time_limit';
      if(job.kind==='discovery')phase='partial';
      else {
        if(outstandingSources().length&&!s.failedStages.includes('unprocessed_sources_workflow_limit'))s.failedStages.push('unprocessed_sources_workflow_limit');
        if(['details','reviews'].includes(job.phase))s.failedStages.push(`${job.phase}:workflow_limit`);
        report=buildReport({...job,state:s},now());s.report=report;phase=report.isPartial?'partial':'complete';
        s.lastMessage='The bounded investigation finished; the visit brief is saved from the available evidence.';
      }
    }
    else if(job.kind==='discovery') {
      const result=await search(discoveryParams(job.input.query,job.input.city),'DISCOVER');s.candidates=normalizeDiscovery(result.payload);phase='complete';s.lastMessage=`Found ${s.candidates.length} venue candidates; none has been assessed.`;
    } else if(phase==='details') {
      const result=await search(detailsParams(s.venue!),'FETCH_DETAILS');const normalized=normalizeDetails(result.payload,s.venue!,result.retrievedAt,result.providerSearchId);
      s.venue=normalized.venue;newSources=normalized.sources;newClaims=normalized.claims;phase='reviews';s.lastMessage='Read explicitly present venue listing attributes; absent facilities remain unknown.';
    } else if(phase==='reviews') {
      if(!s.venue?.dataId&&!s.venue?.googlePlaceId){s.failedStages.push('reviews_missing_identifier');phase='extract';}
      else if(s.reviewRequests>=2){s.failedStages.push('reviews_attempt_cap');phase='extract';}
      else {const result=await search(reviewsParams(s.venue),'FETCH_NEWEST_REVIEWS');const normalized=normalizeReviews(result.payload,s.venue,result.retrievedAt,result.providerSearchId);newSources=normalized.sources;s.reviewsExamined+=normalized.reviewsExamined;phase='extract';s.lastMessage=`Examined ${normalized.reviewsExamined} newest reviews. This is a small sample.`;}
    } else if(phase==='targeted_search') {
      const action=s.pendingAction;if(!action)throw new AppError('invalid_request',400);
      s.acceptedBeforeTarget=acceptedCount(s);s.targetedActions++;
      const feature=action.feature as Feature;
      if(action.id.startsWith('SEARCH_REVIEWS_FEATURE')) {
        const result=await search(targetedSearchParams(s.venue!,action.id,feature),action.id);const normalized=normalizeReviews(result.payload,s.venue!,result.retrievedAt,result.providerSearchId,true);newSources=normalized.sources;s.reviewsExamined+=normalized.reviewsExamined;
      } else {const result=await search(targetedSearchParams(s.venue!,action.id,feature),action.id);newSources=normalizeWeb(result.payload,s.venue!,result.retrievedAt,result.providerSearchId);}
      phase='extract';s.lastMessage=action.reason;s.pendingAction=null;
    } else if(phase==='extract') {
      const outstanding=outstandingSources();const batch=immutableTextBatches(outstanding)[0];
      if(!batch?.length){phase='assess';}
      else if(job.llm_reserved>=job.llm_cap){s.failedStages.push('unprocessed_sources_llm_cap');phase='finalize';stopReason='llm_budget_exhausted';}
      else {
        const key=`EXTRACT:${hash(stable(batch.map(x=>x.id)))}`;await reserve('gemini',{model:e.GEMINI_MODEL},key);
        const extracted=await (deps.extract||extractClaims)(batch,s.venue!,{apiKey:e.GEMINI_API_KEY,model:e.GEMINI_MODEL,timeoutMs:Math.min(25000,45000-(Date.now()-started))});
        const validated=validateExtractedClaims(extracted.claims,batch,s.venue!.id,now().toISOString());newClaims=validated.accepted;
        if(validated.rejected.length){s.failedStages.push('extraction_validation_rejected');s.validationRejections=[...(s.validationRejections||[]),...validated.rejected.map(r=>({reason:r.reason,sourceId:typeof (r.candidate as any)?.sourceId==='string'?(r.candidate as any).sourceId:null}))].slice(0,64);}
        s.extractedSourceIds.push(...batch.map(x=>x.id));s.extractionBatches++;phase=outstanding.length>batch.length?'extract':'assess';
        s.lastMessage=`Validated ${newClaims.filter(c=>c.extractionStatus==='accepted').length} observations against the immutable source text.`;
      }
    } else if(phase==='assess') {
      report=buildReport({...job,state:s},now());s.report=report;
      if(s.targetedActions){s.noNewEvidence=acceptedCount(s)>s.acceptedBeforeTarget?0:s.noNewEvidence+1;}
      const menu=await allowedMenu();
      if(report.overall==='evidence_supports_requirements'){phase='finalize';stopReason='evidence_sufficient';}
      else if(!menu.length){phase='finalize';stopReason=job.serp_reserved>=job.serp_cap?'search_budget_exhausted':job.llm_reserved>=job.llm_cap?'llm_budget_exhausted':job.search_mode!=='expanded'&&s.noNewEvidence>=2?'no_new_evidence':'no_eligible_actions';}
      else phase='plan';s.lastMessage='Applied the deterministic requirement and freshness rules to this saved corpus.';
    } else if(phase==='plan') {
      const menu=await allowedMenu();
      if(!menu.length){phase='finalize';stopReason='no_eligible_actions';}
      else if(job.llm_cap-job.llm_reserved<2||job.serp_reserved>=job.serp_cap){s.plannerMode='deterministic_fallback';s.pendingAction=menu[0];phase='targeted_search';s.lastMessage=menu[0].reason;}
      else {
        await reserve('gemini',{model:e.GEMINI_MODEL},`PLAN:${s.targetedActions}`);
        const actions:AllowedAction[]=[...menu.map(a=>({id:a.id,kind:a.kind==='reviews'?'SEARCH_REVIEWS_FEATURE' as const:'SEARCH_WEB_FEATURE' as const,feature:a.feature,params:{},key:a.id,reason:a.reason})),stopAction()];
        const chosen=await (deps.plan||chooseAction)(actions,{states:s.report!.requirements.map(r=>({feature:r.feature,status:r.status})),excerpts:s.sources.slice(-5).map(x=>x.text),priorResults:s.visitedActionKeys,remainingSearchAttempts:job.serp_cap-job.serp_reserved},{apiKey:e.GEMINI_API_KEY,model:e.GEMINI_MODEL,timeoutMs:Math.min(25000,45000-(Date.now()-started))});
        if(chosen.action.id==='STOP'&&job.search_mode==='expanded'){s.plannerMode='deterministic_fallback';s.pendingAction=menu[0];phase='targeted_search';s.lastMessage=menu[0].reason;}
        else if(chosen.action.id==='STOP'){phase='finalize';stopReason='no_eligible_actions';}
        else {const selected=menu.find(a=>a.id===chosen.action.id);if(!selected)throw new ProviderError('invalid_json','Planner selected an ineligible action');s.pendingAction={...selected,reason:selected.reason};phase='targeted_search';s.plannerMode='gemini';s.lastMessage=selected.reason;}
      }
    } else if(phase==='finalize') {
      report=buildReport({...job,state:s},now());s.report=report;phase=report.isPartial?'partial':'complete';stopReason=s.failureStopReason||job.stop_reason||stopReason||'no_eligible_actions';s.lastMessage='Visit brief saved. Current venue conditions still need confirmation.';
    }
    // Reuse the exact immutable snapshots represented by a shared cache response.
    // Preserve the durable ledger's canonical IDs when reading existing cache snapshots.
    if(newSources.length) {
      const {data:existing,error}=await client.from('source_snapshots').select('id,source_group_key,text_hash,retrieved_at,metadata').eq('venue_id',s.venue!.id).in('source_group_key',newSources.map(x=>x.sourceGroupKey));
      if(error)throw new AppError('dependency_unavailable');
      const remap=new Map<string,string>();
      newSources=newSources.map(source=>{const match=existing?.find(row=>row.source_group_key===source.sourceGroupKey&&row.text_hash===hash(source.text)&&Date.parse(row.retrieved_at)===Date.parse(source.retrievedAt));if(!match)return source;remap.set(source.id,match.id);return match.metadata.original as Source;});
      newClaims=newClaims.map(claim=>canonicalClaim(claim,remap.get(claim.sourceId)||claim.sourceId));
      const reusedIds=[...new Set(remap.values())];
      if(reusedIds.length) {
        const {data:existingClaims,error:claimError}=await client.from('evidence_claims').select('metadata,extractor_version').in('source_id',reusedIds);
        if(claimError)throw new AppError('dependency_unavailable');
        const reusable=(existingClaims||[]).filter(row=>[EXTRACTOR_VERSION,'maps-accessibility-labels-v1'].includes(row.extractor_version)).map(row=>row.metadata.original as EvidenceClaim);
        newClaims=newClaims.map(claim=>reusable.find(saved=>saved.sourceId===claim.sourceId&&saved.feature===claim.feature&&saved.polarity===claim.polarity&&saved.originalQuote===claim.originalQuote&&stable(saved.scope)===stable(claim.scope))||claim);
        newClaims.push(...reusable);
        s.extractedSourceIds.push(...reusedIds.filter(id=>reusable.some(c=>c.sourceId===id)));
      }
    }
    const existingSourceGroups=new Map(s.sources.map(x=>[`${x.sourceGroupKey}:${hash(x.text)}`,x]));
    const sourceIdRemap=new Map<string,string>();for(const source of newSources){const key=`${source.sourceGroupKey}:${hash(source.text)}`;const existing=existingSourceGroups.get(key);if(existing)sourceIdRemap.set(source.id,existing.id);else existingSourceGroups.set(key,source);}
    newClaims=newClaims.map(claim=>canonicalClaim(claim,sourceIdRemap.get(claim.sourceId)||claim.sourceId));
    newSources=newSources.filter(x=>!sourceIdRemap.has(x.id));
    let textUnits=s.sources.reduce((total,source)=>total+source.text.length+(source.translatedText?.length||0),0);let sourceCount=s.sources.length;
    newSources=newSources.filter(source=>{const units=source.text.length+(source.translatedText?.length||0);if(sourceCount>=corpusBounds.sources||textUnits+units>corpusBounds.text){flagCorpusLimit();return false;}sourceCount++;textUnits+=units;return true;});
    s.sources=dedupeSources([...s.sources,...newSources]);
    // Photo references are supplementary. Keep the corpus bounded without
    // displacing validated text or claims; no image bytes enter durable state.
    boundPhotos();
    const availableSourceIds=new Set(s.sources.map(x=>x.id));newClaims=newClaims.filter(claim=>availableSourceIds.has(claim.sourceId));
    const claimIdentity=(claim:EvidenceClaim)=>stable({sourceId:claim.sourceId,feature:claim.feature,polarity:claim.polarity,quote:claim.originalQuote,scope:claim.scope,extractor:claim.extractorVersion});
    const claimUnits=(claim:EvidenceClaim)=>claim.originalQuote.length+stable(claim.scope).length;
    let quoteUnits=s.claims.reduce((total,claim)=>total+claimUnits(claim),0);let claimCount=s.claims.length;
    const claimKeys=new Set(s.claims.map(claimIdentity));newClaims=newClaims.filter(claim=>{const key=claimIdentity(claim);if(claimKeys.has(key))return false;if(claimCount>=corpusBounds.claims||quoteUnits+claimUnits(claim)>corpusBounds.quotes){flagCorpusLimit();return false;}claimKeys.add(key);claimCount++;quoteUnits+=claimUnits(claim);return true;});s.claims.push(...newClaims);
    // Full report revisions live in assessments, keeping the durable step state bounded.
    if(s.report)s.report={...s.report,sources:[],claims:[]};
    while(Buffer.byteLength(JSON.stringify(s),'utf8')>500000){
      const source=[...s.sources].reverse().find(source=>source.images?.length);
      if(source){source.images=source.images!.slice(0,-1);continue;}
      if(s.venue?.images?.length){s.venue.images=s.venue.images.slice(0,-1);continue;}
      break;
    }
    newSources=newSources.map(source=>s.sources.find(saved=>saved.id===source.id)||source);
    while(Buffer.byteLength(JSON.stringify(s),'utf8')>500000&&newClaims.length){const removed=newClaims.pop()!;s.claims=s.claims.filter(c=>c.id!==removed.id);flagCorpusLimit();}
    while(Buffer.byteLength(JSON.stringify(s),'utf8')>500000&&newSources.length){const removed=newSources.pop()!;s.sources=s.sources.filter(source=>source.id!==removed.id);s.claims=s.claims.filter(c=>c.sourceId!==removed.id);newClaims=newClaims.filter(c=>c.sourceId!==removed.id);flagCorpusLimit();}
    if(report)report={...report,venue:s.venue!,sources:report.sources.map(source=>s.sources.find(saved=>saved.id===source.id)||source)};
    if(actionKey&&!s.visitedActionKeys.includes(actionKey))s.visitedActionKeys.push(actionKey);
    s.activeMs+=Date.now()-started;
    const committed=requireRpc(await rpc('commit_step',{p_job_id:job.id,p_lease_token:lease.lease_token,p_expected_version:version,p_phase:phase,p_state:s,p_attempt_id:attemptId,p_payload:payload,p_sources:newSources,p_claims:newClaims,p_report:report?reportWrapper(report,s):null,p_stop_reason:stopReason,p_cache_ttl:ttl},client));
    return committed.job||await selectOne('jobs',{id:job.id,session_id:sessionId},client);
  } catch(error) {
    const provider=error instanceof ProviderError?error:null;const code=provider?.code||(error instanceof AppError?error.code:'upstream_unavailable');
    console.error(JSON.stringify({requestId:deps.requestId,jobId:job.id,attemptId,errorCode:code,providerMessage:provider?.message,uncertain:provider?.uncertain||false}));
    if(code==='busy'){await rpc('fail_step',{p_job_id:job.id,p_lease_token:lease.lease_token,p_expected_version:version,p_attempt_id:attemptId,p_code:code,p_uncertain:false,p_retry_at:new Date(now().getTime()+2000).toISOString(),p_phase:job.phase,p_state:s},client);throw new AppError('busy',409,true);}
    const retries=s.retryCounts[actionKey]||0;const retry=Boolean(provider?.retryable)&&!provider?.uncertain&&retries<1&&(job.search_mode==='expanded'||(!(actionKey.includes('REVIEWS')&&s.reviewRequests>=2)&&!(actionKey.includes('WEB')&&s.webRequests>=2)));
    s.retryCounts[actionKey]=retries+1;
    const optionalBudgetStop=code==='budget_exhausted'&&['targeted_search','plan'].includes(job.phase)&&!dispatched&&!outstandingSources().length;
    let nextPhase:JobRow['phase']='finalize';
    if(job.kind==='discovery')nextPhase=retry?job.phase:'partial';
    else if(optionalBudgetStop) {s.pendingAction=null;s.failureStopReason=job.phase==='plan'?'llm_budget_exhausted':'search_budget_exhausted';s.lastMessage='The available investigation allowance is used; the completed evidence checks are saved.';}
    else if(['configuration','forbidden','provider_error','search_disabled','budget_exhausted'].includes(code)) {nextPhase='finalize';s.failedStages.push(`${job.phase}:${code}`);s.failureStopReason=code==='budget_exhausted'?(actionKey.startsWith('EXTRACT')||actionKey.startsWith('PLAN')?'llm_budget_exhausted':'search_budget_exhausted'):'upstream_unavailable';}
    else if(job.phase==='plan'&&!provider?.uncertain){const menu=await allowedMenu();s.pendingAction=menu[0]||null;s.plannerMode='deterministic_fallback';nextPhase=s.pendingAction?'targeted_search':'finalize';s.lastMessage=s.pendingAction?.reason||'Planner unavailable; keeping saved evidence.';}
    else if(retry)nextPhase=job.phase;
    else if(!provider?.uncertain){nextPhase=job.phase==='details'?'reviews':job.phase==='reviews'?'extract':'finalize';s.failedStages.push(`${job.phase}:${code}`);}
    else s.failedStages.push(`${job.phase}:ambiguous_dispatch`);
    if(job.kind==='investigation'&&nextPhase==='finalize') {const saved=buildReport({...job,state:s,phase:optionalBudgetStop?job.phase:'partial'},now());s.report={...saved,sources:[],claims:[]};}
    s.activeMs+=Date.now()-started;
    const result=await rpc('fail_step',{p_job_id:job.id,p_lease_token:lease.lease_token,p_expected_version:version,p_attempt_id:attemptId,p_code:code,p_uncertain:dispatched&&Boolean(provider?.uncertain||!provider),p_retry_at:retry?new Date(now().getTime()+Math.max(1000,(provider?.retryAfterSeconds||2)*1000)).toISOString():null,p_phase:nextPhase,p_state:s},client);
    requireRpc(result);
    return result.job||await selectOne('jobs',{id:job.id,session_id:sessionId},client);
  }
}
export function reportWrapper(report:Report,s:JobState){return {profile_hash:hash(stable(s.requirements)),requirements:s.requirements,algorithm_version:report.algorithmVersion,report,is_partial:report.isPartial};}
function canonicalClaim(claim:EvidenceClaim,sourceId:string):EvidenceClaim {if(sourceId===claim.sourceId)return claim;const normalized={...claim,sourceId};return {...normalized,id:claimIdentityId({...normalized,extractorVersion:claim.extractorVersion||EXTRACTOR_VERSION})};}
