import 'server-only';
import { rpc } from './db';
import { AppError } from './errors';
export async function rateLimit(key:string,limit:number,windowSeconds:number):Promise<void> {
  const result=await rpc('consume_rate_limit',{p_key:key,p_limit:limit,p_window_seconds:windowSeconds});
  if(!result.allowed)throw new AppError('rate_limited',429,true);
}
