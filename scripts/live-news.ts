import { assertConfiguration,run } from './shared';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { db,selectOne,rpc } from '../lib/server/db';
import { ownedJob,requireRpc } from '../lib/server/jobs';
import { createNewsCheck,latestNewsCheck,publicNewsCheck } from '../lib/server/news-check';
import { advanceNewsCheck } from '../lib/workflow/news-runner';
import { refreshSearchBalance } from '../lib/server/search-balance';
import { inspectAccount,serpapiSearch } from '../lib/providers/serpapi';
import { hash,stable } from '../lib/server/crypto';
import type { JobRow } from '../lib/workflow/state';

const gate=(value:unknown,code:string)=>{if(!value)throw Object.assign(new Error(),{code});};
// Explicit owner verification of an existing real private report. The script
// never creates a discovery/report, changes budgets, or launches an app server.
run(async()=>{
  gate(process.argv.includes('--confirm-live'),'explicit_live_opt_in_required');
  const e=assertConfiguration();gate(process.env.VERIFICATION_MODE==='true','verification_mode_required');
  const index=process.argv.indexOf('--parent-job-id');const parentId=process.argv[index+1];
  gate(index>=0&&z.uuid().safeParse(parentId).success,'saved_parent_job_id_required');
  const client=db();const status=requireRpc(await rpc('preflight_status',{},client));
  gate(status.ok&&status.migration==='007'&&status.privateGrants,'news_migration_required');
  const allocation=await selectOne('budget_buckets',{id:'allocation:verification:serpapi'},client);
  gate(allocation&&allocation.limit_units<=30&&allocation.limit_units-allocation.reserved_units>=2,'verification_allocation_requires_two_available_attempts');
  const parent=await selectOne('jobs',{id:parentId},client) as JobRow|null;
  gate(parent&&parent.kind==='investigation'&&['complete','partial'].includes(parent.phase),'saved_parent_required');
  const sessionId=parent!.session_id;const session=await selectOne('demo_sessions',{id:sessionId},client);
  gate(session&&!session.revoked_at&&Date.parse(session.expires_at)>Date.now(),'active_parent_session_required');
  const fingerprint=async()=>{
    const saved=await ownedJob(sessionId,parentId);
    const {data,error}=await client.from('assessments').select('id,revision,report').eq('job_id',parentId).order('revision');
    gate(!error,'assessment_read_failed');return hash(stable({state:saved.state,phase:saved.phase,version:saved.state_version,reports:data}));
  };
  const beforeHash=await fingerprint(),key=randomUUID(),stamp=Date.now();let checkId:string|null=null;
  const balanceBefore=await inspectAccount({apiKey:e.SERPAPI_API_KEY});
  const record:Record<string,unknown>={checkedAt:new Date().toISOString(),mockedResponses:false,passed:false,parentJobId:parentId,verificationReservedBefore:allocation.reserved_units,balanceBefore:balanceBefore.remaining};
  const secrets=[e.SERPAPI_API_KEY,e.GEMINI_API_KEY,e.SUPABASE_SERVICE_ROLE_KEY,e.DEMO_ACCESS_CODE,e.ADMIN_API_SECRET,e.SESSION_HMAC_SECRET,e.RATE_LIMIT_HMAC_SECRET];
  // Read a bounded copy of the real response to record its shape. Return the
  // untouched response; no fixture or synthetic response can enter this check.
  const observedFetch:typeof fetch=async(url,options)=>{
    const response=await fetch(url,options),reader=response.clone().body?.getReader();
    if(reader){let text='',bytes=0;const decoder=new TextDecoder();
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1_000_000){await reader.cancel();break;}text+=decoder.decode(part.value,{stream:true});}
      if(bytes<=1_000_000){try{const payload=JSON.parse(text+decoder.decode());const article=payload.news_results?.[0]?.highlight||payload.news_results?.[0]?.stories?.[0]||payload.news_results?.[0];
        record.observedShape={httpStatus:response.status,status:payload.search_metadata?.status,providerSearchId:payload.search_metadata?.id,error:typeof payload.error==='string'&&!secrets.some(secret=>payload.error.includes(secret))?payload.error.slice(0,200):undefined,information:payload.search_information?Object.fromEntries(['news_results_state','organic_results_state'].filter(key=>typeof payload.search_information[key]==='string').map(key=>[key,payload.search_information[key].slice(0,100)])):undefined,newsArray:Array.isArray(payload.news_results),newsCount:Array.isArray(payload.news_results)?payload.news_results.length:null,firstArticleFields:article?Object.keys(article).filter(key=>['title','link','source','date','iso_date','snippet','highlight','stories'].includes(key)):[]};
      }catch{/* Adapter reports malformed responses. */}}
    }return response;
  };
  try{
    let check=await createNewsCheck(sessionId,parentId,key);checkId=check.id;
    for(let n=0;check.canResume;n++){
      gate(n<4,'news_step_bound');
      if(check.nextRetryAt){const sleep=Math.max(0,Date.parse(check.nextRetryAt)-Date.now()+1000);gate(sleep<=60000,'news_retry_delay_bound');if(sleep)await new Promise(resolve=>setTimeout(resolve,sleep));}
      check=publicNewsCheck(await advanceNewsCheck(sessionId,check.id,check.stateVersion,{refreshCredits:()=>refreshSearchBalance(),search:(params,options)=>serpapiSearch(params,{...options,fetch:observedFetch})}));
    }
    gate(check.phase==='complete'&&check.result,'news_check_not_complete');
    gate(check.providerAttempts<=2&&check.result!.providerSearchId,'news_provenance_required');
    const original=await ownedJob(sessionId,check.id);gate(original.llm_reserved===0&&original.state.sources.length===0&&original.state.claims.length===0&&original.state.report===null,'news_must_not_create_accessibility_evidence');
    const replay=await createNewsCheck(sessionId,parentId,key);gate(replay.id===check.id&&replay.providerAttempts===check.providerAttempts,'news_idempotency_failed');
    const terminal=await advanceNewsCheck(sessionId,check.id,check.stateVersion);gate(terminal.state_version===check.stateVersion&&terminal.serp_reserved===check.providerAttempts,'terminal_news_replayed');
    const cached=await createNewsCheck(sessionId,parentId,randomUUID());
    const cachedResult=publicNewsCheck(await advanceNewsCheck(sessionId,cached.id,cached.stateVersion,{refreshCredits:()=>refreshSearchBalance()}));
    gate(cachedResult.phase==='complete'&&cachedResult.providerAttempts===0&&cachedResult.appCacheHits===1,'news_cache_dispatched');
    gate(stable(cachedResult.result)===stable(check.result),'news_cache_provenance_changed');
    const latest=await latestNewsCheck(sessionId,parentId);gate(latest?.id===cachedResult.id,'news_reload_failed');
    gate(await fingerprint()===beforeHash,'news_changed_saved_accessibility_brief');
    gate(!secrets.some(secret=>JSON.stringify({check,cachedResult}).includes(secret)),'news_public_secret_match');
    const used=await selectOne('budget_buckets',{id:'allocation:verification:serpapi'},client);gate(used.reserved_units<=30&&used.limit_units===allocation.limit_units,'verification_allocation_changed');
    const balanceAfter=await inspectAccount({apiKey:e.SERPAPI_API_KEY});
    Object.assign(record,{passed:true,checkId:check.id,cachedCheckId:cachedResult.id,phase:check.phase,articleCount:check.result!.articles.length,datedArticles:check.result!.articles.filter(article=>article.publishedAt).length,publishers:check.result!.articles.map(article=>article.publisher),relations:check.result!.articles.map(article=>article.relation),providerSearchId:check.result!.providerSearchId,originalRetrievedAt:check.result!.retrievedAt,expiresAt:check.result!.expiresAt,searchReservations:check.providerAttempts,appCacheHits:cachedResult.appCacheHits,llmRequests:0,parentUnchanged:true,idempotencyVerified:true,reloadVerified:true,publicSecretMatches:0,balanceAfter:balanceAfter.remaining,verificationReservedAfter:used.reserved_units});
  }catch(error){record.failureCode=(error as {code?:string}).code||'news_check_failed';if(checkId){try{const check=publicNewsCheck(await ownedJob(sessionId,checkId));Object.assign(record,{checkId,phase:check.phase,errorCode:check.errorCode,searchReservations:check.providerAttempts});}catch{/* Preserve safe failure record. */}}throw error;}
  finally{const used=await selectOne('budget_buckets',{id:'allocation:verification:serpapi'},client);record.verificationReservedAfter=used?.reserved_units;await mkdir('.verification',{recursive:true});await writeFile(`.verification/live-news-${stamp}.json`,JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));}
});
