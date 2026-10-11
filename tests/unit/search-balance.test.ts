import { beforeEach, expect, it, vi } from 'vitest';
import { refreshSearchBalance } from '../../lib/server/search-balance';
const mocks = vi.hoisted(() => ({
  policy: { ok: true, mode: 'conserve', effectiveCap: 5, remainingEstimate: null, checkedAt: null, fresh: false } as any,
  enabled: true, calls: [] as { name: string; args: any }[], down: false,
}));
vi.mock('../../lib/server/db', () => ({
  db: vi.fn(), selectOne: vi.fn(async () => ({ enabled: mocks.enabled })),
  rpc: vi.fn(async (name: string, args: any) => {
    mocks.calls.push({ name, args });
    if (mocks.down) throw Object.assign(new Error(), { code: 'dependency_unavailable' });
    if (name === 'current_search_policy') return mocks.policy;
    if (name === 'begin_serpapi_balance_check') return { ok: true, snapshot: { sequence: 7, pending: 2, startedAt: '2026-10-11T08:00:00Z' } };
    if (name === 'reconcile_serpapi_balance') return { ok: true };
    throw new Error(name);
  }),
}));
beforeEach(() => {
  Object.assign(process.env, { SERPAPI_API_KEY: 'test-only', GEMINI_API_KEY: 'test-only', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', DEMO_ACCESS_CODE: 'test-code', ADMIN_API_SECRET: 'a'.repeat(32), SESSION_HMAC_SECRET: 'b'.repeat(32), RATE_LIMIT_HMAC_SECRET: 'c'.repeat(32), APP_ORIGIN: 'http://localhost:3000', SEARCH_ENABLED: 'true' });
  mocks.policy = { ok: true, mode: 'conserve', effectiveCap: 5, remainingEstimate: null, checkedAt: null, fresh: false };
  mocks.enabled = true; mocks.calls = []; mocks.down = false;
});
const client = {} as any;
it('fresh shared observations avoid another free account request', async () => {
  mocks.policy = { ...mocks.policy, mode: 'expanded', effectiveCap: 26, remainingEstimate: 239, fresh: true };
  const inspect = vi.fn();
  const result = await refreshSearchBalance({ client, inspect });
  expect(result).toEqual(mocks.policy); expect(inspect).not.toHaveBeenCalled();
  expect(mocks.calls.map(call => call.name)).toEqual(['current_search_policy']);
});
it('new jobs force a real check and pass the reservation snapshot without raising budgets', async () => {
  mocks.policy.fresh = true;
  const inspect = vi.fn(async () => ({ remaining: 239, checkedAt: '2026-10-11T08:00:01Z' }));
  await refreshSearchBalance({ force: true, client, inspect });
  expect(inspect).toHaveBeenCalledWith({ apiKey: 'test-only', timeoutMs: 5000 });
  const reconciliation = mocks.calls.find(call => call.name === 'reconcile_serpapi_balance')!.args;
  expect(reconciliation).toMatchObject({ p_remaining: 239, p_snapshot: { sequence: 7, pending: 2 }, p_allow_increase: false, p_enabled: true });
  expect(JSON.stringify(reconciliation)).not.toContain('test-only');
});
it('an unavailable account check leaves unknown balance and never records a made-up value', async () => {
  const inspect = vi.fn(async () => { throw new Error('synthetic timeout'); });
  const result = await refreshSearchBalance({ client, inspect });
  expect(result.remainingEstimate).toBeNull(); expect(result.effectiveCap).toBe(5);
  expect(mocks.calls.some(call => call.name === 'reconcile_serpapi_balance')).toBe(false);
});
it('disabled database searches remain disabled without calling the account endpoint', async () => {
  mocks.enabled = false; const inspect = vi.fn();
  await refreshSearchBalance({ force: true, client, inspect });
  expect(inspect).not.toHaveBeenCalled(); expect(mocks.calls.map(call => call.name)).toEqual(['current_search_policy']);
});
it('the environment kill switch prevents account refresh and budget reactivation', async () => {
  process.env.SEARCH_ENABLED = 'false'; const inspect = vi.fn();
  await refreshSearchBalance({ client, inspect });
  expect(inspect).not.toHaveBeenCalled(); expect(mocks.calls.some(call => call.name === 'reconcile_serpapi_balance')).toBe(false);
});
it('database failure occurs before any provider account request', async () => {
  mocks.down = true; const inspect = vi.fn();
  await expect(refreshSearchBalance({ client, inspect })).rejects.toThrow(); expect(inspect).not.toHaveBeenCalled();
});
