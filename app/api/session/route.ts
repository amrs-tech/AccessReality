import { z } from 'zod';
import { cookies } from 'next/headers';
import { body,json,route } from '@/lib/server/http';
import { configured } from '@/lib/server/env';
import { csrfToken,checkCsrf } from '@/lib/server/csrf';
import { opaque,equal } from '@/lib/server/crypto';
import { env } from '@/lib/server/env';
import { createSession,session,cookieOptions,SESSION_COOKIE,BOOTSTRAP_COOKIE,networkIdentity } from '@/lib/server/session';
import { rateLimit } from '@/lib/server/rate-limit';
import { db } from '@/lib/server/db';
import { AppError } from '@/lib/server/errors';
export const runtime='nodejs';
export async function GET(){return route(async()=>{
  if(!configured())return json({authenticated:false,configured:false,csrfToken:null});
  try {const s=await session();return json({authenticated:true,configured:true,csrfToken:csrfToken(s.token)});} catch(e){if(!(e instanceof AppError)||e.code!=='unauthenticated')throw e;}
  const token=opaque();const response=json({authenticated:false,configured:true,csrfToken:csrfToken(token)});response.cookies.set(BOOTSTRAP_COOKIE,token,cookieOptions(900));return response;
});}
export async function POST(request:Request){return route(async()=>{
  const token=(await cookies()).get(BOOTSTRAP_COOKIE)?.value;if(!token)throw new AppError('forbidden',403);checkCsrf(request,token);
  const input=await body(request,z.object({accessCode:z.string().min(1).max(256)}).strict());
  if(!equal(input.accessCode,env().DEMO_ACCESS_CODE)){await rateLimit(`login:${networkIdentity(request)}`,5,900);throw new AppError('invalid_code',401);}
  const s=await createSession(input.accessCode);const response=json({authenticated:true,configured:true,csrfToken:csrfToken(s.token)});response.cookies.set(SESSION_COOKIE,s.token,cookieOptions());response.cookies.delete(BOOTSTRAP_COOKIE);return response;
});}
export async function DELETE(request:Request){return route(async()=>{const s=await session(request);const {error}=await db().from('demo_sessions').update({revoked_at:new Date().toISOString()}).eq('id',s.id);if(error)throw new AppError('dependency_unavailable');const response=json({revoked:true});response.cookies.set(SESSION_COOKIE,'',cookieOptions(0));return response;});}
