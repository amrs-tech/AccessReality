import { route,json,body } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { publicJob,requireRpc,ownedJob } from '@/lib/server/jobs';
import { rpc } from '@/lib/server/db';
import { z } from 'zod';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return route(async()=>{const s=await session(request);const {id}=await params;await body(request,z.object({}).strict());const result=requireRpc(await rpc('cancel_job',{p_session_id:s.id,p_job_id:id}));return json(await publicJob(result.job||await ownedJob(s.id,id)));});}
