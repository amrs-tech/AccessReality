/** Synthetic unit fixtures only; no network or durable production state is used. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Venue } from '../../lib/contracts';
import type { JobRow } from '../../lib/workflow/state';
import { initialState } from '../../lib/workflow/state';
import { advanceNewsCheck } from '../../lib/workflow/news-runner';
import { ProviderError } from '../../lib/providers/errors';
import { AppError } from '../../lib/server/errors';

const mock = vi.hoisted(() => ({
  job: null as any, calls: [] as { name: string; args: any }[], saves: [] as any[],
  claimReply: null as any, cacheReply: null as any, cacheRow: null as any,
  deny: null as string | null, markDenial: null as string | null, downAt: null as string | null,
  databaseNow: 0, dispatched: false,
}));
vi.mock('../../lib/server/db', () => ({
  db: vi.fn(), selectOne: vi.fn(async () => mock.cacheRow),
  rpc: vi.fn(async (name: string, args: any) => {
    mock.calls.push({ name, args });
    if (mock.downAt === name) throw new AppError('dependency_unavailable');
    if (name === 'claim_step') {
      if (mock.claimReply) return mock.claimReply;
      if (['complete', 'partial', 'cancelled'].includes(mock.job.phase)) return { ok: false, code: 'terminal', job: structuredClone(mock.job) };
      mock.dispatched = false;
      return { ok: true, lease_token: 'synthetic-news-lease', job: { ...structuredClone(mock.job), lease_until: new Date(mock.databaseNow + 75000).toISOString() } };
    }
    if (name === 'reserve_provider_attempt') {
      if (mock.deny) return { ok: false, code: mock.deny };
      if (mock.cacheReply) return { ok: true, kind: 'cache', ...mock.cacheReply };
      mock.job.serp_reserved++;
      return { ok: true, kind: 'reserved', attempt_id: randomUUID() };
    }
    if (name === 'mark_dispatch') {
      if (mock.markDenial) { mock.job.serp_reserved--; return { ok: false, code: mock.markDenial }; }
      mock.dispatched = true; return { ok: true };
    }
    if (name === 'reconcile_expired_cache') return { ok: true };
    if (name === 'commit_step' || name === 'fail_step') {
      mock.saves.push(args);
      // Simulate PostgreSQL's undispatched-only release and ambiguity terminalization.
      if (name === 'fail_step' && args.p_attempt_id && !mock.dispatched && !mock.markDenial) mock.job.serp_reserved--;
      mock.job = { ...mock.job, state: args.p_state, phase: args.p_uncertain ? 'partial' : args.p_phase,
        state_version: mock.job.state_version + 1, next_retry_at: args.p_retry_at ?? null,
        stop_reason: args.p_uncertain ? 'ambiguous_dispatch' : args.p_stop_reason ?? (args.p_phase === 'partial' ? 'upstream_unavailable' : null) };
      return { ok: true, job: structuredClone(mock.job) };
    }
    throw new Error(`Unexpected RPC ${name}`);
  }),
}));
const venue: Venue = { id: '00000000-0000-4000-8000-000000000002', name: 'Synthetic test venue', address: 'Synthetic City',
  googlePlaceId: 'synthetic-place', dataId: 'synthetic-data', dataCid: null, website: null, phone: null, category: null,
  sourceUrl: 'https://example.test/synthetic-listing', latitude: null, longitude: null, rating: null, provisional: false };
const retrievedAt = '2026-10-12T10:00:00.000Z';
const emptySearch = () => vi.fn(async () => ({ payload: { search_metadata: { id: 'synthetic-news-search', status: 'Success' }, news_results: [] },
  providerSearchId: 'synthetic-news-search', retrievedAt, durationMs: 1 }));
const client = { from: () => { throw new Error('The auxiliary runner must not directly query or mutate evidence tables'); } } as any;
const advance = (search = emptySearch(), refreshCredits?: () => Promise<unknown>) =>
  advanceNewsCheck(mock.job.session_id, mock.job.id, mock.job.state_version, { client, search, refreshCredits });

beforeEach(() => {
  Object.assign(process.env, { SERPAPI_API_KEY: 'synthetic-provider-secret', GEMINI_API_KEY: 'synthetic-gemini-secret',
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-storage-secret', DEMO_ACCESS_CODE: 'test-code',
    ADMIN_API_SECRET: 'a'.repeat(32), SESSION_HMAC_SECRET: 'b'.repeat(32), RATE_LIMIT_HMAC_SECRET: 'c'.repeat(32),
    APP_ORIGIN: 'http://localhost:3000', SEARCH_ENABLED: 'true' });
  Object.assign(mock, { calls: [], saves: [], claimReply: null, cacheReply: null, cacheRow: null, deny: null, markDenial: null,
    downAt: null, databaseNow: Date.now(), dispatched: false });
  mock.job = { id: randomUUID(), session_id: 'synthetic-private-session', kind: 'news_check', venue_id: venue.id,
    input: { parentJobId: randomUUID(), city: 'Synthetic City', briefGeneratedAt: '2026-10-10T10:00:00Z', _allocation: 'verification' },
    state: initialState([], venue), phase: 'targeted_search', state_version: 0, serp_cap: 2, serp_full_cap: 2, serp_reserved: 0,
    llm_cap: 0, llm_reserved: 0, step_cap: 4, search_mode: 'legacy', next_retry_at: null, stop_reason: null } satisfies JobRow;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

it('a denied atomic allowance checkpoints unavailable news with zero provider dispatches', async () => {
  mock.deny = 'budget_exhausted'; const search = emptySearch(); const result = await advance(search);
  expect(search).not.toHaveBeenCalled(); expect(mock.calls.map(call => call.name)).not.toContain('mark_dispatch');
  expect(result.phase).toBe('partial'); expect(result.state.newsErrorCode).toBe('budget_exhausted');
  expect(result.serp_reserved).toBe(0); expect(mock.saves[0]).toMatchObject({ p_attempt_id: null, p_uncertain: false, p_retry_at: null });
});

it('database failure before a lease dispatches nothing and writes no checkpoint', async () => {
  mock.downAt = 'claim_step'; const search = emptySearch();
  await expect(advance(search)).rejects.toMatchObject({ code: 'dependency_unavailable' });
  expect(search).not.toHaveBeenCalled(); expect(mock.saves).toEqual([]); expect(mock.calls.map(call => call.name)).toEqual(['claim_step']);
});

it('a successful empty news check commits no accessibility sources, claims, report or Gemini request', async () => {
  const search = emptySearch(); const result = await advance(search); const saved = mock.saves[0];
  expect(result.phase).toBe('complete'); expect(result.state.newsResult?.articles).toEqual([]);
  expect(result.state.newsResult?.retrievedAt).toBe(retrievedAt); expect(result.state.report).toBeNull();
  expect(result.state.sources).toEqual([]); expect(result.state.claims).toEqual([]);
  expect(saved).toMatchObject({ p_sources: [], p_claims: [], p_report: null, p_cache_ttl: 3600, p_phase: 'complete' });
  expect(mock.calls.filter(call => call.name === 'reserve_provider_attempt').map(call => call.args.p_provider)).toEqual(['serpapi']);
  expect(result.llm_reserved).toBe(0); expect(search).toHaveBeenCalledTimes(1);
  expect(mock.calls.map(call => call.name)).toEqual(['claim_step', 'reserve_provider_attempt', 'mark_dispatch', 'commit_step']);
  expect(JSON.stringify(mock.calls)).not.toMatch(/synthetic-provider-secret|synthetic-gemini-secret|synthetic-storage-secret/);
});

it('cached news retains its original retrieval time and consumes zero attempts even at the job cap', async () => {
  const originalTime = '2026-10-11T10:00:00Z'; mock.job.serp_reserved = 2;
  mock.cacheReply = { payload: { search_metadata: { id: 'synthetic-cached-search' }, news_results: [] }, retrieved_at: originalTime };
  const search = emptySearch(); const result = await advance(search);
  expect(search).not.toHaveBeenCalled(); expect(mock.calls.map(call => call.name)).not.toContain('mark_dispatch');
  expect(result.state.newsResult?.retrievedAt).toBe('2026-10-11T10:00:00.000Z');
  expect(result.state.newsResult?.expiresAt).toBe('2026-10-11T11:00:00.000Z');
  expect(result.state.newsResult?.providerSearchId).toBe('synthetic-cached-search');
  expect(result.serp_reserved).toBe(2); expect(result.state.cacheHits).toBe(1);
  expect(mock.saves[0]).toMatchObject({ p_attempt_id: null, p_payload: null });
});

it('a known 429 failure retries once, consumes both attempts and does not create a third retry', async () => {
  const search = vi.fn(async () => { throw new ProviderError('quota', 'Synthetic HTTP 429', true, false, 4); });
  const first = await advance(search);
  expect(first.phase).toBe('targeted_search'); expect(first.serp_reserved).toBe(1);
  expect(first.next_retry_at).not.toBeNull(); expect(mock.saves[0].p_uncertain).toBe(false);
  const second = await advance(search);
  expect(second.phase).toBe('partial'); expect(second.serp_reserved).toBe(2); expect(second.next_retry_at).toBeNull();
  expect(search).toHaveBeenCalledTimes(2); expect(second.state.retryCounts.CHECK_VISIT_NEWS).toBe(2);
  await advance(search); expect(search).toHaveBeenCalledTimes(2);
});

it('an uncertain provider timeout stays counted and terminal and cannot replay on resume', async () => {
  const search = vi.fn(async () => { throw new ProviderError('timeout', 'Synthetic uncertain timeout', false, true); });
  const first = await advance(search); expect(first.phase).toBe('partial'); expect(first.stop_reason).toBe('ambiguous_dispatch');
  expect(first.serp_reserved).toBe(1); expect(first.next_retry_at).toBeNull(); expect(mock.saves[0].p_uncertain).toBe(true);
  const again = await advance(search); expect(again.phase).toBe('partial'); expect(search).toHaveBeenCalledTimes(1);
  expect(mock.calls.filter(call => call.name === 'reserve_provider_attempt')).toHaveLength(1);
});

it('a delayed preflight releases reserved work before marking dispatch or claiming provider ambiguity', async () => {
  let now = 0; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const search = emptySearch(); const result = await advance(search, async () => { now = 19000; });
  expect(search).not.toHaveBeenCalled(); expect(mock.calls.map(call => call.name)).not.toContain('mark_dispatch');
  expect(mock.saves[0]).toMatchObject({ p_code: 'deadline_before_dispatch', p_uncertain: false, p_retry_at: null });
  expect(result.serp_reserved).toBe(0); expect(result.phase).toBe('partial');
});

it('a kill switch between reservation and dispatch preserves PostgreSQL release and records a safe checkpoint', async () => {
  mock.markDenial = 'search_disabled'; const search = emptySearch(); const result = await advance(search);
  expect(search).not.toHaveBeenCalled(); expect(result.serp_reserved).toBe(0);
  expect(mock.saves[0]).toMatchObject({ p_code: 'search_disabled', p_uncertain: false }); expect(result.phase).toBe('partial');
});

it.each(['version_conflict', 'not_found', 'busy'])('a %s claim result writes nothing and never dispatches', async code => {
  mock.claimReply = { ok: false, code }; const search = emptySearch();
  await expect(advance(search)).rejects.toMatchObject({ code }); expect(search).not.toHaveBeenCalled();
  expect(mock.saves).toEqual([]); expect(mock.calls.map(call => call.name)).toEqual(['claim_step']);
});

it.each(['terminal', 'ambiguous_dispatch'])('a %s claim returns the durable terminal job without replay', async code => {
  mock.claimReply = { ok: false, code, job: { ...mock.job, phase: 'partial', stop_reason: code } };
  const search = emptySearch(); const result = await advance(search);
  expect(result.phase).toBe('partial'); expect(result.stop_reason).toBe(code); expect(search).not.toHaveBeenCalled(); expect(mock.saves).toEqual([]);
});

it.each([-30000, 30000])('known-failure retry uses database lease time with host clock skew of %d milliseconds', async skew => {
  const databaseStart = Date.parse('2026-10-12T10:00:00Z'); let hostNow = databaseStart + skew;
  mock.databaseNow = databaseStart; vi.spyOn(Date, 'now').mockImplementation(() => hostNow);
  const search = vi.fn(async () => { hostNow += 1000; throw new ProviderError('quota', 'Synthetic 429', true, false, 4); });
  const result = await advance(search);
  expect(result.next_retry_at).toBe(new Date(databaseStart + 5000).toISOString());
  expect(mock.saves[0].p_uncertain).toBe(false); expect(result.phase).toBe('targeted_search');
});

it('searches disabled in the environment can reuse a fresh application cache without dispatch', async () => {
  process.env.SEARCH_ENABLED = 'false';
  mock.cacheRow = { sanitized_payload: { news_results: [] }, expires_at: new Date(Date.now() + 10000).toISOString() };
  mock.cacheReply = { payload: { news_results: [] }, retrieved_at: retrievedAt };
  const search = emptySearch(); const result = await advance(search);
  expect(search).not.toHaveBeenCalled(); expect(result.phase).toBe('complete'); expect(result.state.cacheHits).toBe(1);
});
