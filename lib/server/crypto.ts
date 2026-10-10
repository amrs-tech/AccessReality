import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const opaque=()=>randomBytes(32).toString('base64url');
export const sign=(value:string,secret:string)=>createHmac('sha256',secret).update(value).digest('base64url');
export function equal(a:string,b:string):boolean { return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest()); }
export function stable(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
