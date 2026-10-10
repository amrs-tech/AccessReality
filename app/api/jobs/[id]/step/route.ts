import { route,json,body } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { publicJob,ownedJob } from '@/lib/server/jobs';
import { stepInputSchema } from '@/lib/contracts';
import { advanceJob } from '@/lib/workflow/runner';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return route(async(requestId)=>{const s=await session(request);const {id}=await params;await ownedJob(s.id,id);const input=await body(request,stepInputSchema);const job=await advanceJob(s.id,id,input.expectedVersion,{requestId});return json(await publicJob(job));});}
