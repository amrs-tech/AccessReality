import { assertConfiguration,run } from './shared';
import { rpc } from '../lib/server/db';
import { requireRpc } from '../lib/server/jobs';
import { inspectAccount } from '../lib/providers/serpapi';
run(async()=>{
  const e=assertConfiguration();requireRpc(await rpc('preflight_status',{}));
  const account=await inspectAccount({apiKey:e.SERPAPI_API_KEY});
  const enable=process.argv.includes('--enable');const increase=process.argv.includes('--allow-increase');
  const search=requireRpc(await rpc('reconcile_budget',{p_provider:'serpapi',p_remaining:account.remaining,p_protected_reserve:e.SERPAPI_PROTECTED_RESERVE,p_owner_cap:e.SERPAPI_OPERATIONAL_CAP,p_enabled:enable,p_allow_increase:increase}));
  const llm=requireRpc(await rpc('configure_llm_budget',{p_owner_cap:1000,p_enabled:enable,p_allow_increase:increase}));
  const policy=requireRpc(await rpc('configure_limits',{p_serp_daily:e.SERPAPI_DAILY_ATTEMPT_CAP,p_serp_session:12}));
  console.log(JSON.stringify({search,llm,policy,envSearchEnabled:e.SEARCH_ENABLED==='true',message:enable?'DB searches enabled; environment kill switch must also be true.':'DB searches disabled. Use --enable after checks to deliberately enable.'},null,2));
});
