import { discoveryInputSchema } from '@/lib/contracts';
import { body,json,route } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { createJob } from '@/lib/server/jobs';
export const runtime='nodejs';
export async function POST(request:Request){return route(async()=>{const s=await session(request);const input=await body(request,discoveryInputSchema);return json(await createJob(s.id,input.idempotencyKey,input,'discovery'),201);});}
