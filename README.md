# AccessReality

**Know the barriers before you arrive.** A private, single-venue accessibility evidence investigator. Choose practical requirements, select an exact branch, and read a source-linked brief that preserves barriers, contradictions, old observations and unknowns.

P0 application implemented. Hosted Supabase migrations, real SerpApi response shapes and Gemini extraction/action selection have been verified with the owner's credentials. Offline tests use labeled synthetic evidence only. See [verification](docs/verification.md) for actual outcomes and remaining deployment gates. There is no production mock-data switch.

## What it does

- Seven explicit requirements with must-have / preferred / not-needed priorities; lift access expands into presence and operation.
- Up to five exact venue candidates. Names alone never merge branches.
- Short, sequential, persisted steps: listing → newest reviews → schema extraction → deterministic assessment → a permitted gap search → brief.
- A dated evidence ledger, separate arrival/entrance/movement/seating/restroom barriers, specific confirmation questions, print and JSON export.
- A prominent result above the detailed report: must-haves supported, a reported must-have barrier, or requirements not confirmed. Missing evidence stays unconfirmed; preferred requirements cannot override a must-have, and incomplete evidence cannot produce a favorable headline.
- Private 24-hour demo sessions, origin + session-bound CSRF checks, durable ownership checks and inaccessible browser database tables/RPCs.
- PostgreSQL leases, version checks, idempotency keys, global/day/session/job budgets, an owner kill switch, reservation audits, dispatch markers and uncertain recovery.
- Shared bounded caching. Changed requirements reuse the saved corpus with zero searches; new gap investigation requires an explicit action. Corpus limits (60 snapshots, 48,000 combined text characters, 96 claims and 24,000 quote/scope characters) produce an explicit partial result when exceeded.

SerpApi is essential for live public branch discovery and evidence. The three engines are `google_maps` (discovery/details), `google_maps_reviews` (small newest/keyword samples), and `google` (branch-specific search snippets, not full pages). Gemini extracts exact public quotations with a JSON schema and chooses only from a server-built action menu. Server validation rejects invented citations or unsupported favorable interpretations. Assessment, freshness, barriers, questions, eligibility and budgets are deterministic. Visitor requirements are not sent to Gemini.

No accessibility confidence percentage, invented dimensions, fabricated reviews or inference of a currently working lift. This is public evidence, not an inspection or certification. No routing, photo analysis, embeddings, Python service, external agent framework or P1 shares/comparison.

A five-search cap is the normal limit for one investigation, not a conclusion about the venue. A completed run can still need confirmation. A partial brief separately means some evidence could not be fully validated or processed; rejected claims never establish fit. The headline and its must-have counts appear before the requirements controls and progress details on desktop and mobile. Use **View detailed report** for the evidence and questions, or reassess the saved corpus without searches.

## Local setup (Windows PowerShell)

Use Node.js **22.x** (verified locally with 22.22.2). All direct dependencies and the Supabase CLI are pinned; use the committed lockfile.

```powershell
npm ci
npm run setup:local
```

Fill `.env.local` with a SerpApi key, a Gemini key with access to the configured free-tier model, and a Supabase Free project's URL/server secret. `npm run setup:local` generates only missing `DEMO_ACCESS_CODE` and three distinct 32-byte secrets for `ADMIN_API_SECRET`, `SESSION_HMAC_SECRET`, `RATE_LIMIT_HMAC_SECRET`; it preserves existing values and never prints secrets. Read `DEMO_ACCESS_CODE` in that ignored file to sign in. Never put secrets in browser variables, source, terminal command arguments or screenshots. Set `APP_ORIGIN=http://localhost:3000`. Keep `SEARCH_ENABLED=false` until setup succeeds. No provider credentials are supplied with this repository.

Supabase server credentials can be the project's supported secret key or legacy service-role key. Do not use its publishable/anon key. Migrations enforce service-role privileges and no browser access.

