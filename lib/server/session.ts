import 'server-only';
import { cookies } from 'next/headers';
import { db,selectOne } from './db';
import { hash,opaque,equal,sign } from './crypto';
import { env } from './env';
import { AppError } from './errors';
import { checkCsrf } from './csrf';
export const SESSION_COOKIE='ar_session';
export const BOOTSTRAP_COOKIE='ar_bootstrap';
export interface Session {id:string;token:string}
export async function session(request?:Request):Promise<Session> {
  const token=(await cookies()).get(SESSION_COOKIE)?.value;
  if(!token)throw new AppError('unauthenticated',401);
  const s=await selectOne('demo_sessions',{token_hash:hash(token)});
  if(!s || s.revoked_at || Date.parse(s.expires_at)<=Date.now())throw new AppError('unauthenticated',401);
  if(request)checkCsrf(request,token);
  return {id:s.id,token};
}
export async function createSession(accessCode:string):Promise<Session> {
  if(!equal(accessCode,env().DEMO_ACCESS_CODE)) throw new AppError('invalid_code',401);
  const token=opaque();const {data,error}=await db().from('demo_sessions').insert({token_hash:hash(token),expires_at:new Date(Date.now()+86400000).toISOString()}).select('id').single();
  if(error)throw new AppError('dependency_unavailable');
  return {id:data.id,token};
}
export function cookieOptions(maxAge=86400) {return {httpOnly:true,secure:new URL(env().APP_ORIGIN).protocol==='https:',sameSite:'lax' as const,path:'/',maxAge};}
export function networkIdentity(request:Request):string {
  // Trusted deployment proxy supplies x-forwarded-for. Untrusted local spoofing cannot increase a global search cap.
  const forwarded=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,100)||'local';
  return sign(`network:${forwarded}`,env().RATE_LIMIT_HMAC_SECRET);
}
