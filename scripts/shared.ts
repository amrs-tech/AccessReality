import { config } from 'dotenv';
import { envSchema } from '../lib/server/env';
config({path:'.env.local',quiet:true});
export function assertConfiguration() {
  const parsed=envSchema.safeParse(process.env);
  if(!parsed.success) {const missing=[...new Set(parsed.error.issues.map(i=>i.path.join('.')))];throw new Error(`Configuration missing or invalid: ${missing.join(', ')}. Fill .env.local; values are never printed.`);}
  return parsed.data;
}
export function run(fn:()=>Promise<void>){fn().catch(e=>{console.error(e instanceof Error&&e.message.startsWith('Configuration missing')?e.message:`Setup/verification stopped: ${e?.code||'dependency_or_provider_failure'}. No secret details printed.`);process.exitCode=1;});}
