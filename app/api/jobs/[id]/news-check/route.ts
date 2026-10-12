import { route,json,body } from '@/lib/server/http';
import { session } from '@/lib/server/session';
import { createNewsCheck,latestNewsCheck,newsCheckInput } from '@/lib/server/news-check';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return route(async()=>{const s=await session();const {id}=await params;return json({check:await latestNewsCheck(s.id,id)});});}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return route(async()=>{const s=await session(request);const {id}=await params;const input=await body(request,newsCheckInput);return json({check:await createNewsCheck(s.id,id,input.idempotencyKey)});});}
