# AccessReality

**Know the barriers before you arrive.** A private, single-venue accessibility evidence investigator. Choose practical requirements, select an exact branch, and read a source-linked brief that preserves barriers, contradictions, old observations and unknowns.

P0 application implemented. Hosted Supabase migrations, real SerpApi response shapes and Gemini extraction/action selection have been verified with the owner's credentials. Offline tests use labeled synthetic evidence only. See [verification](docs/verification.md) for actual outcomes and remaining deployment gates. There is no production mock-data switch.

## Using a hosted demo

**Visitors do not need their own SerpApi, Gemini, Supabase, or admin API keys.** The deployment owner supplies those credentials on the server. Visitors use the website and never configure `.env.local` or install development tools.

The current application requires an **owner-provided demo access code** to unlock live searches and create a private 24-hour report session. This code is an application access gate, not a provider API key. Obtain it privately from the owner; it is not published in this repository. Opening the landing page requires no code. Public hosting does not automatically remove the access gate. Code-free anonymous access is not implemented in this version.

No verified public deployment URL is configured in this repository. GitHub has no recorded deployment, and there is no linked local Vercel project. The working local address is [http://localhost:3000](http://localhost:3000). The deployment instructions below are for the owner; add a public URL only after verifying it.

## Run the interface without live credentials

Install Node.js **22.x** and Git, then run:

```powershell
git clone https://github.com/amrs-tech/AccessReality.git
cd AccessReality
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The landing page and `/api/health` work without provider credentials. Live venue discovery and investigations require the owner setup below. Offline tests also work without real credentials; their synthetic evidence is confined to test interceptions and never enables a mock production investigation.

## What it does

- Seven explicit requirements with must-have / preferred / not-needed priorities; lift access expands into presence and operation.
- Up to five exact venue candidates. Names alone never merge branches.
- Short, sequential, persisted steps: listing → newest reviews → schema extraction → deterministic assessment → a permitted gap search → brief.
- A dated evidence ledger, separate arrival/entrance/movement/seating/restroom barriers, specific confirmation questions, print and JSON export.
- Available public listing and review photos appear in a source-linked gallery. Capture dates remain unknown; photos never enter Gemini or establish accessibility, dimensions or current lift operation. Profile pictures are excluded. Existing saved reports need a new investigation because earlier adapters did not retain photo references.
- A prominent result above the detailed report: must-haves supported, a reported must-have barrier, or requirements not confirmed. Missing evidence stays unconfirmed; preferred requirements cannot override a must-have, and incomplete evidence cannot produce a favorable headline.
- **Visit Watch — before-you-go news signals.** After a saved completed or partial brief, explicitly check published venue/area news for closure, maintenance, weather or access context. Original headlines, publishers, publication dates, branch-match cautions and a “published after the checked brief” badge help distinguish a saved accessibility review from newer public reports. Private, requirement-aware confirmation questions connect headline topics to the visit without sending your priorities upstream.
- Private 24-hour demo sessions, origin + session-bound CSRF checks, durable ownership checks and inaccessible browser database tables/RPCs.
- PostgreSQL leases, version checks, idempotency keys, global/day/session/job budgets, an owner kill switch, reservation audits, dispatch markers and uncertain recovery.
- Shared bounded caching. Changed requirements reuse the saved corpus with zero searches; new gap investigation requires an explicit action. New-policy investigations with a configured full search ceiling above five allow 160 snapshots, 128,000 combined text characters, 192 claims and 48,000 quote/scope characters, even when low allowance limits further searches. Legacy runs and owner-configured full ceilings of five or fewer retain the smaller 60 / 48,000 / 96 / 24,000 limits. Exceeding a corpus limit produces an explicit partial result.

SerpApi is essential for live public branch discovery and evidence. The core engines are `google_maps` (discovery/details), `google_maps_reviews` (small newest/keyword samples), and `google` (branch-specific search snippets, not full pages). Visit Watch adds the dedicated [`google_news` API](https://serpapi.com/google-news-api), with one bounded query using the canonical selected venue name, discovery city and `when:90d`. Gemini extracts exact public quotations with a JSON schema and chooses only from a server-built core action menu. Server validation rejects invented citations or unsupported favorable interpretations. Assessment, freshness, barriers, questions, eligibility and budgets are deterministic. Visitor requirements are not sent to Gemini or Google News; Visit Watch makes no Gemini calls.

Visit Watch is a separate persisted check with its own cost trace, transactional leases and idempotent attempts; the original accessibility verdict, evidence and investigation counts stay unchanged. It starts only when you choose **Check before I go**. The same SerpApi server credential is used; no new service signup is required. One logical query permits at most **two counted attempts**: the initial attempt and one later retry only after a known retryable failure. Ambiguous requests are not automatically replayed. The shared reserve, kill switch and global/day/session/verification budgets still apply. A one-hour app cache keeps the original retrieval time, and an expired saved result stays readable until an explicit new check. The UI pauses further steps on tab hiding or disconnection and supports an explicit saved-state resume.

News dates describe publication, not whether an incident continues. “Recently published” means within 14 days of the news retrieval; unknown dates remain unknown. The newer-than-brief badge refers to the brief snapshot saved when the check began, even after a zero-search reassessment. A venue name and city mention can refer to another branch; area context never establishes venue impact. No matching reports means **current conditions remain unknown**, not an all-clear. Only supplied headlines and optional snippets are shown; full articles, story-token follow-ups and news images are not fetched. News never establishes current lift operation or changes the deterministic accessibility assessment. See the official [Google News response documentation](https://serpapi.com/google-news-api) and [SerpApi status/error semantics](https://serpapi.com/api-status-and-error-codes).

No accessibility confidence percentage, invented dimensions, fabricated reviews or inference of a currently working lift. This is public evidence, not an inspection or certification. No routing, photo analysis, embeddings, Python service, external agent framework or P1 shares/comparison.

The owner's updated policy replaces the original universal five-search limit. A fresh server-side SerpApi account check enables the full finite evidence menu when the conservative remaining allowance is **above 50**. At **50 or fewer**, or when a fresh balance cannot be confirmed, investigation searches are limited to **five**. Full mode permits details and newest reviews plus up to three distinct targeted checks for each unresolved must-have: keyword reviews, branch-specific web snippets and the observed venue website. With eight possible features, this is at most **26 investigation searches**; unavailable actions and sufficient evidence finish the run sooner. Existing saved investigations retain their original limits; use **Investigate remaining gaps** or start another venue investigation to apply the current policy.

A completed run can still need confirmation. More searches do not establish unsupported accessibility facts. A partial brief separately means some evidence could not be fully validated or processed; rejected claims never establish fit. The headline and its must-have counts appear before the requirements controls and progress details on desktop and mobile. Use **View detailed report** for the evidence and questions, or reassess the saved corpus without searches.

## Owner setup for live local features (Windows PowerShell)

Use Node.js **22.x** (verified locally with 22.22.2). All direct dependencies and the Supabase CLI are pinned; use the committed lockfile.

```powershell
npm ci
npm run setup:local
```

`npm run setup:local` creates `.env.local` from `.env.example` when needed and generates only missing `DEMO_ACCESS_CODE` and three distinct 32-byte secrets for `ADMIN_API_SECRET`, `SESSION_HMAC_SECRET`, `RATE_LIMIT_HMAC_SECRET`. It preserves existing values and never prints secrets. Fill the remaining provider values locally: a SerpApi key, a Gemini key with access to **`gemini-3.5-flash-lite`** (the verified default), and the intended Supabase project's URL/server secret. Read `DEMO_ACCESS_CODE` in that ignored file to sign in. Set `APP_ORIGIN=http://localhost:3000` and keep `SEARCH_ENABLED=false` until setup succeeds. No real credentials are supplied with this repository. All these values are server-only; do not prefix credentials with `NEXT_PUBLIC_`, put them in source, or include them in screenshots or recordings.

Supabase server credentials can be the project's supported secret key or legacy service-role key. Do not use its publishable/anon key. Migrations enforce service-role privileges and no browser access.

Apply all committed migrations, including `007_visit_watch.sql`. It adds private auxiliary news-check jobs and the service-only `create_news_check` RPC. Preflight checks the complete migration chain and **19 private RPCs**; browser roles retain no access to these functions or durable tables.

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

The demo access code is an application gate that protects the shared search/model allowance and creates a private 24-hour session for report ownership and resume. SerpApi and Gemini do not require this code; their credentials stay on the server. It avoids account registration or collection of personal details. Sign in before recording the demo so the access code remains off-screen. Removing the gate from a public deployment would allow anonymous visitors to consume the owner's allowance.

The front page and `/api/health` run without credentials, but the real investigation requires durable Supabase and providers. A disabled database or environment kill switch prevents new dispatches; saved reports remain readable. No Docker is needed for a local Next.js app connected to hosted Supabase. The database test script creates its own disposable PostgreSQL instance and never resets a remote project.

To run the production build locally after completing owner setup:

```powershell
npm run build
npm start -- --hostname 127.0.0.1
```

Keep `APP_ORIGIN=http://localhost:3000` and open that exact address. Stop an existing process on port 3000 before starting another. Rebuild after source changes and restart after environment changes.

## Run the offline checks

From the repository directory after `npm ci`:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:db
```

These checks do not require real provider keys or a hosted Supabase project. `test:db` starts a disposable PostgreSQL instance in an ignored workspace folder and removes it after testing; it does not read the hosted database URL or reset a remote database.

For browser and accessibility tests, use an installed Chrome:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Alternatively, install the browser matching the pinned Playwright package and run without the channel override:

```powershell
Remove-Item Env:PLAYWRIGHT_CHANNEL -ErrorAction SilentlyContinue
npx playwright install chromium
npm run test:e2e
```

The browser tests start their own local server on port **3100**, disable live search, and intercept app APIs with labeled synthetic fixtures. They are separate from the live provider checks. Finish by running `npm run build`. On Windows, use `npm.cmd` / `npx.cmd` if PowerShell blocks the corresponding `.ps1` launchers.

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
| `npm run test:live:images -- --confirm-live` | Actual provider-photo retention and Chrome rendering; one preferred feature, three baseline checks, same30-search verification allocation |
| `npm run test:live:news -- --confirm-live --parent-job-id SAVED_PRIVATE_JOB_ID` | Opt-in real Google News check for an existing private completed/partial investigation; uses the same 30-search verification allocation |
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

Real local investigations have been run with the owner's configured credentials; search usage and failed attempts are recorded in [verification](docs/verification.md). A cold expanded use costs at most **one discovery + 26 investigation attempts** across all eight must-have features, usually fewer. A cold credit-conserving use costs at most **one discovery + five investigation attempts**. The account API check consumes no search credit. The application counts reserved/consumed attempts conservatively, including uncertain timeouts and responses served from SerpApi's own cache; these are not exact provider-billed credits. An app-cached response costs zero attempts. TTLs: discovery/reviews/snippets 6 hours, details 24 hours; original source/fetch dates are retained.

An optional cold Visit Watch check adds at most two conservative attempts to those core bounds, with no new discovery or model request. Reusing a fresh one-hour app-cache response adds zero attempts. Empty successful news results are still a real search, so never assume an empty result is free. Live checks are opt-in and must fit the remaining original 30-attempt verification allocation; their actual outcome belongs in [verification](docs/verification.md). Run the news check against a real saved private investigation ID rather than synthetic fixtures:

```powershell
# Set VERIFICATION_MODE=true for authorized verification; preserve the existing allocation.
npm run test:live:news -- --confirm-live --parent-job-id SAVED_PRIVATE_JOB_ID
```

Use `npm.cmd` in the same command if Windows blocks `npm.ps1`. Do not paste the demo access code or provider keys into command arguments. Source dates, not dramatic claims, should drive the demonstration.

The news verifier needs no running local server. It requires an active private parent session, a real saved assessment, migration007 and at least two unused verification attempts for the possible retry. It checks idempotent replay, a second cache-only child, original retrieval timestamps and an unchanged parent report. It never raises or resets budgets. Use a process-local `$env:VERIFICATION_MODE='true'` when running it; ordinary owner demonstrations keep the configured mode false.

The default global SerpApi operational ceiling is bounded by `min(owner_cap, actual_remaining - protected_reserve)`, with a protected reserve of 30 and owner ceiling of 220. A new job checks the account on the server; an active run refreshes a check older than 60 seconds before further search dispatches. Later reserved attempts reduce the saved balance conservatively, so the displayed estimate is not presented as a live provider balance. Crossing 50 reduces further checks to the five-search policy; a run that already spent five stops additional searches. A failed refresh cannot raise a budget; without a trusted account snapshot from the last 60 seconds, the conservative policy applies instead of assuming credit is available.

Gemini's global ceiling is an owner-configured limit of 1000 attempts, not a retrieved provider balance; its remaining account quota stays unknown. Global, UTC-day (default 60 searches), session (default 64 searches via `SERPAPI_SESSION_ATTEMPT_CAP`) and job checks are atomic. Expanded job ceilings are 26 searches, 56 LLM attempts and 128 workflow steps, with the five-minute active-time limit retained. Smaller owner-configured limits still apply. The finite evidence menu is the normal stopping condition, rather than spending the entire ceiling. No month-based reset. Development and deployment sharing a provider key must share this database. Do not initialize independent budgets for the same key.

For the initial **30-search maximum** verification allocation, set `VERIFICATION_MODE=true` in the running app and local `.env.local`, enable searches deliberately, then run the explicit live scripts. This separate allocation remains unchanged by the expanded owner demo policy. The server tags jobs into a durable allocation bucket; clients cannot select it or change caps. Confirm there is enough allocation for the intended finite run before starting. Scripts write sanitized results under ignored `.verification/`. `LIVE_APP_URL` can select the authorized deployed URL when its origin matches `APP_ORIGIN`. For ordinary owner-controlled demos after verification, set `VERIFICATION_MODE=false` and restart; the reserve, global, day, session, job and time limits still apply. Model quality checks make one Gemini request each; its account quota is not exposed as a verified balance.

Provider failures produce readable partial briefs; timeout/network ambiguity consumes the reservation and prevents silent replay. Known429/5xx errors have at most one later capped retry. Text extraction failure preserves public sources. Invalid model planning uses a labeled deterministic fallback. If an older uncertain request blocks an optional check before any new dispatch, a fully processed corpus can finish with that limit disclosed; remaining requirements stay unconfirmed. Completed empty Google News results are shown as no matching reports, not as provider errors or an all-clear. Closing a browser pauses initiation, not already dispatched requests.

Source photos are bounded to four listing references and two per sampled review, with24 retained per investigation and12 distinct photos displayed. Only known public Google photo CDN URLs are accepted; browser loading uses no-referrer, lazy rendering and an unavailable-image fallback. No image files are downloaded into Supabase, no reviewer profiles are retained, and no separate photo API/search engine is used. Photo-only reviews with an observed review ID are retained without inventing an excerpt and are excluded from text extraction. Maps/details/review cache versions changed to collect these optional fields; Google web-snippet cache keys are preserved. Changing an existing requirement still reuses the saved corpus with zero new searches.

## Vercel deployment

1. Apply migrations to the intended Supabase Free project. Check it is active.
2. Run all offline checks and `npm run build`; commit and push the tested tree to your repository. Scan for secrets before making the hackathon repository public.
3. Import the repository in your **personal Vercel Hobby** account with the Next.js preset and Node22. Keep the normal server build; do not enable static export. Alternatively, use the verified Node22-compatible CLI version:

   ```powershell
   npx vercel@63.1.2 login
   npx vercel@63.1.2 link
   npx vercel@63.1.2 --prod
   ```
4. Set the server-only values from `.env.example` in Vercel's Production environment, using real owner credentials rather than empty example values. Keep `VERIFICATION_MODE=false` for ordinary visitor sessions and initially set `SEARCH_ENABLED=false`. Set `APP_ORIGIN` to the exact production HTTPS origin, with no path or trailing slash, then redeploy. Set `DEMO_ACCESS_CODE` privately and share it only with intended visitors; visitors need no provider API keys. Use `APP_COMMIT_SHA` for release metadata if desired. Preview should disable search or share the same conservative DB allocation; no independent counter for the same key.
5. Check `/api/health`, confirm Vercel Fluid Compute and effective60-second step-route duration, reconcile the shared budget deliberately, then enable searches and redeploy.
6. Run the real deployed smoke in an incognito session, including at least one legitimate uncached dispatch and a second-session ownership check. A green build alone does not verify deployment. Confirm deployment protection settings and Supabase activation before judges visit.

The source repository is [amrs-tech/AccessReality](https://github.com/amrs-tech/AccessReality). No verified deployment URL or linked local Vercel project is currently configured; GitHub reports no deployment records. Importing or pushing this source does not itself confirm a working public deployment. Hobby eligibility/free model quotas are account-specific; no billing or paid fallback is enabled.

## Keep credentials and private outputs out of Git

`.env.local` and other real environment files are ignored; `.env.example` contains empty credential placeholders and non-secret defaults only. Private verification records, exported reports, videos, traces, test databases, dependencies, and build outputs are also ignored. Do not force-add `.env*`, `.verification/`, `demo-output/`, `test-results/`, `.next/`, or `node_modules/`. Documentation uses placeholders instead of private run identifiers. Configure deployed credentials in the hosting environment, never in Git.

Before pushing, inspect `git status --short` and the staged diff. With the [Gitleaks CLI](https://github.com/gitleaks/gitleaks) installed, scan all reachable history and the staged changes with redacted output:

```powershell
gitleaks git . --log-opts="--all" --redact
gitleaks git . --pre-commit --staged --redact
```

The 12 October audit scanned the existing commit history and compared every tracked/relevant working file and stored Git blob against the locally configured credentials: no credential matches or scanner-detected leaks were found. `.env.local`, private diagnostics and the recording stay outside Git. Use your GitHub noreply address for new commits when you want to keep your personal email private; Git author and committer metadata are separate from file contents. A secret committed in the future must be revoked or rotated and removed from history; deleting it only from the latest file is insufficient.

## Hackathon submission

Recommended track: Knowledge & Public Interest. The owner-requested **2:52 captioned local demo** was recorded on 12 October 2026 with successful investigation, news, photo, reassessment, export and gap-control checks. Its local path is `demo-output/successful-demo/AccessReality-Successful-Live-Demo.mp4`; the video and private report exports are deliberately excluded from Git. See the [demo script](docs/demo-script.md) and [actual verification](docs/verification.md) for cache disclosure and evidence limits. **Public video link: not published. Public deployment URL: not configured.** Add only real public links after verifying access. Do not submit synthetic test examples as a live demo.

AI tooling disclosure: OpenAI Codex generated and reviewed code, SQL, tests and documentation; earlier development also used parallel coding assistants. The application uses Google Gemini for public-evidence extraction and bounded action selection. No AI-created venue reviews, measurements or demonstration allegations were used. The owner should review the code and verify any public deployment before sharing it.

Further details: [architecture](docs/architecture.md), [actual verification](docs/verification.md), [acceptance checklist](docs/checklist.md).
