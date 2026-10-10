import 'server-only';
import type { PublicJob,Requirements } from '../contracts';
import { db,selectOne,rpc } from './db';
import { AppError } from './errors';
import { hash,stable } from './crypto';
import { env } from './env';
import { initialState,terminal,type JobRow } from '../workflow/state';
import { rateLimit } from './rate-limit';
import { buildReport as assess } from '../assessment';
export async function ownedJob(sessionId:string,id:string):Promise<JobRow> {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new AppError('not_found',404);
  const job=await selectOne('jobs',{id,session_id:sessionId});
  if(!job)throw new AppError('not_found',404);
  return job;
}
export function requireRpc(result:any):any {
  if(result?.ok===false)throw new AppError(result.code||'dependency_unavailable',['not_found'].includes(result.code)?404:['budget_exhausted','rate_limited'].includes(result.code)?429:['busy','version_conflict','idempotency_conflict','action_completed'].includes(result.code)?409:503,result.code==='busy');
  return result;
}
export async function publicJob(job:JobRow):Promise<PublicJob> {
  const client=db();const {data:events,error}=await client.from('job_events').select('id,event_type,payload,created_at').eq('job_id',job.id).order('created_at',{ascending:false}).limit(30);
  if(error)throw new AppError('dependency_unavailable');
  const bucket=await selectOne('budget_buckets',{id:'global:serpapi'},client);
  const s=job.state;
  const {data:assessment,error:assessmentError}=await client.from('assessments').select('report').eq('job_id',job.id).order('revision',{ascending:false}).limit(1).maybeSingle();
  if(assessmentError)throw new AppError('dependency_unavailable');
  let report=assessment?.report||s.report;
  if(job.kind==='investigation'&&s.venue&&((terminal(job.phase)&&(job.phase!=='complete'||!report))||s.failedStages.length>0)) {
    report=assess({venue:s.venue,requirements:s.requirements,claims:s.claims||[],sources:s.sources||[],asOf:report?.generatedAt||(job as any).finished_at||(job as any).updated_at,
      isPartial:true,limitations:[...s.failedStages.map(x=>`Unavailable stage: ${x}.`),`Run stopped: ${job.stop_reason||job.phase}.`],reviewsExamined:s.reviewsExamined});
  }
  return {id:job.id,kind:job.kind,phase:job.phase,stateVersion:job.state_version,venue:s.venue,candidates:s.candidates||[],requirements:s.requirements||[],report,
    providerAttempts:job.serp_reserved,appCacheHits:s.cacheHits||0,searchCap:job.serp_cap,llmAttempts:job.llm_reserved,llmCap:job.llm_cap,
    sourceCount:s.sources?.length||0,reviewsExamined:s.reviewsExamined||0,
    events:(events||[]).reverse().map(e=>({id:e.id,type:e.event_type,message:typeof e.payload?.message==='string'?e.payload.message:humanEvent(e.event_type),createdAt:e.created_at})),
    stopReason:job.stop_reason,nextRetryAt:job.next_retry_at,canResume:!terminal(job.phase),remainingAction:s.pendingAction?.reason||(!terminal(job.phase)?humanEvent(job.phase):null),
    discoveryJobId:job.input.discoveryJobId||null,candidateId:job.input.candidateId||null,lastKnownProviderRemaining:bucket?.last_known_provider_remaining??null,allowanceCheckedAt:bucket?.checked_at??null};
}
function humanEvent(event:string):string {return ({details:'Checking venue listing attributes.',reviews:'Checking a small newest-review sample.',extract:'Extracting and validating source-linked observations.',assess:'Assessing the selected requirements.',plan:'Selecting a permitted investigation of missing evidence.',targeted_search:'Checking a selected evidence gap.',finalize:'Preparing the visit brief.'} as Record<string,string>)[event]||event.replaceAll('_',' ');}
export async function createJob(sessionId:string,key:string,input:any,kind:'discovery'|'investigation'):Promise<any> {
  const existing=await selectOne('jobs',{session_id:sessionId,idempotency_key:key});
  const requestHash=hash(stable(input));
  if(existing){if(existing.request_hash!==requestHash)throw new AppError('idempotency_conflict',409);return {jobId:existing.id,stateVersion:existing.state_version};}
  let venue=null;let requirements:Requirements=[];
  if(kind==='investigation') {
    const discovery=await ownedJob(sessionId,input.discoveryJobId);
    if(discovery.kind!=='discovery'||discovery.phase!=='complete')throw new AppError('invalid_request',400);
    venue=discovery.state.candidates.find(v=>v.id===input.candidateId);
    if(!venue)throw new AppError('not_found',404);
    if(venue.provisional)throw new AppError('unsupported_venue',422);
    requirements=input.requirements;
  }
  await rateLimit(`create:${sessionId}:${kind}`,2,3600);
  const e=env();const result=requireRpc(await rpc('create_job',{p_session_id:sessionId,p_key:key,p_hash:requestHash,p_kind:kind,p_venue_id:venue?.id||null,p_input:{...input,_allocation:process.env.VERIFICATION_MODE==='true'?'verification':'operations'},p_state:initialState(requirements,venue),p_serp_cap:kind==='discovery'?1:e.INVESTIGATION_SEARCH_CAP,p_llm_cap:kind==='discovery'?0:e.INVESTIGATION_LLM_CAP}));
  return {jobId:result.job?.id||result.job_id||result.id,stateVersion:result.job?.state_version||result.state_version||0};
}
