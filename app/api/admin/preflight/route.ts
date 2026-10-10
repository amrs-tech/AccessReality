import { z } from 'zod';
import { body,json,route } from '@/lib/server/http';
import { sameOrigin } from '@/lib/server/csrf';
import { env } from '@/lib/server/env';
import { equal } from '@/lib/server/crypto';
import { AppError } from '@/lib/server/errors';
import { preflight } from '@/lib/server/preflight';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){return route(async()=>{sameOrigin(request);if(!equal(request.headers.get('authorization')||'',`Bearer ${env().ADMIN_API_SECRET}`))throw new AppError('forbidden',403);const input=await body(request,z.object({probeLlm:z.boolean().default(false)}).strict());return json(await preflight(input.probeLlm));});}
