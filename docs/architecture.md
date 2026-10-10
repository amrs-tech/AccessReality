# Architecture and operating policy

One Next.js16 / React19 / TypeScript6 application, Node22, deployable on Vercel. Native server fetch handles SerpApi, `@google/genai` handles schema-constrained Gemini, and `@supabase/supabase-js` accesses Postgres exclusively on the server. No provider calls occur during rendering, exporting or building.

## Private boundary

`GET /api/session` returns a short-lived HttpOnly bootstrap cookie and its signed CSRF token. Access-code exchange requires exact Origin and that token. Successful sessions receive a cryptographically random opaque HttpOnly SameSite=Lax cookie, Secure on HTTPS. Only SHA-256 session hashes enter the database; expiration/revocation are authoritative. Failed-code attempts use a privacy-preserving HMAC network identity and an atomic5/15-minute bucket.

All mutations require Origin plus session-bound CSRF (admin uses an owner bearer secret plus Origin). Every private route checks job→session ownership, including export, cancel and reassess. Creates validate candidate ownership through the completed discovery job. Request bodies are streamed with a16KB limit and strict Zod schemas. No browser Supabase client or provider secret. Internal tables have RLS, no public/anon/authenticated grants/policies, and service-role-only invoker RPCs. Service-role bypass means application ownership checks remain mandatory.

## Transaction boundary

The browser sends sequential versioned step requests. A SQL transaction locks the owned job, checks version/session/terminal state, and acquires a75-second lease. The step route declares Node runtime and static `maxDuration=60`; provider deadlines are at most25 seconds inside a45-second application window, with time reserved for persistence. Each step contains at most one provider request. A run is capped at20 workflow steps and five active minutes. Closed/hidden/offline pages start no further steps.

Before dispatch, `reserve_provider_attempt` locks job → cache → lexically sorted budget buckets. It rechecks the cache under lock, checks kill switches and every cap, then inserts an auditable reservation and increments counters atomically. `mark_dispatch` commits before network I/O and rechecks the kill switch. Completed or uncertain action keys cannot dispatch again. Known transient failures can reserve one separate later retry; all such attempts count toward caps. No serial SDK retry (Gemini SDK attempts explicitly1).

`commit_step` uses lease/version compare-and-swap to atomically save immutable sources/claims, corpus links, report revisions, cache response, attempt completion and workflow state. Late commits cannot overwrite newer state. Source IDs are canonicalized to the exact venue/group/text/retrieval snapshot on cache reuse. Canonical venue IDs derive from observed provider identity, never a name. Changed text has a separate immutable snapshot.

Expired leases inspect their attempts: provably undispatched reservations can be released with audit, but dispatched/uncommitted work becomes uncertain/consumed and cannot replay. Expired cache leases can be reconciled in a separate transaction locking the original owner job first. A second job waits; it never stampedes an identical cold-cache request. Cancel conservatively preserves spent/uncertain work and invalidates late commits. Recovered terminal jobs derive a conservative, fixed-time partial projection from their saved corpus if no finalized revision exists.

## Evidence and assessment

Maps labels use a versioned exact English mapping and JSON pointer. Negative attributes are processed first; absent attributes create no claim. Reviews/snippets are bounded, public-only immutable text, with review IDs and source-group hashes, actual source links and publication/edit/retrieval dates. Source text masks explicit unnecessary personal details while preserving UTF-16 offsets. Search snippets never claim a full page was reviewed. Ambiguous brand/branch matches remain in the ledger but are excluded before model extraction and cannot affect fit.

The verified Gemini wire schema retains required fields, enums and object structure while omitting decoder string/array bounds; full local Zod validation enforces every bound after the response. Scope and condition strings must be copied verbatim. The extraction version is `gemini-public-evidence-v3-verbatim-scope`. A successful SerpApi review response with absent reviews is empty only when its observed `reviews_results_state` is exactly `No reviews`; unexplained missing arrays remain schema failures.

Migration 004 separates Gemini's owner-configured 1000-attempt ceiling from provider account quota. That provider balance remains unknown (`null`); initialization preserves used counters, never presents a made-up provider balance, and increases need an explicit audited owner allocation.

Gemini receives only public branch context/excerpts, never visitor priorities, diagnoses or private requirements. JSON schema permits source ID, known feature/polarity, exact quote and bounded scope. The server controls all provenance. Validation checks corpus/venue, exact span, feature entailment, questions, negatives, conditions, instructions and speculative claims. Unvalidated multilingual semantics stay unclear. Rejected proposals are recorded as bounded validation reasons and prevent favorable partial fit. A small synthetic evaluation set is not evidence of live model reliability.

Assessment is a pure function of corpus, requirements and an explicit UTC `asOf`. It is separate from extraction and never uses the model to declare fit. Scope-specific support cannot satisfy an unspecified entrance/floor. Conditions stay unresolved. Undated attributes remain insufficient; retrieval does not date a venue observation. Structural freshness180 days, operational14 days are product heuristics, not standards. Edit date never refreshes an original observation. Lift presence cannot imply operation, and even recent operation asks for confirmation before arrival.

Comparable support and barriers remain conflicting. Recent must-have barrier → reported barrier; unresolved/conflicting/historical must-have or relevant extraction failure → needs confirmation; only supported must-haves with complete required evidence processing → evidence supports requirements. Preferred support cannot hide a must-have barrier. Questions are deterministic and never sent automatically.

## Budgets and retention

Discovery ≤1 SerpApi attempt; investigation ≤5 SerpApi and6 LLM attempts. Review dispatches/reuses ≤2; web ≤2. Planner consumes a call only while preserving a future extraction call, otherwise uses labeled deterministic fallback. It searches the highest-priority unresolved feature, respects visited actions, and stops after two unproductive targeted actions. Provider-billed allowance may differ from conservative application attempts.

Default buckets: global from real account allowance minus protected reserve, session12 searches, UTC-day30 searches, job caps. Verification jobs additionally share one durable30-search bucket. Reconciliation reduces total caps safely relative to consumed units; increases are separate audited owner actions. Environment and DB kill switches must both permit dispatch. Cache reads remain available when disabled. No automatic monthly reset or detached background worker.

Owner retention defaults: raw cache payloads7 days; normalized evidence/private reports30 days; sessions24 hours. Dry-run/delete scripts preserve provider/reservation audits required for current caps. No cron, vector DB, full HTML/images or arbitrary URL fetching.

## Official API references checked during implementation

- [Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).
- [SerpApi Maps place results](https://serpapi.com/maps-place-results), [review response shapes](https://serpapi.com/google-maps-reviews-api), [account allowance](https://serpapi.com/account-api).
- [Gemini generateContent JSON-schema support](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) and [pricing](https://ai.google.dev/gemini-api/docs/pricing). The pinned SDK exposes `responseJsonSchema`, JSON MIME, abort signals and explicit retry control. Configured default `gemini-3.1-flash-lite` still requires an actual account probe; no premium substitution.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

These docs and installed SDK types inform compatibility. They do not substitute for observed real account responses or a deployed smoke test.
