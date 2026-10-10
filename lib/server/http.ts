import 'server-only';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { AppError,messages } from './errors';
export async function body<T>(request:Request,schema:z.ZodType<T>):Promise<T> {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('invalid_request',400);
  if(Number(request.headers.get('content-length')||0)>16384) throw new AppError('invalid_request',413);
  const reader=request.body?.getReader();
  if(!reader) throw new AppError('invalid_request',400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new AppError('invalid_request',413);}chunks.push(value);}
  try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));const parsed=schema.safeParse(data);if(!parsed.success)throw new Error();return parsed.data;} catch {throw new AppError('invalid_request',400);}
}
export function json(value:unknown,status=200):NextResponse {return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});}
export function route(fn:(requestId:string)=>Promise<Response>):Promise<Response> {
  const requestId=randomUUID();
  return fn(requestId).catch((error:unknown)=>{
    const e=error instanceof AppError?error:new AppError(error instanceof Error&&error.message==='configuration_missing'?'configuration_missing':'dependency_unavailable');
    console.error(JSON.stringify({requestId,errorCode:e.code}));
    return json({error:{code:e.code,message:messages[e.code]||'The request could not be completed. Existing evidence is preserved.',retryable:e.retryable},requestId},e.status);
  });
}
