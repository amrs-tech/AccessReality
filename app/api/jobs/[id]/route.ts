import { route,json } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { ownedJob,publicJob } from '@/lib/server/jobs';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return route(async()=>{const s=await session();const {id}=await params;return json(await publicJob(await ownedJob(s.id,id)));});}
