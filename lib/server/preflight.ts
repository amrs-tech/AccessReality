import 'server-only';
import { env } from './env';
import { rpc } from './db';
import { requireRpc } from './jobs';
import { inspectAccount } from '../providers/serpapi';
import { probeGemini } from '../providers/gemini';
export async function preflight(probeLlm=false) {
  const e=env();const database=requireRpc(await rpc('preflight_status',{}));
  const check=requireRpc(await rpc('begin_serpapi_balance_check',{}));
  const account=await inspectAccount({apiKey:e.SERPAPI_API_KEY});
  requireRpc(await rpc('reconcile_serpapi_balance',{p_remaining:account.remaining,p_snapshot:check.snapshot,p_checked_at:account.checkedAt,p_protected_reserve:e.SERPAPI_PROTECTED_RESERVE,p_owner_cap:e.SERPAPI_OPERATIONAL_CAP,p_enabled:database.searchEnabled,p_allow_increase:false}));
  const llm=probeLlm?await probeGemini({apiKey:e.GEMINI_API_KEY,model:e.GEMINI_MODEL}):{run:false,model:e.GEMINI_MODEL};
  const searchPolicy=requireRpc(await rpc('current_search_policy',{p_full_cap:e.INVESTIGATION_SEARCH_CAP}));
  return {database,account,llm,searchPolicy,verificationMode:process.env.VERIFICATION_MODE==='true',searchEnabled:e.SEARCH_ENABLED==='true'};
}
