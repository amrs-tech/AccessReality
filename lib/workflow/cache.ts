import { createHash } from 'node:crypto';
import { stable } from '../server/crypto';
export const ADAPTER_VERSION='serpapi-shapes-v1';
export function cacheKey(params:Record<string,string>):string {
  const normalized=Object.fromEntries(Object.entries(params).filter(([k])=>!['api_key','key'].includes(k)).map(([k,v])=>[k,v.replace(/\s+/g,' ').trim()]));
  return createHash('sha256').update(stable({params:normalized,version:ADAPTER_VERSION,locale:params.hl||'en'})).digest('hex');
}
export const cacheTtl=(action:string)=>action==='FETCH_DETAILS'?86400:21600;
