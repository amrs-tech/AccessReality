import { assertConfiguration,run } from './shared';
import { db } from '../lib/server/db';
import { chromium } from '@playwright/test';
import type { PublicJob } from '../lib/contracts';
import { mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const gate=(value:unknown,code:string)=>{if(!value)throw Object.assign(new Error(),{code});};
// An owner-invoked real check with one preferred feature: no targeted gap
// searches are eligible. It exercises existing discovery/details/reviews only.
run(async()=>{
  gate(process.argv.includes('--confirm-live'),'explicit_live_opt_in_required');
  const e=assertConfiguration();gate(process.env.VERIFICATION_MODE==='true','verification_mode_required');
  const base=e.APP_ORIGIN;const client=db();
  const allocation=await client.from('budget_buckets').select('reserved_units,limit_units').eq('id','allocation:verification:serpapi').single();
  gate(!allocation.error&&allocation.data&&allocation.data.limit_units<=30&&allocation.data.limit_units-allocation.data.reserved_units>=6,'verification_allocation_insufficient_for_three_checks_and_retries');
  const browserEnv=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&/^(SYSTEMROOT|WINDIR|PATH|PATHEXT|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|LANG|LC_ALL|DISPLAY|XAUTHORITY)$/i.test(key))) as Record<string,string>;
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,env:browserEnv});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const stamp=Date.now();const record:Record<string,unknown>={checkedAt:new Date().toISOString(),mockedResponses:false,passed:false,verificationReservedBefore:allocation.data!.reserved_units};
  let csrf='',jobId:string|null=null;let scannedBodies=0;const secrets=[e.SERPAPI_API_KEY,e.GEMINI_API_KEY,e.SUPABASE_SERVICE_ROLE_KEY,e.DEMO_ACCESS_CODE,e.ADMIN_API_SECRET,e.SESSION_HMAC_SECRET,e.RATE_LIMIT_HMAC_SECRET];
  async function api<T>(path:string,method='GET',data?:unknown,admin=false):Promise<T>{
    const response=await context.request.fetch(`${base}${path}`,{method,headers:{origin:base,...(csrf?{'X-CSRF-Token':csrf}:{}),...(admin?{authorization:`Bearer ${e.ADMIN_API_SECRET}`}:{})},...(data!==undefined?{data}:{}),timeout:65000});
    const text=await response.text();scannedBodies++;gate(!secrets.some(secret=>text.includes(secret)),'secret_in_photo_check_response');
    const result=JSON.parse(text);gate(response.ok(),result.error?.code||'photo_check_api_failed');return result;
  }
  async function finish(id:string){
    let job=await api<PublicJob>(`/api/jobs/${id}`);const until=Date.now()+150000;
    for(let n=0;!['complete','partial','cancelled'].includes(job.phase);n++){
      gate(n<e.MAX_WORKFLOW_STEPS&&Date.now()<until,'photo_check_workflow_bound');
      const retry=job.nextRetryAt?Math.max(0,Date.parse(job.nextRetryAt)-Date.now()):0;if(retry)await new Promise(resolve=>setTimeout(resolve,Math.min(retry,30000)));
      job=await api<PublicJob>(`/api/jobs/${id}/step`,'POST',{expectedVersion:job.stateVersion});
    }return job;
  }
  try{
    const preflight=await api<any>('/api/admin/preflight','POST',{probeLlm:false},true);gate(preflight.verificationMode&&preflight.database?.ok,'server_verification_mode_required');record.balanceBefore=preflight.account.remaining;
    const bootstrap=await api<{csrfToken:string}>('/api/session');csrf=bootstrap.csrfToken;const login=await api<{csrfToken:string}>('/api/session','POST',{accessCode:e.DEMO_ACCESS_CODE});csrf=login.csrfToken;
    const discovery=await api<{jobId:string}>('/api/discoveries','POST',{query:process.env.LIVE_QUERY||'Casa Fresco Indiranagar',city:process.env.LIVE_CITY||'Bengaluru',country:'India',idempotencyKey:randomUUID()});
    const found=await finish(discovery.jobId);gate(found.phase==='complete','photo_check_discovery_incomplete');const candidate=found.candidates.find(candidate=>/Casa Fresco/i.test(candidate.name))||found.candidates[0];gate(candidate,'photo_check_no_candidate');
    const investigation=await api<{jobId:string}>('/api/investigations','POST',{discoveryJobId:found.id,candidateId:candidate.id,requirements:[{feature:'entrance_step_free',priority:'preferred'}],idempotencyKey:randomUUID()});jobId=investigation.jobId;
    const job=await finish(jobId);gate(job.report,'photo_check_no_report');
    const photos=[...(job.report!.venue.images||[]),...job.report!.sources.flatMap(source=>source.images||[])];
    gate(photos.every(photo=>photo.capturedAt===null&&photo.providerSearchId&&photo.jsonPointer.startsWith('/')),'photo_provenance_missing');
    const page=await context.newPage();await page.goto(`${base}/investigate/${job.id}`);await page.getByRole('heading',{name:'Source photos',exact:true}).waitFor();
    let loadedImages=0;
    if(photos.length){const first=page.locator('.evidence-photo img').first();await first.scrollIntoViewIfNeeded();await first.waitFor({state:'visible'});await page.waitForFunction(()=>{const img=document.querySelector<HTMLImageElement>('.evidence-photo img');return Boolean(img?.complete);},{},{timeout:15000});loadedImages=await page.locator('.evidence-photo img').evaluateAll(images=>images.filter(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0).length);gate(loadedImages>0,'available_photo_did_not_load');}
    const screenshot=`.verification/live-images-${stamp}.png`;await mkdir('.verification',{recursive:true});await page.screenshot({path:screenshot,fullPage:false});
    const after=await api<any>('/api/admin/preflight','POST',{probeLlm:false},true);const used=await client.from('budget_buckets').select('reserved_units,limit_units').eq('id','allocation:verification:serpapi').single();gate(!used.error&&used.data&&used.data.reserved_units<=30,'photo_check_verification_limit');
    Object.assign(record,{passed:true,jobId:job.id,venue:{name:job.venue?.name,address:job.venue?.address},phase:job.phase,isPartial:job.report!.isPartial,overall:job.report!.overall,photoCount:photos.length,loadedImages,photoDatesUnknown:true,searchReservations:found.providerAttempts+job.providerAttempts,appCacheHits:found.appCacheHits+job.appCacheHits,llmRequests:job.llmAttempts,balanceAfter:after.account.remaining,verificationReservedAfter:used.data!.reserved_units,scannedBodies,screenshot});
  }catch(error){record.failureCode=(error as {code?:string}).code||'photo_check_failed';throw error;}
  finally{if(jobId){try{const latest=await api<PublicJob>(`/api/jobs/${jobId}`);if(!['complete','partial','cancelled'].includes(latest.phase))await api(`/api/jobs/${jobId}/cancel`,'POST',{});}catch{/* Do not expose raw credential-bearing requests. */}}await browser.close();await mkdir('.verification',{recursive:true});await writeFile(`.verification/live-images-${stamp}.json`,JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));}
});
