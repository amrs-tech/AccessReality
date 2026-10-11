import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inspectAccount } from '../providers/serpapi';
import { db, rpc, selectOne } from './db';
import { env } from './env';
import { AppError } from './errors';

export interface SearchPolicy {
  ok: boolean;
  mode: 'expanded' | 'conserve';
  effectiveCap: number;
  remainingEstimate: number | null;
  checkedAt: string | null;
  fresh: boolean;
}

function accepted<T extends { ok?: boolean; code?: string }>(result: T): T {
  if (!result || result.ok === false) throw new AppError(result?.code || 'dependency_unavailable');
  return result;
}

// The free Account API returns credentials as well as quota metadata. The
// provider adapter projects only the validated balance and retrieval time.
// No account response or key is persisted or returned to the visitor.
export async function refreshSearchBalance(options: {
  force?: boolean;
  client?: SupabaseClient;
  inspect?: typeof inspectAccount;
} = {}): Promise<SearchPolicy> {
  const e = env();
  const client = options.client || db();
  const policy = async () => accepted(await rpc<SearchPolicy>('current_search_policy', { p_full_cap: e.INVESTIGATION_SEARCH_CAP }, client));
  const before = await policy();
  if (!options.force && before.fresh) return before;
  const bucket = await selectOne('budget_buckets', { id: 'global:serpapi' }, client);
  if (!bucket || e.SEARCH_ENABLED !== 'true' || !bucket.enabled) return before;
  const check = accepted(await rpc('begin_serpapi_balance_check', {}, client));
  try {
    const account = await (options.inspect || inspectAccount)({ apiKey: e.SERPAPI_API_KEY, timeoutMs: 5000 });
    accepted(await rpc('reconcile_serpapi_balance', {
      p_remaining: account.remaining, p_snapshot: check.snapshot, p_checked_at: account.checkedAt,
      p_protected_reserve: e.SERPAPI_PROTECTED_RESERVE, p_owner_cap: e.SERPAPI_OPERATIONAL_CAP,
      p_enabled: bucket.enabled, p_allow_increase: false,
    }, client));
  } catch (error) {
    // A failed refresh never invents a balance or enables/raises a budget.
    // SQL falls back to five once the last trusted observation is stale.
    if (error instanceof AppError && error.code === 'dependency_unavailable') throw error;
    console.warn(JSON.stringify({ event: 'search_balance_refresh_unavailable' }));
  }
  return policy();
}
