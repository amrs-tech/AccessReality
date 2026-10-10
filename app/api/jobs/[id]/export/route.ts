import { route,json } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { ownedJob,publicJob } from '@/lib/server/jobs';
import { AppError } from '@/lib/server/errors';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return route(async()=>{const s=await session();const {id}=await params;const job=await publicJob(await ownedJob(s.id,id));if(!job.report)throw new AppError('version_conflict',409);const response=json(job.report);response.headers.set('Content-Disposition',`attachment; filename="accessreality-${id}.json"`);return response;});}
