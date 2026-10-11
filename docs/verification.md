# Actual verification record

The plan is a specification. This file records executed checks and remaining gates separately. Synthetic evidence is confined to tests and explicit model-quality checks. The real browser investigation used configured SerpApi, Gemini and hosted Supabase services without response interception.

The dated records below are retained as history. The latest owner-requested balance policy and verification are recorded in the final 11 October section.

## Release identity and environment

- Tested application commit: `19e09f90b909bb364e5fd6dcdcda69497cfc38bc`. The following verification-document commit does not change application code.
- Verification: 10 October 2026, approximately 23:15–23:51 Asia/Calcutta (UTC+05:30), Windows local workspace. Final account/audit check: `2026-10-10T18:20:45Z`.
- Runtime: Node.js 22.22.2 / npm 10.9.7; Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3. Direct dependencies and CLI are exactly pinned.
- Lockfile SHA-256: `29654a749070e9c23b10c3d8696c827b9f8b1a0ab38bb622b687004291dc84d1`; unchanged after clean installation.
- Database migrations: `001_core.sql` through `004_llm_budget.sql`, applied to the intended linked hosted Supabase project. Migrations 001–003 were not rewritten. All four independently passed on disposable PostgreSQL 18.4 with UTF-8/UTC.
- Model: `gemini-3.1-flash-lite`, verified for structured extraction and bounded planning. Extractor/prompt: `gemini-public-evidence-v3-verbatim-scope`; planner: `allowed-menu-v1`; assessment: `conservative-requirement-fit-v1`; adapter: `serpapi-normalization-v1`; Maps labels: `maps-accessibility-labels-v1`.
- Local application: `http://localhost:3000`; production build left running. `APP_ORIGIN` matches this URL. Private code and all provider/server secrets remain in ignored `.env.local`.
- Vercel URL: **not created**. CLI reported logged out; no authorized project/token or Git remote is configured.

## Executed checks

| Check | Actual result |
|---|---|
| `npm ci --no-audit --no-fund` | Passed: 471 packages installed from the exact lockfile; no provider calls. |
| `npm run setup:local` | Passed twice; generated nothing further and preserved `.env.local` byte-for-byte. Initial setup generated only four missing application secrets, preserving provider credentials. |
| `npm run typecheck` / `npm run lint` | Passed strict TypeScript and configured ESLint. |
| `npm test` | **124/124** offline tests passed across four domain/provider/security/runner files; external fetch prohibited. |
| `npm run test:db` | **26/26** actual disposable PostgreSQL gates passed: migrations, grants, races, leases, budgets, dispatch ambiguity, immutable reports, Unicode and owner-budget metadata. |
| `npm run test:e2e` | **8/8** passed with installed Chrome and pinned Playwright. These are intercepted offline fixtures: login, branch choice, complete/unknown/partial, expiry, keyboard/axe/mobile, reload, hidden-tab pause and conflict recovery. |
| `npm run build` | Passed optimized compilation, TypeScript and prerendering, including a fresh build after clean installation. No provider requests during build. Step/admin routes declare 60 seconds; effective Vercel allowance remains unverified. |
| Production server | Started; health HTTP 200. Real API/browser flows below used the production build. |
| Hosted preflight | Passed migration 004/RPC version 2, RLS/private-grant checks, enabled search switches and allowance inspection. |
| Hosted migration push | Applied 004 after matching the linked project to the configured URL and inspecting pending migrations. No database reset. |
| `npm run retention` | Passed dry run; zero eligible rows. No deletion. |
| Real Gemini quality | Revised prompt passed the 28-example check below. |
| `npm run test:live:browser -- --confirm-live` | **Passed without mocks**: complete brief, pause/reload/resume, displayed citations, zero-call reassessment, independent-session denial, durable audit and secret scans. |
| Final source/build secret check | Zero configured-secret matches in 99 tracked/non-ignored files and 12 rebuilt browser static files. `.env.local`, `.verification/` and Supabase `.temp/` are ignored. This is a targeted check, not general secret-scanner certification. |

Npm deprecation, terminal-color and future Vitest config-loader warnings were non-fatal. Compatible pins were retained. Native browser/compiler/PostgreSQL and Supabase telemetry needed approved execution outside Codex's restricted Windows runner; ordinary terminals do not need that sandbox approval. README includes `npm.cmd` for a Windows script-policy error without changing machine policy.

## Real local investigation

Verified branch: **Casa Fresco, Indiranagar: All-Day Dining & Café**, 609, 2nd Main Rd, off 100 Feet Road, Binnamangala, Stage 1, Indiranagar, Bengaluru, Karnataka 560038, India. This is an actual discovered branch. Search: `cafes in Indiranagar`, Bengaluru; requirements: must-have step-free entrance and accessible restroom.