```powershell
# Authentication is interactive. Target only your intended development project.
npx supabase login
# Supabase configuration is already committed; do not run init again.
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
# Inspect pending migration names and selected project before applying.
npx supabase db push
npm run preflight
npm run preflight -- --probe-llm
npm run budget:init -- --enable --allow-increase
```

`budget:init` reads actual SerpApi remaining allowance and protects the reserve. Normal reconciliation never automatically raises or resets used caps. `--allow-increase` is a separate audited owner action for initial activation/renewal; migrations start at zero, so the first setup command above includes it deliberately. Later reconciliation should omit that flag unless the owner is explicitly allocating renewed allowance.

```powershell
# Then edit .env.local: SEARCH_ENABLED=true
npm run dev
```

Open [localhost](http://localhost:3000), enter the private access code, choose requirements, explicitly enter a city (Bengaluru is the editable default), and search. Select the correct branch before investigating. You can return to the investigation URL; it continues while the page is open. Resume is explicit after reload, hidden tab, disconnection or a provider retry wait.

The front page and `/api/health` run without credentials, but the real investigation requires durable Supabase and providers. A disabled database or environment kill switch prevents new dispatches; saved reports remain readable. No Docker is needed for a local Next.js app connected to hosted Supabase. The database test script creates its own disposable PostgreSQL instance and never resets a remote project.

## Checks and owner commands

| Script | Purpose |
|---|---|
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | Independently configured ESLint |
| `npm test` | Offline domain, adapter, security and workflow tests; external fetch prohibited |
| `npm run test:db` | Real disposable PostgreSQL migration, grants, concurrency and recovery tests |
| `npm run test:e2e` | Offline Playwright API interceptions and axe checks |
| `npm run setup:local` | Generate only missing private application secrets in ignored `.env.local` |
| `npm run build` / `npm start` | Production build / server; no provider calls during build |
| `npm run preflight -- --probe-llm` | Owner DB/RPC/account check; optional explicit Gemini schema probe |
| `npm run budget:init -- --enable` | Conservative real allowance reconciliation and deliberate DB enable |
| `npm run test:live -- --confirm-live` | Opt-in real smoke, durable verification allocation required |
| `npm run test:live:browser -- --confirm-live` | Actual Chrome login, pause/reload/resume, citations, reassessment, privacy and secret checks |
| `npm run test:live:quality -- --confirm-live` | One real Gemini call on 28 labeled synthetic examples; no venue search |
| `npm run retention` | Retention dry run |
| `npm run retention -- --delete` | Owner-requested permitted cleanup, budget audit retained |

For browser tests, install the pinned Playwright Chromium once with `npx playwright install chromium`, or use installed Chrome:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Native compiler/browser/database processes needed permission outside this Codex Windows sandbox; this was an execution-environment limitation, not a provider fallback. Ordinary terminals should not require that approval.

If preflight lists missing application secrets, run `npm run setup:local`. If port3000 is already in use, stop the existing app in its terminal before starting another. Changes to `.env.local` require restarting the production server. `APP_ORIGIN` must match the address used in your browser: use `http://localhost:3000` with the default setup. Supabase CLI telemetry writes to the user's home folder; restricted Codex execution needs approved filesystem access. Do not rerun `supabase init` once `supabase/config.toml` exists.

If Windows reports that `npm.ps1` cannot run because scripts are disabled, invoke the same commands with `npm.cmd` (for example, `npm.cmd run dev`). There is no need to weaken the machine's script execution policy. A clean `npm ci --no-audit --no-fund` was verified with Node 22.22.2/npm 10.9.7. Deprecation and color/config-loader warnings observed during checks were non-fatal; exact compatible pins are retained.

## Live verification and credit accounting

Real local investigations have been run with the owner's configured credentials; search usage and failed attempts are recorded in [verification](docs/verification.md). A cold use costs up to **one discovery + five investigation attempts**. The application counts reserved/consumed attempts conservatively, including uncertain timeouts and responses served from SerpApi's own cache; these are not exact provider-billed credits. An app-cached response costs zero attempts. TTLs: discovery/reviews/snippets 6 hours, details 24 hours; original source/fetch dates are retained.

The default global SerpApi operational ceiling is bounded by `min(owner_cap, actual_remaining - protected_reserve)`, with a protected reserve of 30. Gemini's global ceiling is an owner-configured limit of1000 attempts, not a retrieved provider balance; its remaining account quota stays unknown. Global, UTC-day (default30), session (12) and job (5 searches, 6 LLM attempts) checks are atomic. No month-based reset. Development and deployment sharing a provider key must share this database. Do not initialize independent budgets for the same key.

For the initial **30-search maximum** verification allocation, set `VERIFICATION_MODE=true` in the running app and local `.env.local`, enable searches deliberately, then run the explicit live scripts. The server tags jobs into a durable allocation bucket; clients cannot select it or change caps. Search smoke scripts need room for a complete six-attempt run and refuse when unavailable. They write sanitized results under ignored `.verification/`. `LIVE_APP_URL` can select the authorized deployed URL when its origin matches `APP_ORIGIN`. The configured local setup remains in verification mode to preserve the 30-attempt ceiling. For ordinary owner-controlled demos, explicitly set `VERIFICATION_MODE=false` and restart; the other durable caps still apply. Model quality checks make one Gemini request each; its account quota is not exposed as a verified balance.

Provider failures produce readable partial briefs; timeout/network ambiguity consumes the reservation and prevents silent replay. Known429/5xx errors have at most one later capped retry. Text extraction failure preserves public sources. Invalid model planning uses a labeled deterministic fallback. Closing a browser pauses initiation, not already dispatched requests.

## Vercel deployment

1. Apply migrations to the intended Supabase Free project. Check it is active.
2. Run all offline checks and `npm run build`; commit and push the tested tree to your repository. Scan for secrets before making the hackathon repository public.
3. Import the repository in your **personal Vercel Hobby** account with the Next.js preset and Node22. Keep the normal server build; do not enable static export. Alternatively, use the verified Node22-compatible CLI version:

   ```powershell
   npx vercel@63.1.2 login
   npx vercel@63.1.2 link
   npx vercel@63.1.2 --prod
   ```
4. Set all server-only `.env.example` values in Production. Initially disable search. Set `APP_ORIGIN` to the exact production HTTPS origin and redeploy. Use `APP_COMMIT_SHA` for release metadata if desired. Preview should disable search or share the same conservative DB allocation; no independent counter for the same key.
5. Check `/api/health`, confirm Vercel Fluid Compute and effective60-second step-route duration, reconcile the shared budget deliberately, then enable searches and redeploy.
6. Run the real deployed smoke in an incognito session, including at least one legitimate uncached dispatch and a second-session ownership check. A green build alone does not verify deployment. Confirm deployment protection settings and Supabase activation before judges visit.

The Vercel CLI is installed but its account check reports logged out. No authorized Vercel project/token or repository remote is configured here, so no deployment URL was created. Hobby eligibility/free model quotas are account-specific; no billing or paid fallback is enabled.

## Hackathon submission

Recommended track: Knowledge & Public Interest. [Local demo script](docs/demo-script.md) describes a 2:40 recording with actual live evidence and disclosure of cache reuse. **Recording link: not yet recorded. Deployment URL: not created.** Add only real links after verifying incognito access. Do not submit synthetic test examples as a live demo.

AI tooling disclosure: OpenAI Codex generated and reviewed code, SQL, tests and documentation with parallel coding assistants. The application uses Google Gemini for public-evidence extraction and bounded action selection. No AI-created venue reviews, measurements or demonstration allegations were used. The owner must review the code and record the locally working real-provider flow.

Further details: [architecture](docs/architecture.md), [actual verification](docs/verification.md), [acceptance checklist](docs/checklist.md).
