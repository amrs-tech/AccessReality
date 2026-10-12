import { route,json,body } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { ownedNewsCheck,publicNewsCheck,newsCheckStepInput } from '@/lib/server/news-check';
import { advanceNewsCheck } from '@/lib/workflow/news-runner';
import { refreshSearchBalance } from '@/lib/server/search-balance';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return route(async(requestId)=>{const s=await session(request);const {id}=await params;const input=await body(request,newsCheckStepInput);await ownedNewsCheck(s.id,id,input.checkId);const check=await advanceNewsCheck(s.id,input.checkId,input.expectedVersion,{requestId,refreshCredits:async()=>{await refreshSearchBalance();}});return json({check:publicNewsCheck(check)});});}