Final browser job `6d91f82c-2e88-47b1-ade6-d7e0ac43953a`, checked at 23:45–23:46 IST:

- Completed in **40.812 seconds**, including pause/reload, through 13 sequential steps. Ended `complete`, `needs_confirmation`, `no_new_evidence`; completion does not imply requirements were supported.
- Five genuine app-cache responses; **zero new SerpApi reservations** in this run; **four real Gemini workflow requests**. Reused evidence retains original retrieval timestamps and is not fixture replay.
- Eight sampled reviews examined, four accepted undated Maps attribute claims, 15 retained snapshots. Irrelevant visitor text generated no access observations; ambiguous web branches were excluded. Missing/undated evidence did not establish current access or lift operation.
- Three displayed attribute claims checked against retained exact text/pointers. Earlier real-cache audits also checked attribution, JSON pointer values, review dates and original/translated fields. No invalid source ID or quote was accepted in reviewed checks.
- Paused after exactly the first committed step; version 1 and attempt counts stayed unchanged before/after reload. Explicit Resume completed saved work without repeating that step.
- UI reassessment made restroom not needed and preserved SerpApi/Gemini counts, with no step request.
- A separate authenticated browser context received **404** for report GET, JSON export and cancellation.
- Actual response scan: **64 API bodies, 16 browser assets, zero read failures and zero configured-secret matches**. Access code cleared before screenshots. Durable counters/dispatch markers matched; all completed uncached searches had provider IDs.

Sanitized records and a code-free screenshot remain under ignored `.verification/`. Reviewer datasets and credential-bearing responses are not committed. The screenshot is not a narrated submission recording.

## Real provider shapes and corrected failures

| Actual observation | Handling verified |
|---|---|
| Maps discovery `local_results` | Five bounded resolvable candidates, actual opaque place/CID IDs and addresses. Names alone never merge branches. |
| Maps details `place_results` | Explicit positive/negative accessibility values and exact JSON pointers. Absent optional fields create no claims. |
| Newest `reviews` | Actual review IDs, original/translated snippet shapes and publication/edit/retrieval fields; eight examined, three bounded public text sources retained. |
| Filtered-review empty response | HTTP 200, `search_metadata.status: Success`, absent `reviews`, `search_information.reviews_results_state: No reviews`. Archive retrieval confirmed allowance 246→246, zero new searches. Only this exact form is empty; unexplained missing/null/wrong arrays remain failures. |
| Google `organic_results` | Eight bounded snippets with links/titles, clearly labeled as snippets. Ambiguous branches stay excluded. |
| Gemini full schema | Tiny probe succeeded while preview-model full extraction returned HTTP 400. Stable free-tier model with smaller decoder schema succeeded. Required fields/enums/object structure remain; full string/array bounds are enforced locally. No paid fallback/grounding. |
| Paraphrased model scope | First quality check rejected invented scope/conditions. Prompt now demands verbatim complete substrings; stricter review passed. Validation retained. |
| Ambiguous web claim | One `ambiguous_venue` rejection caused an earlier partial. Uncertain branches now remain in the ledger but are excluded before extraction and cannot support fit. |

Earlier failed runs remain durable and were not reclassified:

| Run | Search reservations | Cache hits | Workflow Gemini | Actual result |
|---|---:|---:|---:|---|
| Initial smoke | 3 | 0 | 1 | Partial: full extraction HTTP 400; sources/reassessment/privacy preserved. |
| Schema diagnosis | 0 | 3 | 1 | Partial: extraction HTTP 400 persisted. |
| Stable model | 1 | 3 | 2 | Extraction/planning succeeded; partial on unhandled empty reviews. |
| Empty-response fix | 2 | 3 | 4 | Full stages ran; partial on one ambiguous-branch proposal. |
| Final real browser | 0 | 5 | 4 | **Complete**, honest unknowns; browser gates passed. |
| **Total** | **6** | **14** | **12** | Four investigation partials, one complete investigation; five discoveries completed. |

## Credit accounting

