# Actual verification record

The supplied implementation plan is a specification. This file records executed checks separately from the remaining live release gates. Synthetic evidence appears only in tests. No provider credentials, real reviewer dataset, production fixture mode or invented venue demonstration was used.

## Environment and release identity

- Verification date: 10 October 2026, Asia/Calcutta (UTC+05:30); local Windows workspace.
- Application commit: recorded after the final passing checks below; the subsequent documentation commit changes this record only.
- Dependency lockfile SHA-256: `29654A749070E9C23B10C3D8696C827B9F8B1A0AB38BB622B687004291DC84D1`.
- Runtime: Node.js 22.22.2 / npm 10.9.7. Next.js 16.4.0, React 19.3.0, TypeScript 6.0.3; exact pins and lockfile committed.
- Database migrations: `001_core.sql`, `002_private_access.sql`, `003_workflow_rpcs.sql`; applied to disposable PostgreSQL 18.4 with UTF-8 encoding and UTC, not a hosted Supabase project.
- Configured model default: `gemini-3.1-flash-lite`. Actual model/account access and structured output are **unverified**.
- Extraction version: `gemini-public-evidence-v2-conservative`; planner `allowed-menu-v1`; assessment `conservative-requirement-fit-v1`; adapter `serpapi-normalization-v1`. The Maps label extractor is separately versioned `maps-accessibility-labels-v1`.
- Local public application URL: `http://127.0.0.1:3000`. Production deployment URL: **not created**.
- Real selected venue/branch: **none**. Search attempts: **0 / 30 verification allocation**. Gemini requests: **0**. Real app cache hits: **0**. Account remaining balance before/after: **unknown; no account request made**.

## Executed checks

| Check | Actual result and limit |
|---|---|
| `npm ci --no-audit --no-fund` | Passed; committed lockfile unchanged. |
| `npm run typecheck` | Passed strict TypeScript check. |
| `npm run lint` | Passed configured ESLint. |
| `npm test` | 114/114 passed across four offline domain/provider/security/runner files; external fetch prohibited. |
| `npm run test:db` | 25/25 actual disposable PostgreSQL gates passed, including grants, leases, races, recovery, immutable reports and Unicode. Instrumented provider fakes dispatch locally only. |
| `npm run test:e2e` | 8/8 passed using installed Chrome and pinned Playwright. Login, exact branch choice, complete/unknown/partial briefs, zero-search reassessment, expiry, reload/resume, hidden-tab pause, sequential 409 recovery, mobile layout, keyboard flow and axe checks. APIs are explicitly intercepted with synthetic test data. |
| Automated accessibility | Zero axe violations in the checked entry and report screens; keyboard/mobile assertions passed. This does not certify accessibility. Manual real-flow/200% zoom review remains pending. |
| `npm run build` | Passed optimized production compilation, TypeScript and prerendering with no credentials or provider requests. Next functions manifest records 60 seconds for step/admin-preflight; Vercel account allowance is unverified. |
| Built production server smoke | `/` 200 and AccessReality page; `/api/health` 200; `/api/session` 200 with `configured:false`; protected `/api/jobs/<uuid>` 401. No private investigation could run without credentials. |
| Limited secret checks | Zero server-secret variable-name matches in browser static assets; zero recognizable Google/Supabase/Vercel key-pattern matches in application, test and documentation files. `.env.local` absent. This is a targeted check, not a comprehensive secret-scanner certification. |
| `npm run preflight` | Stopped before network access: required configuration absent. |
| `npm run test:live` | Stopped before network access: required configuration absent. Real smoke did **not** pass or run. |

## Offline acceptance coverage

| Plan gates | Evidence |
|---|---|
| T01–T19 | Pure assessment, date, branch/scope, exact citation validation and adapter regressions in `tests/unit/domain-evidence.test.ts`; manually labeled synthetic proposals in `tests/fixtures/extraction-quality.ts`; deterministic zero-network reassessment also tested in PostgreSQL/browser. |
| T20 | Instrumented runner proves zero dispatch when DB unavailable or budget denied; PostgreSQL reservations prove caps. |
| T21–T25 | Actual concurrent PostgreSQL reservations/leases/cache: ten callers for final credit yield one fake dispatch; duplicate versions, stale holders, abandoned dispatch and cache contention cannot replay or overspend. |
| T26–T27 | Ownership-bound server query, actual cross-session SQL lease/cancel/reassess denials, browser-role RLS/grants and every internal RPC denied. Production HTTP sign-in boundary checked; real independent-browser private report/export ownership remains pending. |
| T28 | URL allowlist strips unsafe schemes and sensitive query parameters; evidence renders as plain React text. No source HTML execution API exists. |
| T29–T30 | DB idempotency/recovery and UI reload/hidden-tab/409 sequential tests; DB kill-switch dispatch denial. Real browser interruption and deployed kill-switch behavior remain pending. |

