import 'server-only';
import { env } from './env';
import { rpc } from './db';
import { requireRpc } from './jobs';
import { inspectAccount } from '../providers/serpapi';
import { probeGemini } from '../providers/gemini';
export async function preflight(probeLlm=false) {
  const e=env();const database=requireRpc(await rpc('preflight_status',{}));
  const account=await inspectAccount({apiKey:e.SERPAPI_API_KEY});
  const llm=probeLlm?await probeGemini({apiKey:e.GEMINI_API_KEY,model:e.GEMINI_MODEL}):{run:false,model:e.GEMINI_MODEL};
  return {database,account,llm,verificationMode:process.env.VERIFICATION_MODE==='true',searchEnabled:e.SEARCH_ENABLED==='true'};
}
