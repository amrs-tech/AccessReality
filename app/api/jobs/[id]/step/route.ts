import { route,json,body } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { publicJob,ownedJob } from '@/lib/server/jobs';
import { stepInputSchema } from '@/lib/contracts';
import { advanceJob } from '@/lib/workflow/runner';
import { refreshSearchBalance } from '@/lib/server/search-balance';
import { advanceNewsCheck } from '@/lib/workflow/news-runner';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return route(async(requestId)=>{const s=await session(request);const {id}=await params;const owned=await ownedJob(s.id,id);const input=await body(request,stepInputSchema);const advance=owned.kind==='news_check'?advanceNewsCheck:advanceJob;const job=await advance(s.id,id,input.expectedVersion,{requestId,refreshCredits:async()=>{await refreshSearchBalance();}});return json(await publicJob(job));});}