- Durable verification allocation: **6/30** reserved/consumed SerpApi attempts; **24 remaining**. No reset/bypass.
- Account: **250 initially → 245**, checked at 23:50:45 IST. Six reservations are conservative; one dispatched response was served from SerpApi's own cache without reducing that balance.
- Search audit: five completed, one failed, zero uncertain/outstanding. Completed requests missing provider IDs: zero. The failed shape consumed its reservation.
- Gemini workflow audit: 12 reservations, ten completed, two failed, zero uncertain/outstanding. Owner setup/model probes and two synthetic-quality calls are separate explicit diagnostics, not SerpApi searches.
- Gemini's **1000** ceiling is an owner attempt cap; provider remaining quota is **unknown/null**, not a made-up balance. Migration 004 corrected metadata and preserves used counters; increases require explicit allocation.
- Local verification mode remains enabled. Development/deployment using a shared provider key must share this budget database.

## Extraction quality and offline acceptance

The offline proposal set has 41 synthetic examples testing validator behavior: positives, negatives, conditions, scope, language uncertainty, injection, attribution, citations and future plans. Accepted invalid citations/unsupported positive proposals: zero. This is not a model-output evaluation.

Two explicit Gemini calls used 28 selected synthetic sources, never production evidence. The first produced 21 proposals/13 accepted with zero harmful positives, but failed on paraphrased-scope rejections, three scope omissions and three unresolved critical cases. With the verbatim-scope prompt, the second produced **20 proposals, 20 accepted, 20 correct feature/polarity pairs, zero unsupported positives, zero invalid accepted citations, zero scope omissions and zero unresolved critical negatives/conditions**. Ambiguous branch, irrelevant and injection text yielded no claims. Five question/request/speculation/future examples yielded no claims and remain unknown. The small set does not establish general reliability.

T01–T30 are covered by offline domain/security/runner, actual PostgreSQL concurrency/grants and intercepted browser tests. Actual local checks additionally passed response shapes, secret boundaries, extraction/planning, saved brief, reassessment, reload/resume and independent-session denial. Controlled invalid-key/quota/network/JSON failures use test injection; real quota was not deliberately exhausted. Automated axe/keyboard/mobile checks passed offline. Manual assistive-technology and true browser 200% zoom review remain open.

Initial offline release `e916a321504479f3a41da1f5c2b39513c00eee90` had 114 offline tests, 25 database gates, eight browser checks and a passing build. Its absent credentials were true then; the owner supplied credentials for this verification. Earlier dependency, Unicode, concurrency, corpus and future-observation fixes remain covered.

## Remaining gates and missing access

1. **Vercel account/project:** CLI logged out; no authorized project/token or Git remote. README has personal Hobby login/link/deploy steps and server-only environment setup. No deployment/incognito production check ran. Effective function duration, HTTPS cookie behavior and deployment protection require that environment.
2. **Narrated hackathon recording/public repository:** real local flow is ready for the documented 2:40 demo; no narrated video/upload, public repository or submission was created. README/demo disclose Codex coding assistance and Gemini extraction/planning.
3. **Manual accessibility:** assistive-technology/200% browser zoom remain; automated checks do not certify accessibility.

No P1, paid service, Python server, photo analysis, street routing, embeddings or multi-agent application framework was added.

## 11 October follow-up: prominent result and cap explanation

The owner reported confusing search-cap/partial messages and requested a one-line result before the detailed report. The UI now places the deterministic result above the requirements controls and progress panel on desktop and mobile. Its three outcomes are supported must-haves, a reported must-have barrier, and requirements not confirmed. It shows actual must-have counts and unresolved feature names. Preferred support cannot hide an unknown must-have; even a malformed saved positive overall field is displayed as unconfirmed when the evidence is partial. The details link scrolls and moves keyboard focus without starting any steps.

Read-only audit of the owner's saved Phoenix Marketcity investigation (`3fc1f1c0-1056-41b4-94c4-b80092b833b4`):

- Normal investigation cap: **5/5 SerpApi**, **5/6 Gemini**; all ten provider requests completed. No global allowance failure or stuck lease was found.
- The brief is partial because five extracted candidates failed validation: two non-verbatim quotations, two feature entailment failures and one support entailment failure. These were excluded. All eligible source text was processed; the saved partial flag was not cleared or rewritten.
- **41** saved sources, **25** sampled reviews, **10** accepted claims. All **three** selected must-haves remain insufficient. Undated/generically scoped evidence cannot establish these requirements; internal movement has no accepted observation.
- The normal cap message now describes the bounded stop. The separate partial explanation identifies claims that could not be verified, instead of suggesting that hitting the search cap itself invalidates a report.
- No new SerpApi or Gemini requests were made for this change. The saved verification allocation is **12/30** used, **18** available; it was not reset or raised. The saved account balance is historical, not a fresh provider check.

Offline workflow regressions additionally verify that reaching the normal search cap saves a **complete, unconfirmed** brief when required processing succeeded, and preserves **partial, unconfirmed** when extraction independently failed. These checks prohibit provider fetches.

