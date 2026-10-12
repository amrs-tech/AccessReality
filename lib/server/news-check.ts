import 'server-only';
import { z } from 'zod';
import type { PublicNewsCheck } from '../news/contracts';
import type { JobRow } from '../workflow/state';
import { terminal } from '../workflow/state';
import { db,rpc,selectOne } from './db';
import { ownedJob,requireRpc } from './jobs';
import { AppError } from './errors';
import { hash,stable } from './crypto';
import { rateLimit } from './rate-limit';
import { refreshSearchBalance } from './search-balance';

export const newsCheckInput=z.object({idempotencyKey:z.string().min(16).max(100)}).strict();
export const newsCheckStepInput=z.object({checkId:z.uuid(),expectedVersion:z.number().int().nonnegative()}).strict();
export function publicNewsCheck(job:JobRow):PublicNewsCheck {
  return {id:job.id,parentJobId:job.input.parentJobId,phase:job.phase,stateVersion:job.state_version,
    providerAttempts:job.serp_reserved,appCacheHits:job.state.cacheHits||0,searchCap:job.serp_cap,
    result:job.state.newsResult||null,nextRetryAt:job.next_retry_at,canResume:!terminal(job.phase),
    stopReason:job.stop_reason,errorCode:job.state.newsErrorCode||null};
}
async function parentJob(sessionId:string,parentId:string){
  const parent=await ownedJob(sessionId,parentId);if(parent.kind!=='investigation')throw new AppError('not_found',404);return parent;
}
export async function latestNewsCheck(sessionId:string,parentId:string):Promise<PublicNewsCheck|null>{
  await parentJob(sessionId,parentId);
  const {data,error}=await db().from('jobs').select('*').eq('session_id',sessionId).eq('kind','news_check')
    .eq('input->>parentJobId',parentId).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw new AppError('dependency_unavailable');return data?publicNewsCheck(data as JobRow):null;
}
export async function createNewsCheck(sessionId:string,parentId:string,key:string):Promise<PublicNewsCheck>{
  const parent=await parentJob(sessionId,parentId);if(!['complete','partial'].includes(parent.phase))throw new AppError('visit_brief_required',409);
  const requestHash=hash(stable({parentJobId:parentId,feature:'visit-watch-v1'}));
  const existing=await selectOne('jobs',{session_id:sessionId,idempotency_key:key});
  if(existing){if(existing.kind!=='news_check'||existing.input.parentJobId!==parentId||existing.request_hash!==requestHash)throw new AppError('idempotency_conflict',409);return publicNewsCheck(existing);}
  await rateLimit(`news-check:${sessionId}:${parentId}`,2,3600);
  await refreshSearchBalance({force:true});
  const created=requireRpc(await rpc('create_news_check',{p_session_id:sessionId,p_parent_job_id:parentId,p_key:key,p_hash:requestHash,p_allocation:process.env.VERIFICATION_MODE==='true'?'verification':'operations'}));
  return publicNewsCheck(created.job);
}
export async function ownedNewsCheck(sessionId:string,parentId:string,checkId:string):Promise<JobRow>{
  await parentJob(sessionId,parentId);const check=await ownedJob(sessionId,checkId);
  if(check.kind!=='news_check'||check.input.parentJobId!==parentId)throw new AppError('not_found',404);return check;
}
