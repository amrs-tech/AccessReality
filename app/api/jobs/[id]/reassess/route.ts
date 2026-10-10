import { route,json,body } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { publicJob,requireRpc,ownedJob } from '@/lib/server/jobs';
import { rpc } from '@/lib/server/db';
import { reassessInputSchema } from '@/lib/contracts';
import { buildReport } from '@/lib/workflow/runner';
import { hash,stable } from '@/lib/server/crypto';
import { terminal } from '@/lib/workflow/state';
import { AppError } from '@/lib/server/errors';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return route(async()=>{
  const s=await session(request);const {id}=await params;const input=await body(request,reassessInputSchema);const job=await ownedJob(s.id,id);
  if(job.kind!=='investigation'||!terminal(job.phase))throw new AppError('version_conflict',409);
  const state={...job.state,requirements:input.requirements};const report=buildReport({...job,state},new Date());
  const result=requireRpc(await rpc('save_assessment',{p_session_id:s.id,p_job_id:id,p_expected_version:job.state_version,p_profile_hash:hash(stable(input.requirements)),p_requirements:input.requirements,p_algorithm_version:report.algorithmVersion,p_report:report,p_is_partial:report.isPartial}));
  return json(await publicJob(result.job||await ownedJob(s.id,id)));
});}
