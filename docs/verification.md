# Actual verification record

The plan is a specification. This file records executed checks and remaining gates separately. Synthetic evidence is confined to tests and explicit model-quality checks. The real browser investigation used configured SerpApi, Gemini and hosted Supabase services without response interception.

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