| Follow-up check | Actual result |
|---|---|
| `npm test` | **126/126** passed, including the two normal-cap/independent-failure regressions. |
| `npm run typecheck` / `npm run lint` | Passed; final full-project ESLint exit 0. |
| `npm run test:e2e` | **14/14** passed against intercepted offline fixtures. Includes all eight previous browser flows plus supported/barrier/unknown summaries, preferred vs must-have priority, partial-positive protection, and both recorded validation-failure formats. Mobile ordering, detailed-report keyboard focus and existing axe checks passed. |
| `npm run build` | Passed again after final wording changes; optimized production build and TypeScript completed. |
| Actual saved private report | Reloaded in the owner's existing authenticated in-app browser against the rebuilt production server. Headline **Requirements not confirmed — check with the venue before visiting.**, **0 of 3** must-haves, all three feature names, and the excluded-claims explanation verified. Result precedes controls; displayed attempts remain **5/5**. No new investigation or provider dispatch. |

The production server was restarted on the existing localhost3000 port and left running. The screenshot `.verification/result-headline-unknown.png` is clearly labeled **synthetic test venue** and is an offline UI preview, not real venue evidence. No database migration changed; the previous 26 PostgreSQL gates were not rerun for this display-only change. No deployment was created; the previously documented Vercel access gap remains.

The review also identified follow-up cases outside this display change: cached follow-up eligibility at the search cap, optional search-budget denial classification, finalization at the twentieth step, and overly generic model scope labels. They require dedicated regressions and a provenance-preserving implementation; none caused this run's validation failures. No budget, extraction, assessment, migration or saved evidence semantics were loosened here.

## 11 October: balance-sensitive full investigation

Tested application commit: `aac3f8947b7fe6658107bea3163270589fa7c428`. The following verification-document commit does not change application code.

The owner explicitly requested the five-search policy only when SerpApi remaining credits reach 50 or fewer, a full bounded investigation above that threshold, and publication to `amrs-tech/AccessReality`. This supersedes the plan's original universal five-search ceiling.

- New investigations with a fresh trusted remaining estimate above 50 use a finite balanced menu: details, newest reviews and at most three distinct checks for each unresolved must-have (reviews, branch-specific snippets, and the observed venue domain when available). Maximum 26 searches, 56 model requests and 128 steps; five active minutes, protected reserve and global/day/session limits remain.
- At 50 or fewer, or without a recent trusted account balance, the job uses the five-search policy. Reservations and the final pre-dispatch check re-evaluate this atomically. Valid cached responses remain eligible after a search limit is reached. Saved terminal investigations keep their original policy and evidence; start a new investigation to apply the new policy.
- Optional search-budget denials after completed processing save a complete unconfirmed brief. Failed required checks, excluded invalid extraction proposals and ambiguous dispatches remain partial. A pre-dispatch release can save its failure checkpoint without a duplicate refund. Closing at the workflow bound now persists the report.
- Extraction uses immutable batches of at most 32 sources and 24,000 characters. Extraction validation, deterministic assessment, dated lift-operation requirements and unknown semantics were retained.
- Migrations 005 and 006 were first exercised on disposable PostgreSQL18.4, then applied only after inspecting pending migration names and matching the linked project to the configured Supabase URL. No remote reset; 001–005 were not rewritten after application.
- The first free live account reconciliation revealed that the hosted database clock was approximately20 seconds ahead of the Windows host. Migration006 uses database receipt time and database elapsed-time validation, preserving the host retrieval timestamp only as diagnostic metadata. Both clock directions, old/forged snapshots, fencing and kill-switch preservation passed.
- Owner budgets were deliberately configured to60 searches per UTC day and64 per session (Gemini240/96), preserving global220 and protected30. The separate original30-attempt verification allocation and its used counters were preserved. Credentials were retained unchanged in ignored `.env.local`.

| Executed check | Actual result |
|---|---|
| Offline unit tests | **162/162 passed** across five files after the verified empty-search fix; no provider fetches. |
| TypeScript / ESLint | Passed, including final verification-script edits. |
| Disposable PostgreSQL | **42/42 gates passed**, including all prior races, leases, grants and accounting gates, plus balance51/50, sixth search, crossing reservations, fresh/unknown/stale policies, cache at cap, observation fencing, refunds, kill races, clock skew and released-attempt checkpoints. |
| Offline browser tests | **18/18 passed** in Chrome. API interception is confined to these tests; headline, expanded/conserving/legacy policies, privacy, keyboard, axe and mobile flows passed. |
| Production build | Passed optimized Next.js compilation, TypeScript and prerendering. |
| Hosted database / balance | Preflight passed migration006/RPC3, RLS and private grants; actual `total_searches_left`239, fresh expanded policy26. Gemini provider quota remains unknown. No model probe was made for this follow-up. |

