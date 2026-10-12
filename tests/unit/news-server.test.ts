import { beforeEach, describe, expect, it, vi } from "vitest";
import { hash, stable } from "../../lib/server/crypto";
import { AppError } from "../../lib/server/errors";
import { initialState, type JobRow } from "../../lib/workflow/state";
import type { NewsCheckResult } from "../../lib/news/contracts";

const mocks = vi.hoisted(() => ({
  selectOne: vi.fn(), rpc: vi.fn(), db: vi.fn(), rateLimit: vi.fn(), refreshBalance: vi.fn(), session: vi.fn(), advance: vi.fn(),
}));
vi.mock("../../lib/server/db", () => ({ selectOne: mocks.selectOne, rpc: mocks.rpc, db: mocks.db }));
vi.mock("../../lib/server/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("../../lib/server/search-balance", () => ({ refreshSearchBalance: mocks.refreshBalance }));
vi.mock("../../lib/server/session", () => ({ session: mocks.session }));
vi.mock("../../lib/workflow/news-runner", () => ({ advanceNewsCheck: mocks.advance }));
import { createNewsCheck, latestNewsCheck, newsCheckInput, newsCheckStepInput, ownedNewsCheck, publicNewsCheck } from "../../lib/server/news-check";
import { GET, POST } from "../../app/api/jobs/[id]/news-check/route";
import { POST as STEP } from "../../app/api/jobs/[id]/news-check/step/route";

const SESSION = "synthetic-private-session";
const PARENT_ID = "00000000-0000-4000-8000-000000000010";
const CHECK_ID = "00000000-0000-4000-8000-000000000011";
const OTHER_PARENT_ID = "00000000-0000-4000-8000-000000000012";
const KEY = "synthetic-idempotency-key";
const result: NewsCheckResult = {
  articles: [], retrievedAt: "2026-10-12T12:00:00Z", expiresAt: "2026-10-12T13:00:00Z", query: '"Synthetic Cafe" "Synthetic City" when:90d',
  providerSearchId: "synthetic-provider-id", briefGeneratedAt: "2026-10-11T12:00:00Z", limitations: ["No matching reports does not establish present conditions."],
};
function job(id = PARENT_ID, overrides: Partial<JobRow> = {}): JobRow {
  return { id, session_id: SESSION, kind: "investigation", venue_id: "synthetic-venue", input: { query: "synthetic-private-input" },
    state: initialState([{ feature: "accessible_restroom", priority: "must_have" }]), phase: "complete", state_version: 3,
    serp_cap: 26, serp_reserved: 4, llm_cap: 56, llm_reserved: 3, next_retry_at: null, stop_reason: null, ...overrides };
}
function check(overrides: Partial<JobRow> = {}): JobRow {
  return job(CHECK_ID, { kind: "news_check", input: { parentJobId: PARENT_ID, idempotencyKey: KEY, city: "synthetic-private-city" },
    state: { ...initialState(), newsResult: result, cacheHits: 1, newsErrorCode: null }, serp_cap: 1, serp_reserved: 1, llm_cap: 0, llm_reserved: 0, ...overrides });
}
function replay(overrides: Record<string, unknown> = {}): JobRow {
  return { ...check(), request_hash: hash(stable({ parentJobId: PARENT_ID, feature: "visit-watch-v1" })), ...overrides } as JobRow;
}
function ownedRows(...rows: JobRow[]) {
  mocks.selectOne.mockImplementation(async (_table: string, where: Record<string, string>) => {
    if (where.id) return rows.find((row) => row.id === where.id && row.session_id === where.session_id) ?? null;
    return null;
  });
}
function request(value: unknown, path = `/api/jobs/${PARENT_ID}/news-check`) {
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(value) });
}
const context = (id = PARENT_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks(); mocks.selectOne.mockReset(); mocks.rpc.mockReset(); mocks.db.mockReset(); mocks.session.mockReset(); mocks.advance.mockReset();
  mocks.rateLimit.mockResolvedValue(undefined); mocks.refreshBalance.mockResolvedValue(undefined); mocks.session.mockResolvedValue({ id: SESSION });
  process.env.VERIFICATION_MODE = "false";
});

