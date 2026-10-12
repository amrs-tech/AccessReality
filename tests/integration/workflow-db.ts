/** Synthetic test fixtures only. Tests execute actual PostgreSQL transactions and parallel connections. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvidenceImage, Source } from "../../lib/contracts";

type Json = Record<string, any>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function runDatabaseTests(admin: Pool, server: Pool, connection: PoolConfig) {
  let passed = 0;
  const tables = ["attempt_budget_reservations", "provider_cache", "evidence_claims", "assessments", "job_sources", "source_snapshots",
    "provider_attempts", "job_events", "jobs", "demo_sessions", "venues", "budget_buckets", "rate_limit_buckets"];
  const reset = async (cap = 50) => {
    await admin.query(`truncate ${tables.map((name) => `public.${name}`).join(",")} restart identity cascade`);
    await admin.query("insert into public.budget_buckets(id,limit_units,enabled) values('global:serpapi',$1,true),('global:gemini',50,true)", [cap]);
  };
  const rpc = async (name: string, values: unknown[]): Promise<Json> => {
    assert.match(name, /^[a-z_]+$/);
    const result = await server.query(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as result`,
      values.map((value) => Array.isArray(value) ? JSON.stringify(value) : value));
    return result.rows[0].result;
  };
  const session = async () => {
    const id = randomUUID();
    await server.query("insert into public.demo_sessions(id,token_hash) values($1,$2)", [id, hash(id)]);
    return id;
  };
  const create = async (sessionId: string, kind = "discovery", key = randomUUID()): Promise<Json> => {
    const venueId = kind === "investigation" ? randomUUID() : null;
    const state = venueId ? { venue: { id: venueId, name: "Synthetic Test Venue", address: "Synthetic address", googlePlaceId: `synthetic-${venueId}`, dataId: null, dataCid: null } } : {};
    const response = await rpc("create_job", [sessionId, key, hash(key), kind, venueId, {}, state]);
    assert.equal(response.ok, true);
    return response.job;
  };
  const lease = async (job: Json): Promise<Json> => {
    const result = await rpc("claim_step", [job.session_id, job.id, job.state_version]);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const reserve = (job: Json, token: string, key = hash(randomUUID()), action = "FETCH_DETAILS", provider = "serpapi") =>
    rpc("reserve_provider_attempt", [job.id, token, action, provider, key, { engine: "google_maps", q: "synthetic test" }, "google_maps", 21600]);
  const commit = (job: Json, token: string, attempt: string | null, options: Json = {}) => rpc("commit_step", [job.id, token,
    job.state_version, options.phase ?? "complete", options.state ?? {}, attempt, options.payload ?? { providerSearchId: "synthetic-search-id" },
    options.sources ?? [], options.claims ?? [], options.report ?? null, options.stop ?? "no_eligible_actions", 21600]);
  const observedAt = (snapshot: Json) => new Date(Math.max(Date.now(), Date.parse(snapshot.startedAt) + 2)).toISOString();
  const observe = async (remaining: number, allowIncrease = true) => {
    const begun = await rpc("begin_serpapi_balance_check", []);
    const result = await rpc("reconcile_serpapi_balance", [remaining, begun.snapshot, observedAt(begun.snapshot), 30, 400, true, allowIncrease]);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  };
  const searchStep = async (job: Json, action: string, cache: string | null = null) => {
    const held = await lease(job);
    const attempt = await reserve(job, held.lease_token, cache as unknown as string, action);
    assert.equal(attempt.ok, true, JSON.stringify(attempt));
    assert.equal((await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token])).ok, true);
    const saved = await commit(job, held.lease_token, attempt.attempt_id, { phase: "reviews", stop: null });
    assert.equal(saved.ok, true);
    return saved.job;
  };
  const test = async (name: string, action: () => Promise<void>) => {
    await reset();
    await action();
    passed++;
    console.log(`PASS ${name}`);
  };

  await test("RLS and grants deny browser tables and every internal RPC (T27)", async () => {
    const rows = await admin.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'");
    assert.equal(rows.rows.length, tables.length);
    assert.ok(rows.rows.every((row) => row.relrowsecurity));
    const anon = new Pool({ ...connection, options: "-c role=anon" });
    const authenticated = new Pool({ ...connection, options: "-c role=authenticated" });
    try {
      for (const pool of [anon, authenticated]) {
        await assert.rejects(pool.query("select * from public.jobs"), /permission denied/);
        await assert.rejects(pool.query("select public.consume_rate_limit('test',5,60)"), /permission denied/);
        await assert.rejects(pool.query("select public.current_search_policy()"), /permission denied/);
        await assert.rejects(pool.query("select public.begin_serpapi_balance_check()"), /permission denied/);
        await assert.rejects(pool.query("select public.reconcile_serpapi_balance(200,'{}',now(),30,220,true)"), /permission denied/);
      }
      const grants = await admin.query("select proname,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,prosecdef from pg_proc p where pronamespace='public'::regnamespace and proname in ('create_job','claim_step','reserve_provider_attempt','mark_dispatch','commit_step','fail_step','cancel_job','save_assessment','reconcile_budget','retention_cleanup')");
      assert.equal(grants.rows.length, 10);
      assert.ok(grants.rows.every((row) => !row.anon && !row.authenticated && !row.prosecdef));
    } finally { await anon.end(); await authenticated.end(); }
  });

  await test("Concurrent idempotent create returns one job; changed input conflicts", async () => {
    const sid = await session();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("create_job", [sid, key, hash(key), "discovery", null, {}, {}])));
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.job.id)).size, 1);
    assert.equal((await rpc("create_job", [sid, key, hash("different"), "discovery", null, {}, {}])).code, "idempotency_conflict");
  });

  await test("Ten concurrent final-credit reservations allow one actual fake dispatch (T20/T21)", async () => {
    await admin.query("update public.budget_buckets set limit_units=1 where id='global:serpapi'");
    const fixtures = await Promise.all(Array.from({ length: 10 }, async () => {
      const job = await create(await session()); return { job, lease: await lease(job) };
    }));
    let dispatches = 0;
    const instrumentedProvider = async () => { dispatches++; return { providerSearchId: "synthetic" }; };
    const results = await Promise.all(fixtures.map(async ({ job, lease: held }) => {
      const reservation = await reserve(job, held.lease_token);
      if (reservation.ok && reservation.kind === "reserved") {
        assert.equal((await rpc("mark_dispatch", [reservation.attempt_id, held.lease_token])).ok, true);
        await instrumentedProvider();
      }
      return reservation;
    }));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(dispatches, 1);
    const buckets = (await admin.query("select * from public.budget_buckets")).rows;
    assert.ok(buckets.every((bucket) => bucket.reserved_units >= 0 && bucket.reserved_units <= bucket.limit_units));
    assert.equal(buckets.find((bucket) => bucket.id === "global:serpapi").reserved_units, 1);
  });

  await test("Separate discoveries of the same opaque place ID or CID resolve one venue without name matching", async () => {
    for (const identity of ["place", "cid"]) {
      const sid = await session(); const providerId = `synthetic-${identity}-${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 2 }, () => {
        const venueId = randomUUID(); const key = randomUUID();
        return rpc("create_job", [sid, key, hash(key), "investigation", venueId, {}, { venue: {
          id: venueId, name: "Same Synthetic Name", googlePlaceId: identity === "place" ? providerId : null,
          dataCid: identity === "cid" ? providerId : null, dataId: null } }]);
      }));
      assert.ok(results.every((result) => result.ok));
      assert.equal(results[0].job.venue_id, results[1].job.venue_id);
      assert.equal(results[0].job.state.venue.id, results[0].job.venue_id);
      assert.equal(results[1].job.state.venue.id, results[1].job.venue_id);
    }
    assert.equal((await server.query("select count(*)::integer count from public.venues")).rows[0].count, 2);
  });

  await test("Atomic session/day/job caps reject attempts without dispatch", async () => {
    const sid = await session(); const job = await create(sid); const held = await lease(job);
    const result = await reserve(job, held.lease_token);
    assert.equal(result.ok, true);
    assert.equal((await rpc("mark_dispatch", [result.attempt_id, held.lease_token])).ok, true);
    await commit(job, held.lease_token, result.attempt_id, { phase: "reviews", stop: null });
    const current = (await server.query("select * from public.jobs where id=$1", [job.id])).rows[0];
    const next = await lease(current);
    assert.equal((await reserve(current, next.lease_token, undefined, "DIFFERENT_ACTION")).code, "budget_exhausted");
    await admin.query("update public.budget_buckets set limit_units=reserved_units where id=$1", [`session:${sid}:serpapi`]);
    const second = await create(sid); const secondLease = await lease(second);
    assert.equal((await reserve(second, secondLease.lease_token)).code, "budget_exhausted");
    await admin.query("update public.budget_buckets set limit_units=reserved_units where id like 'day:%:serpapi'");
    const third = await create(await session()); const thirdLease = await lease(third);
    assert.equal((await reserve(third, thirdLease.lease_token)).code, "budget_exhausted");
  });

  await test("CID-only venue safely gains a newly observed place ID across concurrent discoveries", async () => {
    const sid = await session(); const cid = `synthetic-cid-${randomUUID()}`; const place = `synthetic-place-${randomUUID()}`;
    const discovery = (googlePlaceId: string | null, dataCid: string | null) => {
      const venueId = randomUUID(); const key = randomUUID();
      return rpc("create_job", [sid, key, hash(key), "investigation", venueId, {}, { venue: {
        id: venueId, name: "Synthetic enrichment venue", googlePlaceId, dataCid, dataId: null } }]);
    };
    const original = await discovery(null, cid);
    assert.equal(original.ok, true);
    const enriched = await Promise.all([discovery(place, cid), discovery(place, cid)]);
    assert.ok(enriched.every((result) => result.ok));
    assert.ok(enriched.every((result) => result.job.venue_id === original.job.venue_id));
    assert.ok(enriched.every((result) => result.job.state.venue.id === original.job.venue_id));
    const placeOnly = await discovery(place, null);
    assert.equal(placeOnly.job.venue_id, original.job.venue_id);
    const venue = (await server.query("select * from public.venues where id=$1", [original.job.venue_id])).rows[0];
    assert.equal(venue.google_place_id, place);
    assert.equal(venue.data_cid, cid);
    assert.equal((await server.query("select count(*)::integer count from public.venues")).rows[0].count, 1);
    assert.equal((await discovery(`different-${randomUUID()}`, cid)).code, "venue_identity_conflict");
    assert.equal((await discovery(place, `different-${randomUUID()}`)).code, "venue_identity_conflict");
  });

  await test("Conflicting identifiers attached to two existing venues cannot merge them", async () => {
    const sid = await session(); const place = `synthetic-place-${randomUUID()}`; const cid = `synthetic-cid-${randomUUID()}`;
    const discovery = (googlePlaceId: string | null, dataCid: string | null) => {
      const venueId = randomUUID(); const key = randomUUID();
      return rpc("create_job", [sid, key, hash(key), "investigation", venueId, {}, { venue: {
        id: venueId, name: "Identical synthetic name", googlePlaceId, dataCid, dataId: null } }]);
    };
    const placeJob = await discovery(place, null); const cidJob = await discovery(null, cid);
    assert.notEqual(placeJob.job.venue_id, cidJob.job.venue_id);
    assert.equal((await discovery(place, cid)).code, "venue_identity_conflict");
    assert.equal((await server.query("select count(*)::integer count from public.venues")).rows[0].count, 2);
    assert.equal((await server.query("select data_cid from public.venues where id=$1", [placeJob.job.venue_id])).rows[0].data_cid, null);
    assert.equal((await server.query("select google_place_id from public.venues where id=$1", [cidJob.job.venue_id])).rows[0].google_place_id, null);
  });

  await test("Duplicate version obtains one lease and completed action cannot replay (T22/T29)", async () => {
    const job = await create(await session());
    const calls = await Promise.all([rpc("claim_step", [job.session_id, job.id, 0]), rpc("claim_step", [job.session_id, job.id, 0])]);
    assert.equal(calls.filter((call) => call.ok).length, 1);
    assert.equal(calls.filter((call) => call.code === "busy").length, 1);
    const held = calls.find((call) => call.ok)!;
    const reserved = await reserve(job, held.lease_token);
    await rpc("mark_dispatch", [reserved.attempt_id, held.lease_token]);
    const saved = await commit(job, held.lease_token, reserved.attempt_id, { phase: "reviews", stop: null });
    const next = await lease(saved.job);
    assert.equal((await reserve(saved.job, next.lease_token)).code, "action_completed");
  });

  await test("Crash after dispatch consumes uncertain attempt and stale commit is rejected (T23/T24)", async () => {
    const job = await create(await session()); const held = await lease(job);
    const attempt = await reserve(job, held.lease_token);
    await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]);
    await admin.query("update public.jobs set lease_until=now()-interval '1 second' where id=$1", [job.id]);
    const resumed = await rpc("claim_step", [job.session_id, job.id, 0]);
    assert.equal(resumed.code, "ambiguous_dispatch");
    assert.equal(resumed.job.phase, "partial");
    assert.equal((await server.query("select status from public.provider_attempts where id=$1", [attempt.attempt_id])).rows[0].status, "uncertain");
    assert.equal((await commit(job, held.lease_token, attempt.attempt_id)).code, "stale_lease");
    assert.equal((await server.query("select reserved_units from public.budget_buckets where id='global:serpapi'")).rows[0].reserved_units, 1);
  });

  await test("Undispatched expired lease releases every counter with audit; stale holder loses (T24)", async () => {
    const job = await create(await session()); const held = await lease(job);
    const attempt = await reserve(job, held.lease_token);
    await admin.query("update public.jobs set lease_until=now()-interval '1 second' where id=$1", [job.id]);
    const resumed = await rpc("claim_step", [job.session_id, job.id, 0]);
    assert.equal(resumed.ok, true);
    assert.notEqual(resumed.lease_token, held.lease_token);
    assert.equal((await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token])).ok, false);
    assert.equal((await server.query("select count(*)::integer count from public.attempt_budget_reservations where released_at is not null")).rows[0].count, 3);
    assert.ok((await server.query("select reserved_units from public.budget_buckets")).rows.every((bucket) => bucket.reserved_units === 0));
  });

  await test("Concurrent same cache key has one dispatch; second reuses committed cache (T25)", async () => {
    const key = hash("synthetic shared cache");
    const fixtures = await Promise.all(Array.from({ length: 2 }, async () => { const job = await create(await session()); return { job, held: await lease(job) }; }));
    const results = await Promise.all(fixtures.map(({ job, held }) => reserve(job, held.lease_token, key)));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.code === "busy").length, 1);
    const winner = results.findIndex((result) => result.ok); const loser = 1 - winner;
    await rpc("mark_dispatch", [results[winner].attempt_id, fixtures[winner].held.lease_token]);
    await commit(fixtures[winner].job, fixtures[winner].held.lease_token, results[winner].attempt_id);
    const reused = await reserve(fixtures[loser].job, fixtures[loser].held.lease_token, key);
    assert.equal(reused.kind, "cache");
    assert.equal(reused.payload.providerSearchId, "synthetic-search-id");
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, 1);
  });

  await test("Another/expired session cannot lease, cancel or reassess private job (T26)", async () => {
    const sid = await session(); const other = await session(); const job = await create(sid, "investigation");
    assert.equal((await rpc("claim_step", [other, job.id, 0])).code, "not_found");
    assert.equal((await rpc("cancel_job", [other, job.id])).code, "not_found");
    assert.equal((await rpc("save_assessment", [other, job.id, 0, hash("profile"), [], "test-v1", {}, true])).code, "not_found");
    await admin.query("update public.demo_sessions set expires_at=now()-interval '1 hour',created_at=now()-interval '1 day' where id=$1", [sid]);
    assert.equal((await rpc("claim_step", [sid, job.id, 0])).code, "not_found");
  });

  await test("Abandoned cache lease reconciles without replaying possibly dispatched work", async () => {
    for (const dispatched of [false, true]) {
      const key = hash(`synthetic abandoned cache ${dispatched}`);
      const first = await create(await session()); const firstLease = await lease(first);
      const attempt = await reserve(first, firstLease.lease_token, key);
      if (dispatched) await rpc("mark_dispatch", [attempt.attempt_id, firstLease.lease_token]);
      await admin.query("update public.jobs set lease_until=now()-interval '1 second' where id=$1", [first.id]);
      await admin.query("update public.provider_cache set lease_until=now()-interval '1 second' where cache_key=$1", [key]);
      const second = await create(await session()); const secondLease = await lease(second);
      const waiting = await reserve(second, secondLease.lease_token, key);
      assert.equal(waiting.code, "busy"); assert.equal(waiting.needs_reconciliation, true);
      const reconciled = await rpc("reconcile_expired_cache", [key]);
      assert.equal(reconciled.kind, dispatched ? "uncertain" : "released");
      const next = await reserve(second, secondLease.lease_token, key);
      assert.equal(dispatched ? next.code : next.kind, dispatched ? "ambiguous_dispatch" : "reserved");
      assert.equal((await commit(first, firstLease.lease_token, attempt.attempt_id)).code, "stale_lease");
    }
  });

  await test("Cancellation refunds only verified undispatched reservations", async () => {
    for (const dispatch of [false, true]) {
      const job = await create(await session()); const held = await lease(job); const attempt = await reserve(job, held.lease_token);
      if (dispatch) await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]);
      const result = await rpc("cancel_job", [job.session_id, job.id]);
      assert.equal(result.job.phase, "cancelled");
      assert.equal((await commit(job, held.lease_token, attempt.attempt_id)).code, "stale_lease");
      assert.equal((await server.query("select status from public.provider_attempts where id=$1", [attempt.attempt_id])).rows[0].status, dispatch ? "uncertain" : "released");
    }
    assert.equal((await server.query("select reserved_units from public.budget_buckets where id='global:serpapi'")).rows[0].reserved_units, 1);
  });

  await test("Kill switch between reservation and dispatch prevents provider call (T30)", async () => {
    const job = await create(await session()); const held = await lease(job); const attempt = await reserve(job, held.lease_token);
    await admin.query("update public.budget_buckets set enabled=false where id='global:serpapi'");
    assert.equal((await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token])).code, "search_disabled");
    assert.equal((await server.query("select reserved_units from public.budget_buckets where id='global:serpapi'")).rows[0].reserved_units, 0);
  });

  await test("Conservative reconciliation never increases cap; owner increase is audited", async () => {
    const job = await create(await session()); const held = await lease(job); await reserve(job, held.lease_token);
    const reduced = await rpc("reconcile_budget", ["serpapi", 5, 3, 50, true]);
    assert.equal(reduced.bucket.limit_units, 2, "The unresolved pre-existing reservation is also conservatively protected");
    assert.equal((await rpc("reconcile_budget", ["serpapi", 100, 3, 100, true])).bucket.limit_units, 2);
    assert.equal((await rpc("reconcile_budget", ["serpapi", 100, 3, 100, true, true])).bucket.limit_units, 97);
    assert.equal((await rpc("reconcile_budget", ["serpapi", 0, 3, 100, true])).bucket.limit_units, 1);
  });

  await test("Gemini uses owner attempt caps; provider allowance remains unknown across configuration and migration", async () => {
    const job = await create(await session(), "investigation"); const held = await lease(job);
    const attempt = await reserve(job, held.lease_token, null as unknown as string, "EXTRACT_SYNTHETIC", "gemini");
    assert.equal(attempt.ok, true);
    await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]);
    await commit(job, held.lease_token, attempt.attempt_id);
    const lowered = await rpc("configure_llm_budget", [5, true]);
    assert.equal(lowered.bucket.limit_units, 5);
    assert.equal(lowered.bucket.reserved_units, 1);
    assert.equal(lowered.last_known_provider_remaining, null);
    assert.equal(lowered.checked_at, null);
    assert.equal(lowered.bucket.last_known_provider_remaining, null);
    assert.equal(lowered.bucket.checked_at, null);
    assert.equal(lowered.bucket.metadata.allowance_source, "owner_attempt_cap");
    assert.equal(lowered.bucket.metadata.last_known_provider_remaining, undefined);
    assert.equal((await rpc("configure_llm_budget", [1000, true])).bucket.limit_units, 5);
    assert.equal((await rpc("configure_llm_budget", [20, true, true])).bucket.limit_units, 20);
    assert.equal((await rpc("configure_llm_budget", [0, false])).bucket.limit_units, 1);
    assert.equal((await rpc("configure_llm_budget", [0, false])).bucket.reserved_units, 1);
    // A legacy caller's synthetic number must never become a claimed observed allowance.
    const legacy = await rpc("reconcile_budget", ["gemini", 1000, 0, 10, true, true]);
    assert.equal(legacy.bucket.limit_units, 10);
    assert.equal(legacy.last_known_provider_remaining, null);
    assert.equal(legacy.checked_at, null);
    await admin.query("update public.budget_buckets set last_known_provider_remaining=1000,checked_at=now(),metadata=metadata||'{\"last_known_provider_remaining\":1000,\"checked_at\":\"synthetic-old-check\",\"protected_reserve\":0}' where id='global:gemini'");
    const legacyCorrection = await readFile(path.join(process.cwd(), "supabase/migrations/004_llm_budget.sql"), "utf8");
    // Exercise the exact historical data correction without replacing the newer RPC implementation.
    await admin.query(legacyCorrection.slice(0, legacyCorrection.indexOf("create or replace function")));
    const corrected = (await server.query("select * from public.budget_buckets where id='global:gemini'")).rows[0];
    assert.equal(corrected.limit_units, 10);
    assert.equal(corrected.reserved_units, 1);
    assert.equal(corrected.last_known_provider_remaining, null);
    assert.equal(corrected.checked_at, null);
    assert.equal(corrected.metadata.last_known_provider_remaining, undefined);
    assert.equal(corrected.metadata.checked_at, undefined);
    assert.equal(corrected.metadata.protected_reserve, undefined);
    const status = await rpc("preflight_status", []);
    assert.equal(status.ok, true);
    assert.equal(status.migration, "006");
    assert.equal(status.rpcVersion, "3");
    assert.equal(status.llmBudgetSource, "owner_attempt_cap");
    assert.equal((await server.query("select count(*)::integer count from public.job_events where event_type='llm_budget_configured'")).rows[0].count, 6);
    const anon = new Pool({ ...connection, options: "-c role=anon" });
    const authenticated = new Pool({ ...connection, options: "-c role=authenticated" });
    try {
      for (const pool of [anon, authenticated]) {
        await assert.rejects(pool.query("select public.configure_llm_budget(1000,true,true)"), /permission denied/);
      }
    } finally { await anon.end(); await authenticated.end(); }
  });

  await test("Rate limits increment atomically under parallel requests", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => rpc("consume_rate_limit", ["synthetic-network-hash", 5, 900])));
    assert.equal(results.filter((result) => result.allowed).length, 5);
    assert.equal((await server.query("select count from public.rate_limit_buckets")).rows[0].count, 5);
  });

  await test("Verification allocation is durable, capped at 30 and not reset by reconciliation", async () => {
    await rpc("reconcile_budget", ["serpapi", 100, 30, 70, true, true]);
    await admin.query("update public.budget_buckets set reserved_units=29 where id='allocation:verification:serpapi'");
    const fixtures = await Promise.all(Array.from({ length: 2 }, async () => {
      const job = await create(await session());
      await admin.query("update public.jobs set input='{\"_allocation\":\"verification\"}' where id=$1", [job.id]);
      return { job, held: await lease(job) };
    }));
    const results = await Promise.all(fixtures.map(({ job, held }) => reserve(job, held.lease_token)));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.code === "budget_exhausted").length, 1);
    await rpc("reconcile_budget", ["serpapi", 100, 30, 70, true]);
    const allocation = (await admin.query("select * from public.budget_buckets where id='allocation:verification:serpapi'")).rows[0];
    assert.equal(allocation.limit_units, 30);
    assert.equal(allocation.reserved_units, 30);
  });

  await test("Owner policy lowers future/current session/day limits; preflight verifies migration and grants", async () => {
    assert.equal((await rpc("preflight_status", [])).ok, true);
    assert.equal((await rpc("configure_limits", [2, 1])).ok, true);
    const sid = await session(); const job = await create(sid); const held = await lease(job);
    assert.equal((await reserve(job, held.lease_token)).ok, true);
    const next = await create(sid); const nextLease = await lease(next);
    assert.equal((await reserve(next, nextLease.lease_token)).code, "budget_exhausted");
    await rpc("configure_limits", [0, 0]);
    const buckets = (await server.query("select * from public.budget_buckets where id like 'day:%' or id like 'session:%'")).rows;
    assert.ok(buckets.every((bucket) => bucket.limit_units === bucket.reserved_units));
    await rpc("reconcile_budget", ["serpapi", 100, 30, 70, true]);
    const metadata = (await server.query("select metadata from public.budget_buckets where id='global:serpapi'")).rows[0].metadata;
    assert.equal(metadata.daily_limit, 0);
    assert.equal(metadata.session_limit, 0);
  });

  await test("Search policy switches exactly at 50, and unknown/stale balances remain conservative", async () => {
    const unknown = await create(await session(), "investigation");
    assert.equal(unknown.serp_full_cap, 26); assert.equal(unknown.serp_cap, 5); assert.equal(unknown.search_mode, "conserve");
    assert.equal(unknown.llm_cap, 56); assert.equal(unknown.step_cap, 128);
    const above = await observe(51);
    assert.equal(above.policy.mode, "expanded"); assert.equal(above.policy.effectiveCap, 26);
    assert.equal((await create(await session(), "investigation")).serp_cap, 26);
    const at = await observe(50);
    assert.equal(at.policy.mode, "conserve"); assert.equal(at.policy.effectiveCap, 5);
    assert.equal((await create(await session(), "investigation")).serp_cap, 5);
    assert.equal((await observe(49)).policy.effectiveCap, 5);
    await observe(200);
    await admin.query("update public.budget_buckets set checked_at=now()-interval '61 seconds' where id='global:serpapi'");
    const stale = await rpc("current_search_policy", []);
    assert.equal(stale.fresh, false); assert.equal(stale.effectiveCap, 5);
  });

  await test("Expanded investigation dispatches past five; fresh low balance stops the sixth without spending", async () => {
    await observe(200);
    let job = await create(await session(), "investigation");
    for (let index = 0; index < 6; index++) job = await searchStep(job, `SYNTHETIC_EXPANDED_${index}`);
    assert.equal(job.serp_reserved, 6); assert.equal(job.serp_cap, 26);
    await observe(50);
    const held = await lease(job);
    assert.equal(held.job.search_mode, "conserve");
    assert.equal(held.job.serp_cap, 6, "Already-consumed attempts are preserved when the effective allowance shrinks");
    const denied = await reserve(job, held.lease_token, null as unknown as string, "SYNTHETIC_AFTER_THRESHOLD");
    assert.equal(denied.code, "budget_exhausted"); assert.equal(denied.effectiveSearchCap, 5);
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, 6);
  });

  await test("Concurrent reservations crossing 51 to 50 permit only one expanded sixth search", async () => {
    await observe(200); await rpc("configure_limits", [60, 64, true]);
    let first = await create(await session(), "investigation"); let second = await create(await session(), "investigation");
    for (let index = 0; index < 5; index++) {
      first = await searchStep(first, `SYNTHETIC_FIRST_${index}`);
      second = await searchStep(second, `SYNTHETIC_SECOND_${index}`);
    }
    await observe(51);
    const fixtures = await Promise.all([first, second].map(async (job) => ({ job, held: await lease(job) })));
    const results = await Promise.all(fixtures.map(({ job, held }, index) => reserve(job, held.lease_token, null as unknown as string, `SYNTHETIC_SIXTH_${index}`)));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.code === "budget_exhausted").length, 1);
    const winner = results.findIndex((result) => result.ok);
    assert.equal((await rpc("mark_dispatch", [results[winner].attempt_id, fixtures[winner].held.lease_token])).ok, true);
    assert.equal((await rpc("current_search_policy", [])).remainingEstimate, 50);
    assert.equal((await server.query("select reserved_units from public.budget_buckets where id='global:serpapi'")).rows[0].reserved_units, 11);
  });

  await test("Last-moment balance reduction releases an undispatched sixth attempt and preserves audit", async () => {
    await observe(200);
    let job = await create(await session(), "investigation");
    for (let index = 0; index < 5; index++) job = await searchStep(job, `SYNTHETIC_BEFORE_LOW_${index}`);
    const held = await lease(job);
    const attempt = await reserve(job, held.lease_token, hash("synthetic low dispatch cache"), "SYNTHETIC_PENDING_SIXTH");
    assert.equal(attempt.ok, true);
    await observe(50);
    const denied = await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]);
    assert.equal(denied.code, "budget_exhausted");
    const row = (await server.query("select * from public.provider_attempts where id=$1", [attempt.attempt_id])).rows[0];
    assert.equal(row.status, "released"); assert.equal(row.dispatch_started_at, null);
    assert.equal((await server.query("select serp_reserved from public.jobs where id=$1", [job.id])).rows[0].serp_reserved, 5);
    assert.equal((await server.query("select count(*)::integer count from public.attempt_budget_reservations where attempt_id=$1 and released_at is not null", [attempt.attempt_id])).rows[0].count, 3);
  });

  const saveReleasedFailure = async (job: Json, held: Json, attempt: Json, code: string, terminalPhase: string) => {
    const releasedBefore = (await server.query("select count(*)::integer count from public.attempt_budget_reservations where attempt_id=$1 and released_at is not null", [attempt.attempt_id])).rows[0].count;
    const countersBefore = (await server.query("select id,reserved_units from public.budget_buckets order by id")).rows;
    const auditsBefore = (await server.query("select count(*)::integer count from public.job_events where job_id=$1 and event_type='reservation_released'", [job.id])).rows[0].count;
    const checkpoint = { ...job.state, syntheticCheckpoint: `saved after ${code}`, failureStopReason: code };
    const saved = await rpc("fail_step", [job.id, held.lease_token, job.state_version, attempt.attempt_id, code, false, null, "finalize", checkpoint]);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.job.lease_token, null); assert.equal(saved.job.lease_until, null);
    assert.equal(saved.job.state_version, job.state_version + 1); assert.equal(saved.job.state.syntheticCheckpoint, checkpoint.syntheticCheckpoint);
    assert.deepEqual((await server.query("select id,reserved_units from public.budget_buckets order by id")).rows, countersBefore);
    assert.equal((await server.query("select count(*)::integer count from public.attempt_budget_reservations where attempt_id=$1 and released_at is not null", [attempt.attempt_id])).rows[0].count, releasedBefore);
    assert.equal((await server.query("select count(*)::integer count from public.job_events where job_id=$1 and event_type='reservation_released'", [job.id])).rows[0].count, auditsBefore);
    assert.equal((await server.query("select status from public.provider_attempts where id=$1", [attempt.attempt_id])).rows[0].status, "released");
    assert.equal((await rpc("fail_step", [job.id, held.lease_token, job.state_version, attempt.attempt_id, code, false, null, "finalize", checkpoint])).code, "stale_lease");
    const finishingLease = await lease(saved.job);
    const completed = await commit(saved.job, finishingLease.lease_token, null, { phase: terminalPhase });
    assert.equal(completed.ok, true); assert.equal(completed.job.phase, terminalPhase);
  };

  await test("Released low-balance attempt still saves the failure checkpoint, clears its lease and never refunds twice", async () => {
    await observe(200);
    let job = await create(await session(), "investigation");
    for (let index = 0; index < 5; index++) job = await searchStep(job, `SYNTHETIC_RELEASE_FAILURE_${index}`);
    await admin.query("update public.jobs set phase='targeted_search' where id=$1", [job.id]);
    const held = await lease(job);
    const attempt = await reserve(job, held.lease_token, hash("synthetic released failure cache"), "SYNTHETIC_OPTIONAL_SIXTH");
    assert.equal(attempt.ok, true); await observe(50);
    assert.equal((await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token])).code, "budget_exhausted");
    await saveReleasedFailure(job, held, attempt, "budget_exhausted", "complete");
  });

  await test("Released kill-switch attempt still saves the failure checkpoint and can finalize without a stranded lease", async () => {
    const job = await create(await session(), "investigation"); const held = await lease(job);
    const attempt = await reserve(job, held.lease_token, hash("synthetic killed failure cache"), "SYNTHETIC_KILLED_BEFORE_DISPATCH");
    assert.equal(attempt.ok, true);
    await admin.query("update public.budget_buckets set enabled=false where id='global:serpapi'");
    assert.equal((await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token])).code, "search_disabled");
    await saveReleasedFailure(job, held, attempt, "search_disabled", "partial");
  });

  await test("Cache remains reusable after the five-search cap without a new provider attempt", async () => {
    await observe(200);
    const key = hash("synthetic cache after low cap");
    await searchStep(await create(await session()), "SYNTHETIC_CACHE_OWNER", key);
    await observe(50);
    let job = await create(await session(), "investigation");
    for (let index = 0; index < 5; index++) job = await searchStep(job, `SYNTHETIC_LOW_${index}`);
    const held = await lease(job);
    const before = (await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count;
    const cached = await reserve(job, held.lease_token, key, "SYNTHETIC_NEW_CACHE_ACTION");
    assert.equal(cached.kind, "cache");
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, before);
    assert.equal((await server.query("select serp_reserved from public.jobs where id=$1", [job.id])).rows[0].serp_reserved, 5);
  });

  await test("Balance refresh fences old observations and subtracts overlapping/refunded reservations monotonically", async () => {
    await observe(200);
    const old = await rpc("begin_serpapi_balance_check", []);
    const job = await create(await session()); const held = await lease(job);
    const attempt = await reserve(job, held.lease_token);
    await rpc("cancel_job", [job.session_id, job.id]);
    assert.equal((await server.query("select status from public.provider_attempts where id=$1", [attempt.attempt_id])).rows[0].status, "released");
    const overlapping = await rpc("reconcile_serpapi_balance", [200, old.snapshot, observedAt(old.snapshot), 30, 400, true, true]);
    assert.equal(overlapping.policy.remainingEstimate, 199, "Refunds never rewind the observation's reservation sequence");
    const older = await rpc("begin_serpapi_balance_check", []);
    const newer = await rpc("begin_serpapi_balance_check", []);
    await rpc("reconcile_serpapi_balance", [50, newer.snapshot, observedAt(newer.snapshot), 30, 400, true, true]);
    const ignored = await rpc("reconcile_serpapi_balance", [200, older.snapshot, observedAt(older.snapshot), 30, 400, true, true]);
    assert.equal(ignored.ignored, true); assert.equal(ignored.policy.remainingEstimate, 50);
  });

  await test("A kill switch activated during account inspection is not re-enabled by refresh", async () => {
    const begun = await rpc("begin_serpapi_balance_check", []);
    await admin.query("update public.budget_buckets set enabled=false where id='global:serpapi'");
    const refreshed = await rpc("reconcile_serpapi_balance", [200, begun.snapshot, observedAt(begun.snapshot), 30, 400, true, true]);
    assert.equal(refreshed.bucket.enabled, false);
    assert.equal((await server.query("select enabled from public.budget_buckets where id='allocation:verification:serpapi'")).rows[0].enabled, false);
  });

  await test("Fresh provider evidence restores expanded mode without increasing allocations or resetting counters", async () => {
    await observe(49);
    const before = (await server.query("select * from public.budget_buckets where id='global:serpapi'")).rows[0];
    assert.equal((await observe(51, false)).policy.mode, "expanded");
    const after = (await server.query("select * from public.budget_buckets where id='global:serpapi'")).rows[0];
    assert.equal(after.limit_units, before.limit_units); assert.equal(after.reserved_units, before.reserved_units);
  });

  await test("Database receipt time keeps observations fresh when the application clock is 20 or 30 seconds ahead or behind", async () => {
    for (const offset of [-30000, -20000, 20000, 30000]) {
      const begun = await rpc("begin_serpapi_balance_check", []);
      const clientRetrievedAt = new Date(Date.parse(begun.snapshot.startedAt) + offset).toISOString();
      const result = await rpc("reconcile_serpapi_balance", [200, begun.snapshot, clientRetrievedAt, 30, 400, true, true]);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.policy.fresh, true); assert.equal(result.policy.mode, "expanded");
      const trustedElapsed = Date.parse(result.checked_at) - Date.parse(begun.snapshot.startedAt);
      assert.ok(trustedElapsed >= 0 && trustedElapsed < 5000, "Stored freshness follows the database's receipt clock");
      assert.equal(Date.parse(result.bucket.metadata.provider_retrieved_at), Date.parse(clientRetrievedAt));
      assert.equal(Date.parse(result.bucket.checked_at), Date.parse(result.checked_at));
      assert.notEqual(Date.parse(result.checked_at), Date.parse(clientRetrievedAt));
    }
  });

  await test("An account request delayed over 60 database seconds is rejected regardless of the application timestamp", async () => {
    await observe(200);
    const before = (await server.query("select * from public.budget_buckets where id='global:serpapi'")).rows[0];
    const begun = await rpc("begin_serpapi_balance_check", []);
    const expired = { ...begun.snapshot, startedAt: new Date(Date.parse(begun.snapshot.startedAt) - 61000).toISOString() };
    const hostAhead = new Date(Date.parse(begun.snapshot.startedAt) + 30000).toISOString();
    const result = await rpc("reconcile_serpapi_balance", [51, expired, hostAhead, 30, 400, true, true]);
    assert.equal(result.code, "invalid_input");
    const after = (await server.query("select * from public.budget_buckets where id='global:serpapi'")).rows[0];
    assert.equal(after.last_known_provider_remaining, before.last_known_provider_remaining);
    assert.equal(after.checked_at.getTime(), before.checked_at.getTime()); assert.deepEqual(after.metadata, before.metadata);
  });

  await test("A forged future account-check start cannot become a fresh observation even with an ahead application clock", async () => {
    const begun = await rpc("begin_serpapi_balance_check", []);
    const future = { ...begun.snapshot, startedAt: new Date(Date.parse(begun.snapshot.startedAt) + 20000).toISOString() };
    const result = await rpc("reconcile_serpapi_balance", [200, future, new Date(Date.parse(future.startedAt) + 30000).toISOString(), 30, 400, true, true]);
    assert.equal(result.code, "invalid_input");
    assert.equal((await rpc("current_search_policy", [])).remainingEstimate, null);
  });

  await test("Configured demo limits increase existing buckets only with an explicit owner flag", async () => {
    const sid = await session(); await searchStep(await create(sid), "SYNTHETIC_EXISTING_POLICY");
    await rpc("configure_limits", [2, 2]);
    await rpc("configure_limits", [60, 64]);
    assert.equal((await server.query("select limit_units from public.budget_buckets where id=$1", [`session:${sid}:serpapi`])).rows[0].limit_units, 2);
    await rpc("configure_limits", [60, 64, true]);
    assert.equal((await server.query("select limit_units from public.budget_buckets where id=$1", [`session:${sid}:serpapi`])).rows[0].limit_units, 64);
    assert.equal((await server.query("select limit_units from public.budget_buckets where id like 'day:%:serpapi'")).rows[0].limit_units, 60);
    const metadata = (await server.query("select metadata from public.budget_buckets where id='global:gemini'")).rows[0].metadata;
    assert.equal(metadata.session_limit, 96); assert.equal(metadata.daily_limit, 240);
  });

  await test("Provider-free finalization can still commit at the legacy twentieth step and expanded time limit", async () => {
    for (const legacy of [true, false]) {
      const job = await create(await session(), "investigation");
      await admin.query("update public.jobs set phase='finalize',step_count=$2,step_cap=$2,search_mode=$3,active_milliseconds=300000 where id=$1", [job.id, legacy ? 20 : 128, legacy ? "legacy" : "expanded"]);
      const current = (await server.query("select * from public.jobs where id=$1", [job.id])).rows[0];
      const held = await lease(current);
      assert.equal(held.job.step_count, legacy ? 21 : 129);
      const saved = await commit(current, held.lease_token, null, { phase: "complete" });
      assert.equal(saved.ok, true); assert.equal(saved.job.phase, "complete");
      assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, 0);
    }
  });

  await test("Expanded Gemini budget remains owner-defined and permits all 56 bounded extraction/planning attempts", async () => {
    await rpc("configure_llm_budget", [1000, true, true]); await rpc("configure_limits", [60, 64, true]);
    let job = await create(await session(), "investigation");
    for (let index = 0; index < 56; index++) {
      const held = await lease(job);
      const attempt = await reserve(job, held.lease_token, null as unknown as string, `SYNTHETIC_LLM_${index}`, "gemini");
      assert.equal(attempt.ok, true); await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]);
      const saved = await commit(job, held.lease_token, attempt.attempt_id, { phase: "extract", stop: null });
      assert.equal(saved.ok, true); job = saved.job;
    }
    const held = await lease(job);
    assert.equal((await reserve(job, held.lease_token, null as unknown as string, "SYNTHETIC_LLM_OVER_CAP", "gemini")).code, "budget_exhausted");
    assert.equal(job.llm_reserved, 56); assert.equal(job.serp_reserved, 0);
    const llm = (await server.query("select * from public.budget_buckets where id='global:gemini'")).rows[0];
    assert.equal(llm.last_known_provider_remaining, null); assert.equal(llm.checked_at, null);
  });

  await test("Reservations and owner reconciliation share sorted locks under concurrency", async () => {
    await rpc("reconcile_budget", ["serpapi", 100, 30, 70, true, true]);
    const fixtures = await Promise.all(Array.from({ length: 10 }, async () => {
      const job = await create(await session());
      await admin.query("update public.jobs set input='{\"_allocation\":\"verification\"}' where id=$1", [job.id]);
      return { job, held: await lease(job) };
    }));
    const results = await Promise.all(fixtures.flatMap(({ job, held }) => [
      reserve(job, held.lease_token), rpc("reconcile_budget", ["serpapi", 100, 30, 70, true]) ]));
    assert.ok(results.every((result) => result.ok));
    const buckets = (await server.query("select * from public.budget_buckets")).rows;
    assert.ok(buckets.every((bucket) => bucket.reserved_units >= 0 && bucket.reserved_units <= bucket.limit_units));
    assert.equal(buckets.find((bucket) => bucket.id === "global:serpapi").reserved_units, 10);
    assert.equal(buckets.find((bucket) => bucket.id === "allocation:verification:serpapi").reserved_units, 10);
  });

  await test("Known failures consume attempts, permit one later retry and reject third attempt", async () => {
    const job = await create(await session(), "investigation"); let current = job;
    for (let index = 0; index < 2; index++) {
      const held = await lease(current); const attempt = await reserve(current, held.lease_token, null as unknown as string);
      assert.equal(attempt.ok, true);
      await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]);
      const failed = await rpc("fail_step", [current.id, held.lease_token, current.state_version, attempt.attempt_id, "http_503", false, null, "details", {}]);
      assert.equal(failed.ok, true); current = failed.job;
    }
    const held = await lease(current);
    assert.equal((await reserve(current, held.lease_token, null as unknown as string)).code, "retry_exhausted");
    assert.equal(current.serp_reserved, 2);
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts where status='failed'")).rows[0].count, 2);
  });

  await test("Immutable source/claim/report revisions and reassessment use exact corpus (T18/T29)", async () => {
    const job = await create(await session(), "investigation"); const held = await lease(job);
    const sourceId = randomUUID(); const claimId = randomUUID();
    const source = { id: sourceId, venueId: job.venue_id, sourceGroupKey: "synthetic-review", kind: "maps_review", text: "Synthetic: entrance has steps.",
      sourceUrl: "https://example.com/synthetic", providerReviewId: "synthetic-review", retrievedAt: new Date().toISOString(), metadata: {} };
    const claim = { id: claimId, venueId: job.venue_id, sourceId, feature: "entrance_step_free", polarity: "barrier", originalQuote: "entrance has steps",
      quoteStart: 11, quoteEnd: 29, jsonPointer: null, scope: { entrance: null, floor: null, facility: null, conditions: [] }, datePrecision: "unknown",
      temporalKind: "structural", venueMatch: "exact", extractionStatus: "accepted", extractorVersion: "test-extractor-v1" };
    const report = { sources: [source], claims: [claim], extractorVersion: "test-extractor-v1" };
    const saved = await commit(job, held.lease_token, null, { sources: [source], claims: [claim], report: {
      profile_hash: hash("synthetic-profile"), requirements: [], algorithm_version: "test-v1", report, is_partial: true } });
    assert.equal(saved.ok, true);
    await assert.rejects(server.query("update public.source_snapshots set text='changed' where id=$1", [sourceId]), /Immutable/);
    await assert.rejects(server.query("update public.evidence_claims set quote='changed' where id=$1", [claimId]), /Immutable/);
    await assert.rejects(server.query("update public.assessments set report='{}' where job_id=$1", [job.id]), /Immutable/);
    const before = (await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count;
    const revised = await rpc("save_assessment", [job.session_id, job.id, saved.job.state_version, hash("new-profile"), [], "test-v1", report, true]);
    assert.equal(revised.ok, true);
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, before);
    assert.equal((await server.query("select array_agg(revision order by revision) revisions from public.assessments where job_id=$1", [job.id])).rows[0].revisions.join(","), "1,2");
    const wrongReport = { ...report, sources: [{ id: randomUUID() }] };
    await assert.rejects(rpc("save_assessment", [job.session_id, job.id, revised.job.state_version, hash("profile"), [], "test-v1", wrongReport, true]), /outside job corpus/);
  });

  await test("Supplementary photo-only evidence preserves attribution, immutable snapshots and private reassessment revisions", async () => {
    const job = await create(await session(), "investigation"); const held = await lease(job);
    const retrievedAt = new Date().toISOString();
    const reviewImage: EvidenceImage = { id: "synthetic-review-photo", url: "https://example.com/synthetic-review-photo.jpg",
      sourceUrl: "https://example.com/synthetic-review", providerSearchId: "synthetic-review-search", retrievedAt,
      capturedAt: null, jsonPointer: "/reviews/0/images/0", attribution: "Google Maps review photo" };
    const listingImage: EvidenceImage = { id: "synthetic-listing-photo", url: "https://example.com/synthetic-listing-photo.jpg",
      sourceUrl: "https://example.com/synthetic-venue", providerSearchId: "synthetic-listing-search", retrievedAt,
      capturedAt: null, jsonPointer: "/place_results/thumbnail", attribution: "Google Maps listing" };
    const venue = { ...job.state.venue, images: [listingImage] };
    const source: Source = { id: randomUUID(), venueId: job.venue_id, sourceGroupKey: "synthetic-photo-only-review",
      kind: "maps_review", text: "", sourceUrl: reviewImage.sourceUrl, providerReviewId: "synthetic-photo-review",
      providerSearchId: reviewImage.providerSearchId, engine: "google_maps_reviews", retrievedAt,
      publishedAt: null, editedAt: null, observedAt: null, selectionMethod: "newest",
      metadata: { synthetic: true, venueMatch: "exact" }, images: [reviewImage] };
    const requirements = [{ feature: "entrance_step_free", priority: "must_have" }];
    const requirementReport = { ...requirements[0], status: "insufficient", claimIds: [], sourceIds: [],
      explanation: "Synthetic photos supply no accessibility observation.", barrierToConfirm: false, conditions: [], dataQualityFlags: [] };
    const report = { venue, requirements: [requirementReport], sources: [source], claims: [], overall: "needs_confirmation",
      generatedAt: retrievedAt, isPartial: false, questions: [], limitations: ["Synthetic photo fixture; no image analysis."],
      algorithmVersion: "synthetic-image-report-v1", extractorVersion: "synthetic-no-photo-extraction-v1", reviewsExamined: 1 };
    const state = { ...job.state, venue, sources: [source], claims: [], requirements,
      report: { ...report, sources: [], claims: [] } };
    const saved = await commit(job, held.lease_token, null, { state, sources: [source], report: {
      profile_hash: hash("synthetic-photo-profile"), requirements, algorithm_version: report.algorithmVersion, report, is_partial: false } });
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.job.state.venue.images, [listingImage]); assert.deepEqual(saved.job.state.sources[0].images, [reviewImage]);
    const snapshot = (await server.query("select text,text_hash,metadata from public.source_snapshots where id=$1", [source.id])).rows[0];
    assert.equal(snapshot.text, ""); assert.equal(snapshot.text_hash, hash("")); assert.deepEqual(snapshot.metadata.original, source);
    const firstReport = (await server.query("select report from public.assessments where job_id=$1 and revision=1", [job.id])).rows[0].report;
    assert.deepEqual(firstReport.venue.images, [listingImage]); assert.deepEqual(firstReport.sources[0].images, [reviewImage]);
    assert.equal(firstReport.sources[0].images[0].capturedAt, null); assert.equal(firstReport.overall, "needs_confirmation");
    assert.equal((await server.query("select count(*)::integer count from public.evidence_claims")).rows[0].count, 0);
    await assert.rejects(server.query("update public.source_snapshots set metadata=jsonb_set(metadata,'{original,images,0,url}',to_jsonb($2::text)) where id=$1",
      [source.id, "https://example.com/synthetic-tampered.jpg"]), /Immutable/);
    await assert.rejects(server.query("update public.assessments set report=jsonb_set(report,'{venue,images,0,url}',to_jsonb($2::text)) where job_id=$1",
      [job.id, "https://example.com/synthetic-tampered.jpg"]), /Immutable/);
    const revisedRequirements = [{ feature: "accessible_restroom", priority: "must_have" }];
    const revisedReport = { ...report, requirements: [{ ...requirementReport, ...revisedRequirements[0] }] };
    const revised = await rpc("save_assessment", [job.session_id, job.id, saved.job.state_version, hash("synthetic-photo-reassessment"),
      revisedRequirements, report.algorithmVersion, revisedReport, false]);
    assert.equal(revised.ok, true); assert.deepEqual(revised.job.state.venue.images, [listingImage]);
    assert.deepEqual(revised.job.state.sources[0].images, [reviewImage]); assert.deepEqual(revised.job.state.report.venue.images, [listingImage]);
    const secondReport = (await server.query("select report from public.assessments where id=$1", [revised.assessment_id])).rows[0].report;
    assert.deepEqual(secondReport.sources[0].images, [reviewImage]); assert.deepEqual(secondReport.venue.images, [listingImage]);
    assert.deepEqual(secondReport.claims, []); assert.equal(secondReport.overall, "needs_confirmation");
    const otherSession = await session();
    assert.equal((await rpc("claim_step", [otherSession, job.id, revised.job.state_version])).code, "not_found");
    assert.equal((await rpc("save_assessment", [otherSession, job.id, revised.job.state_version, hash("synthetic-forbidden-photo-profile"),
      revisedRequirements, report.algorithmVersion, revisedReport, false])).code, "not_found");
    assert.equal((await server.query("select count(*)::integer count from public.assessments where job_id=$1", [job.id])).rows[0].count, 2);
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, 0);
    const anon = new Pool({ ...connection, options: "-c role=anon" });
    const authenticated = new Pool({ ...connection, options: "-c role=authenticated" });
    try {
      for (const pool of [anon, authenticated]) {
        await assert.rejects(pool.query("select metadata from public.source_snapshots where id=$1", [source.id]), /permission denied/);
        await assert.rejects(pool.query("select report from public.assessments where job_id=$1", [job.id]), /permission denied/);
      }
    } finally { await anon.end(); await authenticated.end(); }
    assert.deepEqual((await server.query("select metadata from public.source_snapshots where id=$1", [source.id])).rows[0].metadata.original, source);
  });

  await test("Retention dry run/delete keeps consumed allocation audit", async () => {
    const job = await create(await session()); const held = await lease(job); const attempt = await reserve(job, held.lease_token);
    await rpc("mark_dispatch", [attempt.attempt_id, held.lease_token]); await commit(job, held.lease_token, attempt.attempt_id);
    await admin.query("update public.jobs set created_at=now()-interval '40 days',updated_at=now()-interval '40 days',input='{\"private\":true}' where id=$1", [job.id]);
    const dry = await rpc("retention_cleanup", [true]); assert.equal(dry.jobs, 1);
    assert.equal((await server.query("select input from public.jobs where id=$1", [job.id])).rows[0].input.private, true);
    await rpc("retention_cleanup", [false]);
    assert.deepEqual((await server.query("select input from public.jobs where id=$1", [job.id])).rows[0].input, {});
    assert.equal((await server.query("select count(*)::integer count from public.attempt_budget_reservations")).rows[0].count, 3);
    assert.equal((await server.query("select reserved_units from public.budget_buckets where id='global:serpapi'")).rows[0].reserved_units, 1);
  });

  await test("Bounded multilingual originals, translations and scoped claims persist their UTF-8 metadata", async () => {
    const job = await create(await session(), "investigation"); const held = await lease(job);
    const source = { id: randomUUID(), venueId: job.venue_id, sourceGroupKey: "synthetic-multilingual-review", kind: "maps_review",
      text: "無".repeat(4000), translatedText: "段".repeat(4000), metadata: { note: "語".repeat(4000) },
      retrievedAt: new Date().toISOString(), sourceUrl: "https://example.com/synthetic-multilingual" };
    const claim = { id: randomUUID(), venueId: job.venue_id, sourceId: source.id, feature: "entrance_step_free", polarity: "unclear",
      originalQuote: "無".repeat(1600), quoteStart: 0, quoteEnd: 1600, jsonPointer: null,
      scope: { entrance: "門".repeat(120), floor: "層".repeat(120), facility: "設".repeat(120), conditions: Array.from({ length: 6 }, () => "條".repeat(240)) },
      datePrecision: "unknown", temporalKind: "structural", venueMatch: "exact", extractionStatus: "accepted", extractorVersion: "synthetic-multilingual-v1" };
    const report = { sources: [source], claims: [claim] };
    assert.equal((await commit(job, held.lease_token, null, { phase: "partial", sources: [source], claims: [claim], report: {
      profile_hash: hash("synthetic-profile"), requirements: [], algorithm_version: "test-v1", report, is_partial: true } })).ok, true);
    const savedSource = (await server.query("select octet_length(metadata::text) bytes,metadata from public.source_snapshots where id=$1", [source.id])).rows[0];
    const savedClaim = (await server.query("select octet_length(metadata::text) bytes,metadata from public.evidence_claims where id=$1", [claim.id])).rows[0];
    assert.ok(savedSource.bytes > 16384 && savedSource.bytes <= 65536);
    assert.ok(savedClaim.bytes > 8192 && savedClaim.bytes <= 32768);
    assert.deepEqual(savedSource.metadata.original, source);
    assert.deepEqual(savedClaim.metadata.original, claim);
  });

  await test("Reassessment keeps one bounded checkpoint corpus and a complete immutable report revision", async () => {
    const job = await create(await session(), "investigation"); const held = await lease(job);
    const features = ["arrival_step_free", "entrance_step_free", "interior_movement", "accessible_seating", "accessible_restroom",
      "accessible_parking", "lift_present", "lift_operational"];
    const sources = Array.from({ length: 12 }, (_, index) => ({ id: randomUUID(), venueId: job.venue_id,
      sourceGroupKey: `synthetic-bounded-corpus-${index}`, kind: "maps_review", text: "x".repeat(4000),
      retrievedAt: new Date().toISOString(), sourceUrl: "https://example.com/synthetic-bounded-corpus", metadata: {} }));
    const claims = sources.flatMap((source) => features.map((feature) => ({ id: randomUUID(), venueId: job.venue_id,
      sourceId: source.id, feature, polarity: "unclear", originalQuote: "x".repeat(1600), quoteStart: 0, quoteEnd: 1600,
      jsonPointer: null, scope: { entrance: "e".repeat(100), floor: "f".repeat(100), facility: "a".repeat(100),
        conditions: Array.from({ length: 6 }, () => "c".repeat(100)) }, datePrecision: "unknown", temporalKind: "structural",
      venueMatch: "exact", extractionStatus: "accepted", extractorVersion: "synthetic-bounded-corpus-v1" })));
    const report = { sources, claims, algorithmVersion: "test-v1", overall: "needs_confirmation" };
    const state = { ...job.state, sources, claims, report: { ...report, sources: [], claims: [] }, requirements: [] };
    const saved = await commit(job, held.lease_token, null, { state, sources, claims });
    assert.equal(saved.ok, true);
    const duplicateSize = (await server.query("select octet_length((state||jsonb_build_object('report',$2::jsonb))::text) bytes from public.jobs where id=$1", [job.id, report])).rows[0].bytes;
    assert.ok(duplicateSize > 524288, "Fixture proves duplicating the corpus would exceed the checkpoint constraint");
    const requirements = [{ feature: "entrance_step_free", priority: "must_have" }];
    const revised = await rpc("save_assessment", [job.session_id, job.id, saved.job.state_version, hash("new-profile"), requirements, "test-v1", report, true]);
    assert.equal(revised.ok, true);
    assert.deepEqual(revised.job.state.sources, sources);
    assert.deepEqual(revised.job.state.claims, claims);
    assert.deepEqual(revised.job.state.requirements, requirements);
    assert.deepEqual(revised.job.state.report.sources, []);
    assert.deepEqual(revised.job.state.report.claims, []);
    assert.equal(revised.job.state.report.overall, report.overall);
    const revision = (await server.query("select report from public.assessments where id=$1", [revised.assessment_id])).rows[0].report;
    assert.deepEqual(revision.sources, sources);
    assert.deepEqual(revision.claims, claims);
    assert.ok((await server.query("select octet_length(state::text) bytes from public.jobs where id=$1", [job.id])).rows[0].bytes <= 524288);
    assert.equal((await server.query("select count(*)::integer count from public.provider_attempts")).rows[0].count, 0);
    const tooLarge = { ...report, limitations: ["x".repeat(524288)] };
    await assert.rejects(rpc("save_assessment", [job.session_id, job.id, revised.job.state_version, hash("overflow-profile"),
      requirements, "test-v1", tooLarge, true]), /check constraint/);
    assert.equal((await server.query("select state_version from public.jobs where id=$1", [job.id])).rows[0].state_version, revised.job.state_version);
    assert.equal((await server.query("select count(*)::integer count from public.assessments where job_id=$1", [job.id])).rows[0].count, 1);
  });

  console.log(`${passed} real PostgreSQL integration gates passed. Provider dispatches were instrumented fakes; no live credits consumed.`);
}