The reviewed synthetic validator quality set contains 41 labeled proposals spanning positive, negative, conditional, multilingual, irrelevant, injection and future/planned cases: 33 accepted correct feature/polarity proposals, 7 rejected, 1 irrelevant; 15 accepted ambiguous proposals stayed unclear. Unsupported positive proposals accepted: 0. Accepted invalid citation IDs/spans: 0. **This evaluates validator behavior on proposed model outputs, not Gemini extraction quality.** Real model extraction must still be reviewed on the labeled set and real text; this small set cannot establish general reliability.

## Failures found and corrected

- ESLint 10 was incompatible with Next's peer range and TypeScript 7 was incompatible with the configured lint parser. Compatible exact ESLint 9.39.5 / TypeScript 6.0.3 pins passed the checks after correction.
- Native compiler, browser and disposable database processes could not run reliably inside the Windows sandbox. Authorized execution outside it passed; no paid service or provider fallback was introduced.
- Vitest's fork pool hit a transient temporary-file loader error. A single-worker thread pool passed reproducibly with network disabled.
- Parallel SQL teardown briefly raced ESLint's file enumeration. Disposable database directories are now excluded and lint passed. Vitest prints a non-blocking future config-loader warning; its current configured loader passes.
- Disposable PostgreSQL initially inherited a Windows single-byte encoding. Explicit UTF-8 corrected multilingual persistence; its real SQL regression passed.
- Review edits/future or malformed source dates could upgrade uncertain observations; corrected normalization and freshness regressions pass.
- Concurrent cached normalization could produce claim IDs that differed from the canonical SQL ledger. Deterministic, versioned source/claim identities and cached-source reuse regressions corrected the mismatch.
- Full report arrays duplicated the durable checkpoint corpus, including after reassessment. Full immutable revisions now remain in `assessments`; checkpoints retain the bounded corpus once. Corpus limits produce explicit partial results.
- Future/planned statements could become current positive evidence even with an exact quote. A full-source modality guard now preserves those as unclear, including trimmed quotations. Extraction version advanced so older cached extraction is not reused.
- A final runner-test optional-null type error was corrected and typecheck rerun.

## Required access and remaining release gates

Missing: SerpApi API key and checked allowance; Gemini API key with access to the configured free-tier model; Supabase project URL, server secret and migration authorization; local private code plus three generated secrets; canonical origin configuration; authorized personal Vercel project/login and a repository remote for publishing. No account authorization was invented.

Follow README's exact setup/deployment commands. Keep the same Supabase budget database for development and deployment using a shared provider key. Initial verification jobs require `VERIFICATION_MODE=true`, `SEARCH_ENABLED=true`, deliberate owner reconciliation, and explicit `npm run test:live -- --confirm-live`. The durable allocation refuses more than 30 SerpApi attempts; normal operations do not reset it.

Before claiming live completion:

1. Apply the migrations to the intended Supabase project, run owner preflight and its explicit Gemini probe, reconcile actual allowance, then enable dispatch.
2. Observe real SerpApi discovery/details/newest-review/optional gap response shapes (up to four attempts). Record sanitized field shapes, exact branch identifiers, provider search IDs, original/publication/edit/fetch date behavior and absent optional fields. No captured real provider fixture currently exists.
3. Complete one local real investigation (up to six attempts), inspect at least three claims against their original sources or all if fewer, record the low evidence count, prove zero-spend reassessment and one mid-run reload/resume. Check browser responses for secrets using counts only.
4. Deploy the tested commit to authorized Vercel and complete an incognito real investigation (up to six attempts), including one legitimate uncached dispatch and a second-session private GET/export/cancel denial. Check cookie flags, exact origin, Fluid Compute duration, private grants and active Supabase state.
5. Run real Gemini extraction on the labeled examples and review semantic polarity, conditions, scope and exact spans; tighten semantics if any unsupported positive appears. Do not call the offline proposal set a model-quality pass.
6. Record the genuine under-three-minute local demo in `docs/demo-script.md`, upload an accessible video and add only verified repository/video/deployment links. AI tooling disclosure is in README; no recording or hackathon submission has been made.

No P1 functionality was added to bypass these gates.
