import { assertConfiguration, run } from './shared';
import { db } from '../lib/server/db';
import { chromium, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { PublicJob, Report } from '../lib/contracts';

// Explicit owner-invoked verification with actual UI and providers. No fixtures,
// response interception, browser-injected application state or provider bypass.
const terminal = (job: PublicJob) => ['complete', 'partial', 'cancelled'].includes(job.phase);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function gate(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error(), { code });
}
function safeCode(value: unknown, fallback = 'browser_live_gate_failed') {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,100}$/i.test(value) ? value : fallback;
}

run(async () => {
  gate(process.argv.includes('--confirm-live'), 'explicit_opt_in_required_use_--confirm-live');
  const e = assertConfiguration();
  gate(e.SEARCH_ENABLED === 'true' && process.env.VERIFICATION_MODE === 'true', 'enable_SEARCH_ENABLED_and_VERIFICATION_MODE_in_server_and_local_env');
  const base = new URL(process.env.LIVE_APP_URL || e.APP_ORIGIN).origin;
  gate(base === e.APP_ORIGIN, 'LIVE_APP_URL_must_match_canonical_APP_ORIGIN');
  const secrets = [e.SERPAPI_API_KEY, e.GEMINI_API_KEY, e.SUPABASE_SERVICE_ROLE_KEY, e.DEMO_ACCESS_CODE, e.ADMIN_API_SECRET, e.SESSION_HMAC_SECRET, e.RATE_LIMIT_HMAC_SECRET].filter(Boolean);
  const scan = { apiBodies: 0, staticBodies: 0, bodyReadFailures: 0, matchingApiBodies: 0, matchingStaticBodies: 0 };
  function scanBody(text: string, kind: 'api' | 'static') {
    const match = secrets.some(secret => text.includes(secret));
    if (kind === 'api') { scan.apiBodies += 1; if (match) scan.matchingApiBodies += 1; }
    else { scan.staticBodies += 1; if (match) scan.matchingStaticBodies += 1; }
  }
  async function adminPreflight() {
    const response = await fetch(`${base}/api/admin/preflight`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', authorization: `Bearer ${e.ADMIN_API_SECRET}` }, body: JSON.stringify({ probeLlm: false }), signal: AbortSignal.timeout(60_000) });
    const text = await response.text(); scanBody(text, 'api');
    const data = JSON.parse(text);
    gate(response.ok, safeCode(data.error?.code, 'admin_preflight_failed'));
    gate(data.verificationMode && data.searchEnabled && data.database?.searchEnabled, 'server_verification_search_not_enabled');
    gate(data.database?.ok && data.database?.rlsEnabled && data.database?.privateGrants, 'database_private_access_gate_failed');
    gate(data.llm?.run === false, 'unexpected_preflight_llm_probe');
    return data as { account: { remaining: number; checkedAt?: string }; database: { migration: string } };
  }
  const before = await adminPreflight();
  const client = db();
  const allocationBefore = await client.from('budget_buckets').select('reserved_units,limit_units,enabled').eq('id', 'allocation:verification:serpapi').single();
  gate(!allocationBefore.error && allocationBefore.data?.enabled && allocationBefore.data.limit_units <= 30 && allocationBefore.data.limit_units - allocationBefore.data.reserved_units >= 6, 'verification_allocation_insufficient_room_for_six_max30');
  gate(scan.matchingApiBodies === 0, 'secret_in_preflight_response');

  const stamp = Date.now();
  const directory = '.verification';
  await mkdir(directory, { recursive: true });
  const record: Record<string, unknown> = {
    checkedAt: new Date().toISOString(), timezone: 'Asia/Calcutta', url: base,
    verificationTimeIST: new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Asia/Kolkata' }).format(new Date()),
    realBrowser: true, mockedResponses: false, llmPreflightProbe: false, phases: [],
    migration: before.database.migration, allowanceBefore: before.account.remaining,
    verificationReservedBefore: allocationBefore.data.reserved_units,
    lockHash: createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),
    limitations: ['Citation checks validate source spans and displayed quotes; they do not independently establish semantic truth or present venue conditions.'],
  };
  const phases = record.phases as { phase: string; at: string }[];
  const milestone = (phase: string) => phases.push({ phase, at: new Date().toISOString() });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let ownerJobId: string | null = null;
  let discoveryJob: PublicJob | null = null;
  let latestJob: PublicJob | null = null;
  const bodyReads = new Set<Promise<void>>();
  const stepRequests: { jobId: string; expectedVersion: number }[] = [];
  async function api<T>(request: APIRequestContext, path: string, method = 'GET', data?: unknown, csrfToken?: string): Promise<T> {
    const response = await request.fetch(`${base}${path}`, { method, headers: { origin: base, ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, ...(data !== undefined ? { data } : {}), timeout: 65_000 });
    const text = await response.text(); scanBody(text, 'api');
    const result = JSON.parse(text);
    gate(response.ok(), safeCode(result.error?.code, `http_${response.status()}`));
    return result as T;
  }
  const jobGet = (id: string) => api<PublicJob>(context!.request, `/api/jobs/${encodeURIComponent(id)}`);
  try {
    // Browser processes receive only ordinary OS launch variables. Provider,
    // database and admin secrets stay in this owner-side Node process.
    const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && /^(SYSTEMROOT|WINDIR|PATH|PATHEXT|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|HOMEDRIVE|HOMEPATH|LANG|LC_ALL|DISPLAY|XAUTHORITY)$/i.test(key))) as Record<string, string>;
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, env: browserEnv });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== base || (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/static/'))) return;
      const work = response.text().then(text => scanBody(text, url.pathname.startsWith('/api/') ? 'api' : 'static')).catch(() => { scan.bodyReadFailures += 1; }).finally(() => bodyReads.delete(work));
      bodyReads.add(work);
    });
    page.on('request', request => {
      const match = new URL(request.url()).pathname.match(/^\/api\/jobs\/([^/]+)\/step$/);
      if (match && request.method() === 'POST') {
        const input = request.postDataJSON() as { expectedVersion: number };
        stepRequests.push({ jobId: match[1], expectedVersion: input.expectedVersion });
      }
    });
    await page.goto(base, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByLabel('Demo access code').fill(e.DEMO_ACCESS_CODE);
    await page.getByRole('button', { name: 'Unlock live search' }).click();
    await page.getByText('Private session active', { exact: true }).waitFor();
    gate(await page.getByLabel('Demo access code').count() === 0 || await page.getByLabel('Demo access code').inputValue() === '', 'access_code_not_cleared');
    milestone('real_ui_login_code_cleared');
    await page.getByRole('checkbox', { name: /Step-free entrance/ }).check();
    await page.getByLabel('Step-free entrance priority').selectOption('must_have');
    await page.getByRole('checkbox', { name: /Accessible restroom/ }).check();
    await page.getByLabel('Accessible restroom priority').selectOption('must_have');
    await page.getByLabel('Venue or category').fill('cafes in Indiranagar');
    await page.getByLabel('City in India').fill('Bengaluru');
    const discoveryCreatedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/discoveries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Find venues' }).click();
    const discoveryCreated = await (await discoveryCreatedResponse).json() as { jobId?: string };
    gate(discoveryCreated.jobId, 'discovery_create_failed');
    const discoveryDeadline = Date.now() + 60_000;
    do { discoveryJob = await jobGet(discoveryCreated.jobId); if (!terminal(discoveryJob)) await delay(400); } while (!terminal(discoveryJob) && Date.now() < discoveryDeadline);
    gate(discoveryJob.phase === 'complete', 'real_discovery_not_complete');
    const candidateIndex = discoveryJob.candidates.findIndex(venue => !venue.provisional && (venue.googlePlaceId || venue.dataCid));
    gate(candidateIndex >= 0 && candidateIndex < 5, 'no_resolvable_real_branch');
    const candidate = discoveryJob.candidates[candidateIndex];
    const candidateCard = page.locator('.candidate-card').nth(candidateIndex);
    await candidateCard.getByRole('heading', { name: candidate.name, exact: true }).waitFor();
    if (candidate.address) await candidateCard.getByText(candidate.address, { exact: true }).waitFor();
    await candidateCard.getByText('Not yet assessed', { exact: true }).waitFor();
    record.venue = { name: candidate.name, address: candidate.address };
    milestone('actual_exact_branch_selected');
    const investigationCreatedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/investigations' && response.request().method() === 'POST');
    const runStartedAt = Date.now();
    await candidateCard.getByRole('button', { name: 'Investigate this venue' }).click();
    const investigationCreated = await (await investigationCreatedResponse).json() as { jobId?: string };
    gate(investigationCreated.jobId, 'investigation_create_failed');
    ownerJobId = investigationCreated.jobId; record.jobId = ownerJobId;
    await page.getByRole('button', { name: 'Pause after this step' }).click();
    await page.getByRole('button', { name: 'Resume investigation' }).waitFor({ timeout: 65_000 });
    const paused = await jobGet(ownerJobId);
    gate(paused.candidateId === candidate.id, 'browser_selected_different_branch');
    gate(stepRequests.filter(step => step.jobId === ownerJobId).length === 1 && paused.stateVersion === 1 && !terminal(paused), 'did_not_pause_after_exactly_first_step');
    await delay(1_000);
    const stillPaused = await jobGet(ownerJobId);
    gate(stillPaused.stateVersion === paused.stateVersion && stillPaused.providerAttempts === paused.providerAttempts && stillPaused.llmAttempts === paused.llmAttempts, 'paused_page_advanced_or_spent');
    milestone('first_step_paused_version_and_attempts_stable');
    await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByRole('button', { name: 'Resume investigation' }).waitFor();
    await delay(1_000);
    const afterReload = await jobGet(ownerJobId);
    gate(afterReload.stateVersion === paused.stateVersion && afterReload.providerAttempts === paused.providerAttempts && afterReload.llmAttempts === paused.llmAttempts && stepRequests.filter(step => step.jobId === ownerJobId).length === 1, 'reload_advanced_saved_work');
    record.pauseReload = { passed: true, stateVersion: paused.stateVersion, providerAttempts: paused.providerAttempts, stableWaitMilliseconds: 2_000 };
    milestone('real_reload_stays_paused');
    await page.getByRole('button', { name: 'Resume investigation' }).click();
    const deadline = runStartedAt + 180_000;
    while (Date.now() < deadline) {
      latestJob = await jobGet(ownerJobId);
      gate(stepRequests.filter(step => step.jobId === ownerJobId).length <= 20, 'browser_step_limit_exceeded');
      if (terminal(latestJob)) break;
      const resume = page.getByRole('button', { name: 'Resume investigation' });
      if (await resume.isVisible()) {
        const retryDelay = latestJob.nextRetryAt ? Math.max(0, Date.parse(latestJob.nextRetryAt) - Date.now()) : 0;
        gate(Date.now() + retryDelay < deadline, 'retry_exceeds_three_minute_gate');
        if (retryDelay) await delay(Math.min(retryDelay, 30_000));
        if (!latestJob.nextRetryAt || Date.parse(latestJob.nextRetryAt) <= Date.now()) await resume.click();
      }
      await delay(500);
    }
    gate(latestJob && terminal(latestJob), 'browser_three_minute_gate_exceeded');
    gate(latestJob.report, 'missing_persisted_report');
    record.phase = latestJob.phase;
    record.activeWallMilliseconds = Date.now() - runStartedAt;
    record.overall = latestJob.report.overall;
    record.limitations = [...record.limitations as string[], ...latestJob.report.limitations];
    record.stopReason = latestJob.stopReason;
    const persisted = await jobGet(ownerJobId);
    gate(persisted.stateVersion === latestJob.stateVersion && persisted.providerAttempts === latestJob.providerAttempts && persisted.report && JSON.stringify(persisted.report) === JSON.stringify(latestJob.report), 'api_report_not_persisted_consistently');
    const report = persisted.report as Report;
    const accepted = report.claims.filter(claim => claim.extractionStatus === 'accepted');
    const spots = [];
    for (const claim of accepted.slice(0, 3)) {
      const source = report.sources.find(item => item.id === claim.sourceId);
      const offsetsValid = claim.quoteStart !== null && claim.quoteEnd !== null && source?.text.slice(claim.quoteStart, claim.quoteEnd) === claim.originalQuote;
      const pointerValid = claim.jsonPointer !== null && claim.jsonPointer.startsWith('/');
      gate(source && source.text.includes(claim.originalQuote) && (offsetsValid || pointerValid), 'exact_quote_citation_spot_check_failed');
      await page.locator('blockquote').filter({ hasText: claim.originalQuote }).first().waitFor();
      gate(await page.locator('blockquote').evaluateAll((nodes, quote) => nodes.some(node => node.textContent === quote), claim.originalQuote), 'displayed_quote_changed');
      spots.push({ claimId: claim.id, sourceId: source.id, feature: claim.feature, polarity: claim.polarity, sourceKind: source.kind, exactSpanValid: true, displayedQuoteExact: true });
    }
    record.claimSpotChecks = { acceptedClaimCount: accepted.length, reviewedCount: spots.length, results: spots };
    if (spots.length < 3) (record.limitations as string[]).push(`Only ${spots.length} accepted claims were available for the requested three-claim spot check; every available claim up to three was checked.`);
    const evidenceSummaries = page.locator('.source-details summary');
    const expanded = Math.min(3, await evidenceSummaries.count());
    for (let index = 0; index < expanded; index++) await evidenceSummaries.nth(index).click();
    record.expandedEvidenceSources = expanded;
    milestone('persisted_report_and_actual_displayed_quotes_checked');
    const attemptsBeforeReassessment = latestJob.providerAttempts;
    const llmBeforeReassessment = latestJob.llmAttempts;
    const stepsBeforeReassessment = stepRequests.length;
    await page.getByRole('checkbox', { name: /Accessible restroom/ }).uncheck();
    const reassessResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/jobs/${ownerJobId}/reassess` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Reassess this evidence' }).click();
    gate((await reassessResponse).ok(), 'ui_reassessment_failed');
    const reassessed = await jobGet(ownerJobId);
    gate(reassessed.providerAttempts === attemptsBeforeReassessment && reassessed.llmAttempts === llmBeforeReassessment && stepRequests.length === stepsBeforeReassessment, 'ui_reassessment_dispatched_provider');
    gate(reassessed.requirements.some(requirement => requirement.feature === 'accessible_restroom' && requirement.priority === 'not_needed'), 'ui_reassessment_profile_not_saved');
    record.reassessmentZeroProviderCalls = true;
    milestone('real_ui_reassessment_without_new_provider_attempt');
    await page.getByRole('button', { name: /View completed brief/ }).click();
    gate(await page.getByLabel('Demo access code').count() === 0, 'access_code_visible_in_capture');
    const screenshot = `${directory}/live-browser-${stamp}.png`;
    await page.screenshot({ path: screenshot, fullPage: true }); record.screenshot = screenshot;

    const other = await browser.newContext();
    try {
      const bootstrap = await api<{ csrfToken: string }>(other.request, '/api/session');
      const login = await api<{ csrfToken: string }>(other.request, '/api/session', 'POST', { accessCode: e.DEMO_ACCESS_CODE }, bootstrap.csrfToken);
      const isolation = [];
      for (const [path, method] of [[`/api/jobs/${ownerJobId}`, 'GET'], [`/api/jobs/${ownerJobId}/export`, 'GET'], [`/api/jobs/${ownerJobId}/cancel`, 'POST']] as const) {
        const response = await other.request.fetch(`${base}${path}`, { method, headers: { origin: base, 'X-CSRF-Token': login.csrfToken }, ...(method === 'POST' ? { data: {} } : {}), timeout: 30_000 });
        const text = await response.text(); scanBody(text, 'api');
        gate(response.status() === 404, 'independent_session_read_or_mutation_not_denied');
        isolation.push({ operation: path.endsWith('/export') ? 'export' : path.endsWith('/cancel') ? 'cancel' : 'read', status: response.status(), denied: true });
      }
      record.crossSessionIsolation = isolation;
    } finally { await other.close(); }
    milestone('independent_session_read_export_cancel_denied');
    const attempts = await client.from('provider_attempts').select('job_id,status,provider,provider_search_id,dispatch_started_at').in('job_id', [discoveryJob.id, ownerJobId]);
    gate(!attempts.error && !attempts.data?.some(attempt => attempt.provider === 'serpapi' && attempt.status === 'completed' && !attempt.provider_search_id), 'missing_real_provider_search_identifier');
    const countedSearches = attempts.data?.filter(attempt => attempt.provider === 'serpapi' && attempt.status !== 'released').length || 0;
    const countedLlm = attempts.data?.filter(attempt => attempt.provider === 'gemini' && attempt.status !== 'released').length || 0;
    gate(countedSearches === discoveryJob.providerAttempts + latestJob.providerAttempts && countedLlm === latestJob.llmAttempts, 'durable_attempt_counters_do_not_match_audit');
    gate(!attempts.data?.some(attempt => ['completed', 'uncertain'].includes(attempt.status) && !attempt.dispatch_started_at), 'completed_or_uncertain_attempt_missing_dispatch_marker');
    record.realAttemptAudit = { countersMatch: true, completedSearchesWithProviderId: attempts.data?.filter(attempt => attempt.provider === 'serpapi' && attempt.status === 'completed' && attempt.provider_search_id).length || 0, uncertainSearches: attempts.data?.filter(attempt => attempt.provider === 'serpapi' && attempt.status === 'uncertain').length || 0 };
    const after = await adminPreflight();
    const allocationAfter = await client.from('budget_buckets').select('reserved_units,limit_units').eq('id', 'allocation:verification:serpapi').single();
    gate(!allocationAfter.error && allocationAfter.data, 'allocation_after_unavailable');
    record.allowanceAfter = after.account.remaining;
    record.verificationReservedAfter = allocationAfter.data.reserved_units;
    record.verificationAttemptsAdded = allocationAfter.data.reserved_units - allocationBefore.data.reserved_units;
    gate(allocationAfter.data.reserved_units <= 30 && allocationAfter.data.reserved_units - allocationBefore.data.reserved_units <= 6, 'browser_verification_allocation_gate_exceeded');
    record.providerAttempts = discoveryJob.providerAttempts + latestJob.providerAttempts;
    record.appCacheHits = discoveryJob.appCacheHits + latestJob.appCacheHits;
    record.llmAttempts = latestJob.llmAttempts;
    record.browserStepRequests = stepRequests.filter(step => step.jobId === ownerJobId).length;
    await Promise.all([...bodyReads]);
    gate(scan.staticBodies > 0 && scan.apiBodies > 0, 'actual_browser_bodies_not_scanned');
    gate(scan.bodyReadFailures === 0, 'browser_body_scan_incomplete');
    gate(scan.matchingApiBodies === 0 && scan.matchingStaticBodies === 0, 'actual_secret_in_browser_response');
    record.secretScan = { ...scan, passed: true };
    milestone('actual_api_and_served_static_bodies_secret_scan_passed');
    gate(latestJob.phase === 'complete' && !latestJob.report.isPartial, 'unexpected_partial_or_cancelled_live_browser_run');
    record.passed = true;
  } catch (error) {
    record.passed = false;
    record.failureCode = safeCode((error as { code?: unknown })?.code);
    record.secretScan = { ...scan, passed: scan.matchingApiBodies === 0 && scan.matchingStaticBodies === 0, completed: false };
    if (latestJob) { record.phase = latestJob.phase; record.providerAttempts = (discoveryJob?.providerAttempts || 0) + latestJob.providerAttempts; record.appCacheHits = (discoveryJob?.appCacheHits || 0) + latestJob.appCacheHits; record.llmAttempts = latestJob.llmAttempts; }
    if (page && !page.isClosed()) {
      try { const codeInput = page.getByLabel('Demo access code'); if (await codeInput.count()) await codeInput.fill(''); await page.screenshot({ path: `${directory}/live-browser-${stamp}-failed.png`, fullPage: true }); } catch { /* Never expose raw browser errors or credential-bearing form values. */ }
    }
    throw Object.assign(new Error(), { code: record.failureCode });
  } finally {
    await Promise.all([...bodyReads]);
    await browser?.close().catch(() => undefined);
    record.finishedAt = new Date().toISOString();
    await writeFile(`${directory}/live-browser-${stamp}.json`, JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record, null, 2));
  }
});
