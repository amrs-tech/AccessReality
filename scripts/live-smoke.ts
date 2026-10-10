import { assertConfiguration,run } from './shared';
import { db } from '../lib/server/db';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
// Explicit real-provider smoke only. Never imported by production routes.
run(async()=>{
  const e=assertConfiguration();
  if(!process.argv.includes('--confirm-live'))throw Object.assign(new Error(),{code:'explicit_opt_in_required_use_--confirm-live'});
  if(e.SEARCH_ENABLED!=='true'||process.env.VERIFICATION_MODE!=='true')throw Object.assign(new Error(),{code:'enable_SEARCH_ENABLED_and_VERIFICATION_MODE_in_server_and_local_env'});
  const base=process.env.LIVE_APP_URL||e.APP_ORIGIN;const origin=new URL(base).origin;
  let cookie='';let csrf='';const cookies=new Map<string,string>();
  async function api(path:string,method='GET',data?:unknown,admin=false):Promise<any> {
    const response=await fetch(`${base}${path}`,{method,headers:{'content-type':'application/json',origin,cookie,'x-csrf-token':csrf,...(admin?{authorization:`Bearer ${e.ADMIN_API_SECRET}`}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(65000)});
    for(const line of response.headers.getSetCookie()) {const [pair]=line.split(';');const eq=pair.indexOf('=');cookies.set(pair.slice(0,eq),pair.slice(eq+1));}cookie=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    const result=await response.json();if(result.csrfToken)csrf=result.csrfToken;
    if(!response.ok)throw Object.assign(new Error(),{code:result.error?.code||`http_${response.status}`});return result;
  }
  const before=await api('/api/admin/preflight','POST',{probeLlm:true},true);
  if(!before.verificationMode)throw Object.assign(new Error(),{code:'server_not_in_verification_allocation'});
  const client=db();const {data:allocation,error}=await client.from('budget_buckets').select('reserved_units,limit_units').eq('id','allocation:verification:serpapi').single();
  if(error||allocation.reserved_units+6>allocation.limit_units)throw Object.assign(new Error(),{code:'verification_allocation_insufficient_max30'});
  await api('/api/session');await api('/api/session','POST',{accessCode:e.DEMO_ACCESS_CODE});
  async function finish(id:string) {
    let job=await api(`/api/jobs/${id}`);let calls=0;
    while(!['complete','partial','cancelled'].includes(job.phase)) {
      if(++calls>20)throw Object.assign(new Error(),{code:'step_limit'});
      if(job.nextRetryAt){const delay=Date.parse(job.nextRetryAt)-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,Math.min(delay,60000)));}
      job=await api(`/api/jobs/${id}/step`,'POST',{expectedVersion:job.stateVersion});
      console.log(JSON.stringify({jobId:id,phase:job.phase,providerAttempts:job.providerAttempts,appCacheHits:job.appCacheHits}));
    }
    return job;
  }
  const discovery=await api('/api/discoveries','POST',{query:process.env.LIVE_VENUE_QUERY||'cafes in Indiranagar',city:'Bengaluru',country:'India',idempotencyKey:randomUUID()});
  const discovered=await finish(discovery.jobId);const venue=discovered.candidates.find((c:any)=>!c.provisional);if(!venue)throw Object.assign(new Error(),{code:'no_resolvable_real_branch'});
  const requirements=[{feature:'entrance_step_free',priority:'must_have'},{feature:'accessible_restroom',priority:'must_have'}];
  const runCreated=await api('/api/investigations','POST',{discoveryJobId:discovery.jobId,candidateId:venue.id,requirements,idempotencyKey:randomUUID()});
  const job=await finish(runCreated.jobId);if(!job.report)throw Object.assign(new Error(),{code:'missing_report'});
  const spots=job.report.claims.slice(0,3).map((claim:any)=>{const source=job.report.sources.find((s:any)=>s.id===claim.sourceId);const ok=source&&source.text.includes(claim.originalQuote)&&(claim.jsonPointer||source.text.slice(claim.quoteStart,claim.quoteEnd)===claim.originalQuote);if(!ok)throw Object.assign(new Error(),{code:'citation_spot_check_failed'});return {claimId:claim.id,valid:true};});
  const revised=await api(`/api/jobs/${job.id}/reassess`,'POST',{requirements:[requirements[0],{feature:'accessible_restroom',priority:'not_needed'}]});
  if(revised.providerAttempts!==job.providerAttempts)throw Object.assign(new Error(),{code:'reassessment_spent_search'});
  const attempts=await client.from('provider_attempts').select('id,status,provider_search_id,provider').in('job_id',[discovery.jobId,job.id]);
  if(attempts.error||attempts.data?.some(a=>a.provider==='serpapi'&&a.status==='completed'&&!a.provider_search_id))throw Object.assign(new Error(),{code:'missing_provider_search_id'});
  const after=await api('/api/admin/preflight','POST',{probeLlm:false},true);
  const lockHash=createHash('sha256').update(await readFile('package-lock.json')).digest('hex');
  const record={checkedAt:new Date().toISOString(),timezone:'Asia/Calcutta',url:base,venue:{name:venue.name,address:venue.address},providerAttempts:discovered.providerAttempts+job.providerAttempts,appCacheHits:discovered.appCacheHits+job.appCacheHits,beforeRemaining:before.account.remaining,afterRemaining:after.account.remaining,spots,reassessmentZeroSearch:true,phase:job.phase,lockHash};
  await mkdir('.verification',{recursive:true});await writeFile(`.verification/live-${Date.now()}.json`,JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
  // This smoke is only one gate. Browser isolation, pause/resume and secret-bundle checks remain separate.
});
