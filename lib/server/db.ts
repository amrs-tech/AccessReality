import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { AppError } from './errors';
export function db():SupabaseClient {
  const e=env();
  return createClient(e.SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,opts)=>fetch(url,{...opts,signal:AbortSignal.timeout(8000)})}});
}
export async function rpc<T=any>(name:string,args:Record<string,unknown>,client=db()):Promise<T> {
  const {data,error}=await client.rpc(name,args);
  if(error) throw new AppError('dependency_unavailable');
  return data as T;
}
export async function selectOne(table:string,filters:Record<string,unknown>,client=db()):Promise<any> {
  let q=client.from(table).select('*');
  for(const [key,value] of Object.entries(filters)) q=q.eq(key,value);
  const {data,error}=await q.maybeSingle();
  if(error) throw new AppError('dependency_unavailable');
  return data;
}