describe("private explicit news-check service", () => {
  it("accepts only an idempotency key; venue/query/provider and allocation overrides are rejected", () => {
    expect(newsCheckInput.parse({ idempotencyKey: KEY })).toEqual({ idempotencyKey: KEY });
    for (const extra of ["venue", "venueId", "parentJobId", "query", "q", "city", "url", "engine", "api_key", "searchCap", "_allocation"]) {
      expect(newsCheckInput.safeParse({ idempotencyKey: KEY, [extra]: "synthetic-override" }).success).toBe(false);
    }
    expect(newsCheckInput.safeParse({ idempotencyKey: "short" }).success).toBe(false);
    expect(newsCheckInput.safeParse({ idempotencyKey: "x".repeat(101) }).success).toBe(false);
  });
  it("step inputs allow only a UUID check id and nonnegative integral version", () => {
    expect(newsCheckStepInput.parse({ checkId: CHECK_ID, expectedVersion: 0 })).toEqual({ checkId: CHECK_ID, expectedVersion: 0 });
    for (const value of [{ checkId: "not-a-uuid", expectedVersion: 0 }, { checkId: CHECK_ID, expectedVersion: -1 }, { checkId: CHECK_ID, expectedVersion: 1.5 }, { checkId: CHECK_ID, expectedVersion: 0, query: "synthetic-override" }]) {
      expect(newsCheckStepInput.safeParse(value).success).toBe(false);
    }
  });
  it("public projection excludes session material, private requirements and general job input/state", () => {
    const row = check(); row.state.requirements = [{ feature: "accessible_restroom", priority: "must_have" }]; row.state.lastMessage = "synthetic-private-state";
    const projected = publicNewsCheck(row);
    expect(projected).toEqual({ id: CHECK_ID, parentJobId: PARENT_ID, phase: "complete", stateVersion: 3, providerAttempts: 1, appCacheHits: 1,
      searchCap: 1, result, nextRetryAt: null, canResume: false, stopReason: null, errorCode: null });
    expect(JSON.stringify(projected)).not.toMatch(/synthetic-private|session_id|requirements|idempotencyKey|llm_cap|venue_id/);
  });
  it("terminal checks cannot resume while undispatched work can", () => {
    for (const phase of ["complete", "partial", "cancelled"] as const) expect(publicNewsCheck(check({ phase })).canResume).toBe(false);
    expect(publicNewsCheck(check({ phase: "targeted_search" })).canResume).toBe(true);
  });
  it("an idempotent replay returns its saved check without rate limiting, refreshing balance or reserving", async () => {
    const saved = replay();
    mocks.selectOne.mockResolvedValueOnce(job()).mockResolvedValueOnce(saved);
    expect(await createNewsCheck(SESSION, PARENT_ID, KEY)).toEqual(publicNewsCheck(saved));
    expect(mocks.selectOne).toHaveBeenNthCalledWith(2, "jobs", { session_id: SESSION, idempotency_key: KEY });
    expect(mocks.rateLimit).not.toHaveBeenCalled(); expect(mocks.refreshBalance).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("replay refuses another kind, another parent or a changed request hash before new work", async () => {
    for (const override of [{ kind: "investigation" }, { input: { parentJobId: OTHER_PARENT_ID } }, { request_hash: "synthetic-conflicting-hash" }]) {
      mocks.selectOne.mockReset().mockResolvedValueOnce(job()).mockResolvedValueOnce(replay(override));
      await expect(createNewsCheck(SESSION, PARENT_ID, KEY)).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    }
    expect(mocks.rateLimit).not.toHaveBeenCalled(); expect(mocks.refreshBalance).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("active or cancelled parent investigations cannot create a new news check", async () => {
    for (const phase of ["details", "assess", "finalize", "cancelled"] as const) {
      ownedRows(job(PARENT_ID, { phase }));
      await expect(createNewsCheck(SESSION, PARENT_ID, KEY)).rejects.toMatchObject({ code: "visit_brief_required", status: 409 });
    }
    expect(mocks.rateLimit).not.toHaveBeenCalled(); expect(mocks.refreshBalance).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["complete", "partial"] as const)("creates from a saved %s brief using only server-selected parameters", async (phase) => {
    ownedRows(job(PARENT_ID, { phase })); mocks.rpc.mockResolvedValue({ ok: true, job: check() });
    expect(await createNewsCheck(SESSION, PARENT_ID, KEY)).toEqual(publicNewsCheck(check()));
    expect(mocks.rateLimit).toHaveBeenCalledWith(`news-check:${SESSION}:${PARENT_ID}`, 2, 3600);
    expect(mocks.refreshBalance).toHaveBeenCalledWith({ force: true });
    expect(mocks.rpc).toHaveBeenCalledWith("create_news_check", { p_session_id: SESSION, p_parent_job_id: PARENT_ID, p_key: KEY,
      p_hash: hash(stable({ parentJobId: PARENT_ID, feature: "visit-watch-v1" })), p_allocation: "operations" });
  });
  it("the verification allocation is selected by server environment", async () => {
    process.env.VERIFICATION_MODE = "true"; ownedRows(job()); mocks.rpc.mockResolvedValue({ ok: true, job: check() });
    await createNewsCheck(SESSION, PARENT_ID, KEY);
    expect(mocks.rpc.mock.calls[0][1].p_allocation).toBe("verification");
  });
  it("a discovery job cannot be used as the parent", async () => {
    ownedRows(job(PARENT_ID, { kind: "discovery" }));
    await expect(createNewsCheck(SESSION, PARENT_ID, KEY)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("another private session cannot read the parent or its latest check", async () => {
    ownedRows(job()); await expect(latestNewsCheck("synthetic-other-session", PARENT_ID)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(mocks.selectOne).toHaveBeenCalledWith("jobs", { id: PARENT_ID, session_id: "synthetic-other-session" });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("child checks require the same owned parent, session and news-check kind", async () => {
    for (const row of [check({ input: { parentJobId: OTHER_PARENT_ID } }), check({ session_id: "synthetic-other-session" }), check({ kind: "investigation" })]) {
      ownedRows(job(), row);
      await expect(ownedNewsCheck(SESSION, PARENT_ID, CHECK_ID)).rejects.toMatchObject({ code: "not_found", status: 404 });
    }
    ownedRows(job(), check()); expect(await ownedNewsCheck(SESSION, PARENT_ID, CHECK_ID)).toEqual(check());
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("latest-check query is constrained to private session, exact parent and news-check kind", async () => {
    ownedRows(job());
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query); query.limit.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: check(), error: null }); const from = vi.fn(() => query); mocks.db.mockReturnValue({ from });
    expect(await latestNewsCheck(SESSION, PARENT_ID)).toEqual(publicNewsCheck(check()));
    expect(from).toHaveBeenCalledWith("jobs"); expect(query.eq.mock.calls).toEqual([["session_id", SESSION], ["kind", "news_check"], ["input->>parentJobId", PARENT_ID]]);
    expect(query.limit).toHaveBeenCalledWith(1); expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});

describe("private news-check HTTP boundaries", () => {
  it("an arbitrary-query request fails before database or provider work", async () => {
    const response = await POST(request({ idempotencyKey: KEY, q: "synthetic-injected-query" }), context());
    expect(response.status).toBe(400); expect((await response.json()).error.code).toBe("invalid_request");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.selectOne).not.toHaveBeenCalled(); expect(mocks.rateLimit).not.toHaveBeenCalled(); expect(mocks.refreshBalance).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("mutations pass the actual request to private-session authorization", async () => {
    ownedRows(job()); mocks.rpc.mockResolvedValue({ ok: true, job: check() }); const incoming = request({ idempotencyKey: KEY });
    const response = await POST(incoming, context()); expect(response.status).toBe(200); expect(mocks.session).toHaveBeenCalledWith(incoming);
    expect((await response.json()).check.parentJobId).toBe(PARENT_ID);
  });
  it("an expired private session fails before all new work", async () => {
    mocks.session.mockRejectedValue(new AppError("unauthenticated", 401));
    const response = await POST(request({ idempotencyKey: KEY }), context()); expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
    expect(mocks.selectOne).not.toHaveBeenCalled(); expect(mocks.refreshBalance).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("malformed parent ids are concealed as not found before database queries", async () => {
    const response = await GET(new Request("http://localhost:3000/api/x"), context("synthetic-not-a-uuid"));
    expect(response.status).toBe(404); expect(mocks.selectOne).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("a child from another parent cannot advance or touch provider budgets", async () => {
    ownedRows(job(), check({ input: { parentJobId: OTHER_PARENT_ID } }));
    const response = await STEP(request({ checkId: CHECK_ID, expectedVersion: 3 }), context());
    expect(response.status).toBe(404); expect(mocks.advance).not.toHaveBeenCalled(); expect(mocks.refreshBalance).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("step requests reject arbitrary provider data before claiming the check", async () => {
    const response = await STEP(request({ checkId: CHECK_ID, expectedVersion: 3, engine: "synthetic-injected-engine" }), context());
    expect(response.status).toBe(400); expect(mocks.selectOne).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled();
  });
});