The first real-browser invocation stopped during storage preflight with `dependency_unavailable` before login/discovery and before creating a new verification record. A subsequent direct preflight passed with the same239 balance; no search attempt was added by that failed invocation. The following live retry is recorded separately below.

The next real browser run (`eeb8121d-3298-4843-84a1-c84d60af92ba`) selected the actual Casa Fresco branch and used expanded26 mode. It finished in75.487 seconds with a **partial, needs-confirmation** brief: an optional venue-domain query returned the provider's special successful-empty format, which was initially treated as an upstream error. Pause/reload/resume, three displayed exact citations, zero-call reassessment, independent-session404 read/export/cancel, durable counters and94 API/16 static body scans passed; the complete-report gate correctly failed. It used7 SerpApi reservations (six completed and one failed), one genuine app-cache reuse and8 Gemini requests. Account239→232; verification12→19/30. This saved partial was not rewritten.

One additional transactionally reserved diagnostic request inspected that same actual query: HTTP200, `search_metadata.status: Success`, `search_information.organic_results_state: Fully empty`, the exact documented no-results message and absent `organic_results`. The corrected live run later received that same provider ID from SerpApi's own cache. The diagnostic harness captured the wire shape but failed its report checkpoint; its record remains partial/diagnostic-only and its attempt remains consumed/failed. It does not pretend to be an investigation report. Its conservative reservation brings verification usage to20/30, despite provider-cache reuse. A second invocation with the same idempotency key was rejected as terminal without a further dispatch.

The corrected provider and web adapter accept only that exact [documented successful-empty shape](https://serpapi.com/api-status-and-error-codes) for Google organic search, producing an empty source list and no invented claim. Wrong engines, error/status/state combinations, nonempty or malformed result arrays and arbitrary errors remain failures. Fifteen shape regressions passed; the production app was rebuilt before the final live check.

### Final real browser result

Final real job `45fc6ee1-ba3a-4ca6-9236-c8b37ac63f8d`, 11 October11:56–11:58 IST, against the rebuilt localhost production server with no response interception:

- **Passed**, terminal `complete`, report not partial, `needs_confirmation`, `no_eligible_actions`, expanded26 policy. Completed in **88.953 seconds** including pause/reload/resume, through29 sequential investigation steps. All eight eligible investigation actions for the two selected must-haves completed; discovery adds one response.
- **Two new SerpApi reservations, seven genuine app-cache reuses including discovery, ten Gemini requests.** Original retrieval dates and provider IDs were retained. One newly reserved response was served by SerpApi's own cache; actual balance232→231.
- Four accepted undated listing claims and five sampled reviews. Three exact displayed quotations/pointers spot-checked. Missing, generic or undated public evidence remained insufficient and the headline clearly said requirements were not confirmed. No current lift operation was inferred.
- Pause/reload held version1 and unchanged attempts until explicit Resume. Requirement reassessment made zero provider requests. An independent authenticated session received404 for reading, export and cancellation.
- **107 actual API bodies and16 served browser assets scanned: zero read failures, zero configured-secret matches.** Real counters matched provider attempts and dispatch markers. All completed uncached searches had provider IDs; zero uncertain searches.
- Verification ended **22/30**, eight left. Total follow-up reservations were10 (seven in the earlier partial, one diagnostic, two in the successful run); actual account239→231. No verification allocation was raised or reset. Account checks consumed no search credit; no extra live model-quality/probe calls were made.

Final read-only audit found104 tracked/non-ignored source files and12 rebuilt browser static files with zero configured-secret matches. A separate scan of all128 historical Git blobs found zero exact secret or recognized credential/private-key/token pattern matches; all seven ignored-artifact checks passed. `.env.local`, `.verification/`, database scratch data, `.next`, dependencies, Supabase `.temp` and Vercel state are excluded. This is a targeted audit, not general secret-scanner certification.

The original account gate, private sessions, RLS/grants, reservations, kill switches and protected reserve remain. Ordinary owner demo mode was enabled only after the initial live verification finished; the30-attempt record is retained. Old terminal reports still show their original limit and partial state. The under-three-minute recording plan and Codex/Gemini disclosure are in `docs/demo-script.md`; no narrated video or hackathon submission was created. Vercel remains undeployed because no authorized Vercel login/project/token is available; README gives the exact personal Hobby setup and deployment steps.
