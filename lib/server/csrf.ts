import 'server-only';
import { env } from './env';
import { AppError } from './errors';
import { sign,equal } from './crypto';
export const csrfToken=(token:string)=>sign(`csrf:${token}`,env().SESSION_HMAC_SECRET);
export function sameOrigin(request:Request):void {
  if(request.headers.get('origin')!==env().APP_ORIGIN || request.headers.get('sec-fetch-site')==='cross-site') throw new AppError('forbidden',403);
}
export function checkCsrf(request:Request,token:string):void {sameOrigin(request);if(!equal(request.headers.get('x-csrf-token')||'',csrfToken(token)))throw new AppError('forbidden',403);}
