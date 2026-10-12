import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { EvidenceImage, Report, Requirements, Venue } from '../../lib/contracts';
import type { Job } from '../../components/ui-contracts';
import { defaultRequirements } from '../../components/ui-contracts';

// Clearly synthetic browser-only fixture. Never imported by a production route.
const discoveryId = '11111111-1111-4111-8111-111111111111';
const investigationId = '22222222-2222-4222-8222-222222222222';
const syntheticVenue: Venue = { id: 'synthetic-venue', name: 'Synthetic Test Venue — East Branch', address: 'Synthetic East Road, Bengaluru', googlePlaceId: 'synthetic-place-id', dataCid: null, dataId: 'synthetic-data-id', website: null, phone: null, category: 'Synthetic cafe', sourceUrl: 'https://www.google.com/maps/search/?api=1&query=Synthetic', latitude: null, longitude: null, rating: 4.1, provisional: false };
const stamp = '2026-10-10T08:00:00.000Z';

function makeReport(mode: 'complete' | 'unknown' | 'partial', requirements: Requirements): Report {
  const hasEvidence = mode === 'complete';
  const source = { id: 'synthetic-source-1', venueId: syntheticVenue.id, kind: 'maps_review' as const, text: 'Synthetic test text: The entrance was step free and the accessible restroom was open.', sourceUrl: 'https://example.com/synthetic-test-evidence', providerReviewId: 'synthetic-review-1', providerSearchId: 'synthetic-provider-id', engine: 'google_maps_reviews', retrievedAt: stamp, publishedAt: '2026-10-09T00:00:00.000Z', editedAt: null, observedAt: null, selectionMethod: 'newest' as const, sourceGroupKey: 'synthetic-source-group', metadata: { originalLanguage: 'English' } };
  const claims: Report['claims'] = hasEvidence ? ['entrance_step_free', 'accessible_restroom'].map((feature, index) => ({ id: `synthetic-claim-${index}`, venueId: syntheticVenue.id, sourceId: source.id, feature: feature as 'entrance_step_free' | 'accessible_restroom', polarity: 'supports', originalQuote: source.text, scope: { entrance: null, floor: null, facility: null, conditions: [] }, quoteStart: 0, quoteEnd: source.text.length, jsonPointer: null, observedAt: null, publishedAt: source.publishedAt, editedAt: null, retrievedAt: stamp, datePrecision: 'timestamp', temporalKind: 'structural', venueMatch: 'exact', extractionStatus: 'accepted' })) : [];
  return {
    venue: syntheticVenue, generatedAt: stamp, overall: hasEvidence ? 'evidence_supports_requirements' : 'needs_confirmation', isPartial: mode === 'partial',
    requirements: requirements.map(requirement => ({ ...requirement, status: hasEvidence && ['entrance_step_free', 'accessible_restroom'].includes(requirement.feature) ? 'supported' : 'insufficient', claimIds: claims.filter(claim => claim.feature === requirement.feature).map(claim => claim.id), sourceIds: hasEvidence ? [source.id] : [], explanation: hasEvidence ? 'A dated synthetic observation supports this requirement.' : 'No usable dated observation is available.', barrierToConfirm: false, conditions: [], dataQualityFlags: [] })),
    claims, sources: hasEvidence ? [source] : [], questions: hasEvidence ? [] : ['Is there a step-free entrance to this exact branch?', 'Is the accessible restroom open to customers today?'],
    limitations: mode === 'partial' ? ['Extraction unavailable after a provider failure. Raw evidence could not be assessed.'] : ['Synthetic bounded browser-test sample.'], algorithmVersion: 'synthetic-test-1', extractorVersion: 'synthetic-test-1', reviewsExamined: hasEvidence ? 2 : 0,
  };
}

async function fakeApi(page: Page, options: { mode?: 'complete' | 'unknown' | 'partial'; authenticated?: boolean; expire?: boolean; resumable?: boolean; savedReport?: Report; stopReason?: string; searchMode?: 'expanded' | 'conserve' | 'legacy'; searchCap?: number; effectiveProviderRemaining?: number | null; lastKnownProviderRemaining?: number | null } = {}) {
  let authenticated = options.authenticated ?? false;
  let requirements = options.savedReport ? options.savedReport.requirements.map(({ feature, priority, scope }) => ({ feature, priority, ...(scope ? { scope } : {}) })) : [...defaultRequirements];
  let stage = options.savedReport ? 3 : options.resumable ? 1 : 0;
  let retryAt: string | null = null;
  let searchCount = 0;
  let discoverySteps = 0;
  let assessmentCount = 0;
  let creates = 0;
  const mode = options.mode ?? 'complete';
  const job = (kind: 'discovery' | 'investigation'): Job => ({
    id: kind === 'discovery' ? discoveryId : investigationId, kind,
    phase: kind === 'discovery' ? discoverySteps ? 'complete' : 'discovery' : stage >= 3 ? mode === 'partial' || options.savedReport?.isPartial ? 'partial' : 'complete' : ['details', 'reviews', 'extract'][stage],
    stateVersion: kind === 'discovery' ? discoverySteps : stage, venue: kind === 'discovery' ? null : syntheticVenue,
    candidates: kind === 'discovery' && discoverySteps ? [syntheticVenue] : [], requirements,
    report: kind === 'investigation' && stage >= 3 ? options.savedReport ?? makeReport(mode, requirements) : null,
    providerAttempts: kind === 'discovery' ? discoverySteps : Math.min(stage, 2), appCacheHits: 0, searchCap: kind === 'discovery' ? 1 : options.searchCap ?? 5,
    llmAttempts: kind === 'investigation' && stage >= 3 ? 1 : 0, llmCap: 6, sourceCount: stage >= 3 ? options.savedReport?.sources.length ?? (mode === 'complete' ? 1 : 0) : 0, reviewsExamined: stage >= 3 ? options.savedReport?.reviewsExamined ?? (mode === 'complete' ? 2 : 0) : 0,
    events: [{ type: 'test_action', message: 'Synthetic test action: checking entrance evidence.', createdAt: stamp }],
    stopReason: stage >= 3 ? options.stopReason ?? (mode === 'partial' ? 'upstream_unavailable' : 'evidence_sufficient') : null, nextRetryAt: retryAt,
    canResume: stage < 3, remainingAction: stage < 3 ? 'FETCH_NEWEST_REVIEWS' : null,
    discoveryJobId: kind === 'investigation' ? discoveryId : null, candidateId: kind === 'investigation' ? syntheticVenue.id : null,
    searchMode: options.searchMode ?? 'legacy', effectiveProviderRemaining: options.effectiveProviderRemaining ?? null,
    lastKnownProviderRemaining: options.lastKnownProviderRemaining ?? null, allowanceCheckedAt: options.lastKnownProviderRemaining != null ? stamp : null,
  });
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/session') {
      if (request.method() === 'POST') { expect(body.accessCode).toBe('synthetic-test-access-code'); expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf-token'); authenticated = true; }
      if (request.method() === 'DELETE') authenticated = false;
      return json({ authenticated, configured: true, csrfToken: 'synthetic-csrf-token' });
    }
    if (!authenticated) return json({ error: { code: 'session_required', message: 'Private session expired.', retryable: false } }, 401);
    if (path === '/api/discoveries') { expect(body.city).toBe('Bengaluru'); expect(body.country).toBe('India'); discoverySteps = 0; return json({ jobId: discoveryId, stateVersion: 0 }, 201); }
    if (path === '/api/investigations') { expect(body.candidateId).toBe(syntheticVenue.id); expect(body.discoveryJobId).toBe(discoveryId); requirements = body.requirements; creates += 1; return json({ jobId: investigationId, stateVersion: stage }, 201); }
    if (path === `/api/jobs/${discoveryId}`) return json(job('discovery'));
    if (path === `/api/jobs/${discoveryId}/step`) { discoverySteps += 1; return json(job('discovery')); }
    if (path === `/api/jobs/${investigationId}`) return json(job('investigation'));
    if (path === `/api/jobs/${investigationId}/step`) {
      if (options.expire) { authenticated = false; return json({ error: { code: 'session_expired', message: 'Private session expired.', retryable: false } }, 401); }
      expect(body.expectedVersion).toBe(stage); stage += 1; searchCount += 1;
      if (options.resumable && stage === 2) retryAt = new Date(Date.now() + 60_000).toISOString();
      return json(job('investigation'));
    }
    if (path === `/api/jobs/${investigationId}/reassess`) { requirements = body.requirements; assessmentCount += 1; return json(job('investigation')); }
    return json({ error: { code: 'unexpected_test_route', message: path, retryable: false } }, 404);
  });
  return { counts: () => ({ steps: searchCount, assessmentCount, creates }), clearWait: () => { retryAt = null; } };
}

async function loginAndSelect(page: Page) {
  await page.goto('/');
  await page.getByLabel('Demo access code').fill('synthetic-test-access-code');
  await page.getByRole('button', { name: 'Unlock live search' }).click();
  await expect(page.getByText('Private session active')).toBeVisible();
  await page.getByRole('checkbox', { name: /Accessible restroom/ }).check();
  await page.getByLabel('Venue or category').fill('Synthetic Test Venue');
  await page.getByRole('button', { name: 'Find venues' }).click();
  await expect(page.getByRole('heading', { name: syntheticVenue.name })).toBeVisible();
  await expect(page.getByText('Not yet assessed')).toBeVisible();
  await page.getByRole('button', { name: 'Investigate this venue' }).click();
  await expect(page).toHaveURL(new RegExp(`/investigate/${investigationId}`));
}

test('login, exact branch, complete brief, citations and zero-search reassessment', async ({ page }) => {
  const fake = await fakeApi(page);
  await loginAndSelect(page);
  await expect(page.getByRole('heading', { name: 'Public evidence supports your requirements' })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByText('Retrieved', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /View visitor report published/ })).toHaveAttribute('href', 'https://example.com/synthetic-test-evidence');
  const before = fake.counts().steps;
  await page.getByRole('checkbox', { name: /Accessible restroom/ }).uncheck();
  await page.getByRole('button', { name: 'Reassess this evidence' }).click();
  await expect.poll(() => fake.counts().assessmentCount).toBe(1);
  expect(fake.counts().steps).toBe(before);
  await expect(page.locator('.requirement-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'View completed brief' }).click();
  await expect(page.getByRole('heading', { name: syntheticVenue.name })).toBeFocused();
});

test('insufficient evidence remains unknown with confirmation questions', async ({ page }) => {
  await fakeApi(page, { mode: 'unknown' }); await loginAndSelect(page);
  await expect(page.getByRole('heading', { name: 'Some requirements need confirmation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No source evidence is available' })).toBeVisible();
  await expect(page.getByText('Is the accessible restroom open to customers today?')).toBeVisible();
  await expect(page.getByText('Reported accessible', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Investigate remaining gaps' })).toBeVisible();
});

test('provider failure returns a readable partial brief', async ({ page }) => {
  await fakeApi(page, { mode: 'partial' }); await loginAndSelect(page);
  await expect(page.getByRole('heading', { name: 'Partial brief available' })).toBeVisible();
  await expect(page.getByText('This brief is partial.')).toBeVisible();
  await expect(page.getByText('Extraction unavailable after a provider failure. Raw evidence could not be assessed.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export JSON' })).toHaveAttribute('href', `/api/jobs/${investigationId}/export`);
});

test('expired sessions stop steps and ask for access again', async ({ page }) => {
  const fake = await fakeApi(page, { expire: true }); await loginAndSelect(page);
  await expect(page.getByLabel('Demo access code')).toBeVisible();
  await expect(page.getByText('Your private session has expired. Enter the access code again to continue.')).toBeVisible();
  expect(fake.counts().steps).toBe(0);
});

test('reload restores saved state and waits for explicit resume', async ({ page }) => {
  const fake = await fakeApi(page, { authenticated: true, resumable: true });
  await page.goto(`/investigate/${investigationId}`);
  await expect(page.getByRole('button', { name: 'Resume investigation' })).toBeVisible();
  expect(fake.counts().steps).toBe(0);
  await page.getByRole('button', { name: 'Resume investigation' }).click();
  await expect(page.getByText(/The provider requested a wait/)).toBeVisible();
  expect(fake.counts().steps).toBe(1);
  fake.clearWait(); await page.reload();
  await expect(page.getByRole('heading', { name: 'Extracting and validating observations' })).toBeVisible();
  expect(fake.counts().steps).toBe(1);
  await page.getByRole('button', { name: 'Resume investigation' }).click();
  await expect(page.getByRole('heading', { name: 'Investigation complete' })).toBeVisible();
  expect(fake.counts().steps).toBe(2);
  await page.reload(); await expect(page.getByRole('heading', { name: syntheticVenue.name })).toBeVisible();
  expect(fake.counts().steps).toBe(2);
});

test('principal flow supports keyboard controls and automated accessibility checks', async ({ page }, testInfo) => {
  await fakeApi(page); await page.goto('/');
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  const entryAudit = await new AxeBuilder({ page }).analyze(); expect(entryAudit.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('synthetic-entry-desktop.png'), fullPage: true });
  await page.getByRole('checkbox', { name: /Lift access/ }).focus(); await page.keyboard.press('Space');
  await expect(page.getByLabel('Lift access priority')).toBeVisible();
  await page.getByLabel('Lift access priority').focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Lift access priority')).toHaveValue('preferred');
  await page.getByRole('checkbox', { name: /Lift access/ }).uncheck();
  await page.getByLabel('Demo access code').fill('synthetic-test-access-code');
  await page.getByRole('button', { name: 'Unlock live search' }).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Venue or category').fill('Synthetic Test Venue');
  await page.getByRole('button', { name: 'Find venues' }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Investigate this venue' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Investigation complete' })).toBeVisible();
  await page.getByRole('button', { name: 'View completed brief' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: syntheticVenue.name })).toBeFocused();
  const reportAudit = await new AxeBuilder({ page }).analyze(); expect(reportAudit.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('synthetic-brief-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: 'Read what the sources say' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('synthetic-brief-mobile.png'), fullPage: true });
});

test('a hidden tab stops initiating steps and requires explicit resume', async ({ page }) => {
  const fake = await fakeApi(page, { authenticated: true });
  let release: (() => void) | null = null;
  let pausedStep = false;
  await page.route(`**/api/jobs/${investigationId}/step`, async route => {
    if (!pausedStep) {
      pausedStep = true;
      await new Promise<void>(resolve => { release = resolve; });
    }
    await route.fallback();
  });
  await page.goto(`/investigate/${investigationId}`);
  await page.getByRole('button', { name: 'Resume investigation' }).click();
  await expect.poll(() => pausedStep).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  release!();
  await expect(page.getByText('Paused while this tab is hidden. Return and choose Resume.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume investigation' })).toBeVisible();
  expect(fake.counts().steps).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(fake.counts().steps).toBe(1);
  await page.getByRole('button', { name: 'Resume investigation' }).click();
  await expect(page.getByRole('heading', { name: 'Investigation complete' })).toBeVisible();
  expect(fake.counts().steps).toBe(3);
});

test('version conflict refreshes saved state before one sequential retry', async ({ page }) => {
  const fake = await fakeApi(page, { authenticated: true });
  let conflict = true;
  await page.route(`**/api/jobs/${investigationId}/step`, async route => {
    if (conflict) { conflict = false; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'busy', message: 'A saved step is being committed.', retryable: true } }) }); }
    return route.fallback();
  });
  await page.goto(`/investigate/${investigationId}`);
  await page.getByRole('button', { name: 'Resume investigation' }).click();
  await expect(page.getByRole('heading', { name: 'Investigation complete' })).toBeVisible();
  expect(fake.counts().steps).toBe(3);
});

const summaryRequirements: Requirements = [
  { feature: 'entrance_step_free', priority: 'must_have' },
  { feature: 'accessible_restroom', priority: 'must_have' },
];

function barrierReport(isPartial = false): Report {
  const report = makeReport('complete', summaryRequirements);
  const text = 'Synthetic test text: Two steps block the entrance. The accessible restroom was open.';
  return { ...report, overall: 'reported_barrier', isPartial,
    sources: report.sources.map(source => ({ ...source, text })),
    claims: report.claims.map(claim => {
      const quote = claim.feature === 'entrance_step_free' ? 'Two steps block the entrance.' : 'The accessible restroom was open.';
      return { ...claim, polarity: claim.feature === 'entrance_step_free' ? 'barrier' : 'supports', originalQuote: quote, quoteStart: text.indexOf(quote), quoteEnd: text.indexOf(quote) + quote.length };
    }),
    requirements: report.requirements.map(requirement => requirement.feature === 'entrance_step_free' ? { ...requirement, status: 'barrier_reported', explanation: 'A recent synthetic visitor observation reports entrance steps.' } : requirement),
  };
}

test('prominent supported result shows the actual must-have coverage', async ({ page }) => {
  await fakeApi(page, { authenticated: true, savedReport: makeReport('complete', summaryRequirements) });
  await page.goto(`/investigate/${investigationId}`);
  const summary = page.getByRole('region', { name: 'Your must-haves are supported by the available evidence.' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText('2 of 2 must-haves')).toBeVisible();
  await expect(summary.getByText('These are public observations. Confirm current conditions with the venue before arrival.')).toBeVisible();
  const resultBox = await summary.boundingBox();
  const progressBox = await page.locator('.progress-panel').boundingBox();
  expect(resultBox!.y + resultBox!.height).toBeLessThan(progressBox!.y);
});

test('prominent barrier result names the must-have barrier and preserves it in a partial report', async ({ page }) => {
  await fakeApi(page, { authenticated: true, savedReport: barrierReport(true) });
  await page.goto(`/investigate/${investigationId}`);
  const summary = page.getByRole('region', { name: 'A reported barrier conflicts with your must-haves.' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText('Reported barriers: Step-free entrance.')).toBeVisible();
  await expect(summary.getByText('Evidence is partial')).toBeVisible();
  await expect(summary.getByText(/Some evidence could not be fully validated or processed\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your must-haves are supported by the available evidence.' })).toHaveCount(0);
});

test('preferred support cannot hide an unknown must-have and mobile shows the result before controls', async ({ page }) => {
  const requirements: Requirements = [{ feature: 'entrance_step_free', priority: 'preferred' }, { feature: 'accessible_restroom', priority: 'must_have' }];
  const report = makeReport('complete', requirements);
  report.overall = 'needs_confirmation';
  report.requirements = report.requirements.map(requirement => requirement.feature === 'accessible_restroom' ? { ...requirement, status: 'insufficient', claimIds: [], sourceIds: [], explanation: 'No usable restroom observation was retrieved.' } : requirement);
  const text = 'Synthetic test text: The entrance was step free.';
  report.sources = report.sources.map(source => ({ ...source, text }));
  report.claims = report.claims.filter(claim => claim.feature === 'entrance_step_free').map(claim => ({ ...claim, originalQuote: 'The entrance was step free.', quoteStart: text.indexOf('The entrance'), quoteEnd: text.length }));
  const fake = await fakeApi(page, { authenticated: true, savedReport: report, stopReason: 'search_budget_exhausted' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/investigate/${investigationId}`);
  const heading = page.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' });
  await expect(heading).toBeInViewport({ ratio: 1 });
  const summary = page.locator('.visit-result');
  await expect(summary.getByText('0 of 1 must-haves')).toBeVisible();
  await expect(summary.getByText('Still to confirm: Accessible restroom.')).toBeVisible();
  const headingBox = await heading.boundingBox();
  const controlsBox = await page.locator('.requirements-sidebar').boundingBox();
  expect(headingBox!.y + headingBox!.height).toBeLessThan(controlsBox!.y);
  await expect(page.getByText('This bounded investigation used its permitted search attempts and stopped further checks. Remaining venue requirements still need confirmation.')).toBeVisible();
  await summary.getByRole('link', { name: 'View detailed report' }).click();
  await expect(page.getByRole('heading', { name: syntheticVenue.name })).toBeFocused();
  expect(fake.counts().steps).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an incomplete report cannot show a favorable headline even if its overall field says supported', async ({ page }) => {
  const report = { ...makeReport('complete', summaryRequirements), isPartial: true };
  await fakeApi(page, { authenticated: true, savedReport: report });
  await page.goto(`/investigate/${investigationId}`);
  await expect(page.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' })).toBeVisible();
  await expect(page.locator('.visit-result').getByText('Evidence is partial')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your must-haves are supported by the available evidence.' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Public evidence supports your requirements' })).toHaveCount(0);
  await expect(page.locator('.overall-fit')).toHaveClass(/fit-needs_confirmation/);
  await expect(page.getByRole('button', { name: 'Investigate remaining gaps' })).toBeVisible();
});

for (const { origin, limitation } of [
  { origin: 'saved revision', limitation: 'Stage unavailable or incomplete: extraction_validation_rejected.' },
  { origin: 'private job response', limitation: 'Unavailable stage: extraction_validation_rejected.' },
]) test(`partial validation rejection from ${origin} names excluded claims without implying provider failure`, async ({ page }) => {
  const report = { ...makeReport('unknown', summaryRequirements), isPartial: true,
    limitations: [limitation],
  };
  const fake = await fakeApi(page, { authenticated: true, savedReport: report, stopReason: 'extraction_validation_rejected' });
  await page.goto(`/investigate/${investigationId}`);
  const summary = page.locator('.visit-result');
  await expect(summary.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' })).toBeVisible();
  await expect(summary.getByText('Evidence is partial')).toBeVisible();
  await expect(summary.getByText(/Some extracted claims could not be verified against their sources and were excluded\./)).toBeVisible();
  await expect(page.locator('.partial-note')).toContainText('Some extracted claims could not be verified against their sources and were excluded.');
  await expect(summary).toContainText('The result uses only accepted evidence.');
  await expect(summary.getByText('0 of 2 must-haves')).toBeVisible();
  await expect(summary.getByText(/unfinished|unavailable provider|provider failure/i)).toHaveCount(0);
  expect(fake.counts().steps).toBe(0);
  await page.screenshot({ path: '.verification/result-headline-unknown.png', fullPage: false });
});

test('expanded policy shows finite full-run scope and labels the allowance estimate', async ({ page }) => {
  const fake = await fakeApi(page, { authenticated: true, savedReport: makeReport('unknown', summaryRequirements), searchMode: 'expanded', searchCap: 26, effectiveProviderRemaining: 70, lastKnownProviderRemaining: 80, stopReason: 'search_budget_exhausted' });
  await page.goto(`/investigate/${investigationId}`);
  await expect(page.locator('.search-policy')).toContainText('Full bounded investigation.');
  await expect(page.locator('.search-policy')).toContainText('Up to 26 searches');
  await expect(page.getByText('Conservative remaining allowance estimate: 70. Based on the saved account check and later reserved attempts; not a live balance.')).toBeVisible();
  await expect(page.getByText(/Last known provider allowance: 80, checked/)).toBeVisible();
  await expect(page.locator('.stop-note')).toHaveText('The permitted evidence checks for this run are finished. Remaining venue requirements still need confirmation.');
  await expect(page.locator('.reassess-controls')).toContainText('A new run checks the current account balance: above 50 credits permits the full bounded investigation; 50 or fewer limits it to 5 searches.');
  await expect(page.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' })).toBeVisible();
  expect(fake.counts().steps).toBe(0);
});

for (const remaining of [50, null]) test(`credit-conserving policy explains ${remaining === null ? 'unconfirmed' : 'threshold'} allowance without implying fit`, async ({ page }) => {
  const fake = await fakeApi(page, { authenticated: true, savedReport: makeReport('unknown', summaryRequirements), searchMode: 'conserve', searchCap: 5, effectiveProviderRemaining: remaining, stopReason: 'search_budget_exhausted' });
  await page.goto(`/investigate/${investigationId}`);
  await expect(page.locator('.search-policy')).toHaveText('Credit-conserving investigation. Up to 5 searches because the allowance is 50 or fewer, or a fresh balance could not be confirmed.');
  await expect(page.locator('.stop-note')).toHaveText('This investigation reached its credit-conserving search limit. Remaining venue requirements still need confirmation.');
  if (remaining === null) await expect(page.getByText(/Conservative remaining allowance estimate:/)).toHaveCount(0);
  else await expect(page.getByText(/Conservative remaining allowance estimate: 50\./)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' })).toBeVisible();
  expect(fake.counts().steps).toBe(0);
});

test('saved legacy reports keep their limit and explain how new investigations use account policy', async ({ page }) => {
  const fake = await fakeApi(page, { authenticated: true, savedReport: makeReport('unknown', summaryRequirements), searchMode: 'legacy', stopReason: 'search_budget_exhausted' });
  await page.goto(`/investigate/${investigationId}`);
  await expect(page.locator('.search-policy')).toHaveText('Saved investigation. This run keeps its original search limit. Start a new investigation to use the current account policy.');
  await expect(page.locator('.reassess-controls')).toContainText('Unconfirmed balances also use the smaller limit. Fresh app cache entries may be reused.');
  await expect(page.getByRole('button', { name: 'Investigate remaining gaps' })).toBeVisible();
  expect(fake.counts().steps).toBe(0);
});

// Intercepted raster and photo references remain exclusively in this offline browser test.
const syntheticPhotoUrl = 'https://lh3.googleusercontent.com/p/SYNTHETIC-TEST-PHOTO';
const syntheticRaster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6qEIAAAAASUVORK5CYII=', 'base64');
function syntheticPhoto(index = 0): EvidenceImage {
  return { id: `synthetic-photo-${index}`, url: `${syntheticPhotoUrl}-${index}`, sourceUrl: 'https://example.com/synthetic-test-photo-source',
    providerSearchId: 'synthetic-provider-id', retrievedAt: stamp, capturedAt: null, jsonPointer: `/reviews/0/images/${index}`, attribution: 'Google Maps review photo' };
}
function reportWithPhotos(): Report {
  const report = makeReport('unknown', summaryRequirements);
  const source = makeReport('complete', summaryRequirements).sources[0];
  report.sources = [{ ...source, text: 'Synthetic unassessed photo attachment.', images: [syntheticPhoto()] }];
  report.venue = { ...report.venue, images: [{ ...syntheticPhoto(), attribution: 'Google Maps listing' }] };
  return report;
}

test('source photos render once with provenance and unknown photo dates without changing the assessment', async ({ page }) => {
  const report = reportWithPhotos();
  const fake = await fakeApi(page, { authenticated: true, savedReport: report });
  await page.route('https://lh3.googleusercontent.com/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: syntheticRaster }));
  const response = await page.goto(`/investigate/${investigationId}`);
  const gallery = page.getByRole('region', { name: 'Source photos' });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('figure')).toHaveCount(1);
  const image = gallery.getByRole('img', { name: /Supplementary photo 1 supplied by Google Maps listing/ });
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(image).toHaveAttribute('loading', 'lazy');
  await expect(image).toHaveAttribute('src', `${syntheticPhotoUrl}-0`);
  await expect(gallery.getByText('Photo date unknown', { exact: true })).toBeVisible();
  await expect(gallery.locator('.photo-retrieved')).toContainText('10 Oct 2026');
  await expect(gallery.getByRole('link', { name: /View original photo source/ })).toHaveAttribute('href', 'https://example.com/synthetic-test-photo-source');
  await expect(gallery.getByRole('link', { name: 'Read linked source' })).toHaveAttribute('href', '#source-synthetic-source-1');
  await expect(gallery.getByText(/Images are not analysed/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' })).toBeVisible();
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toContain('https://lh3.googleusercontent.com');
  expect(policy).not.toContain('*.googleusercontent.com');
  expect(fake.counts().steps).toBe(0);
});

test('unavailable source photos keep a readable fallback and the original source link', async ({ page }) => {
  await fakeApi(page, { authenticated: true, savedReport: reportWithPhotos() });
  await page.route('https://lh3.googleusercontent.com/**', route => route.abort());
  await page.goto(`/investigate/${investigationId}`);
  const gallery = page.getByRole('region', { name: 'Source photos' });
  await gallery.scrollIntoViewIfNeeded();
  await expect(gallery.getByText('Photo unavailable. The original source link is kept below.')).toBeVisible();
  await expect(gallery.getByRole('img')).toHaveCount(0);
  await expect(gallery.getByRole('link', { name: /View original photo source/ })).toHaveAttribute('href', 'https://example.com/synthetic-test-photo-source');
  await expect(gallery.getByText('Photo date unknown', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requirements not confirmed — check with the venue before visiting.' })).toBeVisible();
});

test('older reports have an honest photo empty state and do not fetch images', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image') requested.push(request.url()); });
  const fake = await fakeApi(page, { authenticated: true, savedReport: makeReport('unknown', summaryRequirements) });
  await page.goto(`/investigate/${investigationId}`);
  const gallery = page.getByRole('region', { name: 'Source photos' });
  await expect(gallery.getByText(/No usable source photos are available in this saved report/)).toBeVisible();
  await expect(gallery.locator('figure')).toHaveCount(0);
  expect(requested).toEqual([]);
  expect(fake.counts().steps).toBe(0);
});

test('photo gallery is bounded, rejects unsafe image URLs and stays accessible on mobile', async ({ page }, testInfo) => {
  const report = reportWithPhotos();
  const source = report.sources[0];
  report.venue.images = [0, 1, 2, 3].map(syntheticPhoto);
  report.sources = [0, 1, 2, 3, 4, 5, 6].map(index => ({ ...source, id: `synthetic-photo-source-${index}`, images: [syntheticPhoto(4 + index * 2), syntheticPhoto(5 + index * 2)] }));
  report.sources.push({ ...source, id: 'synthetic-unsafe-photo-source', images: [{ ...syntheticPhoto(50), url: 'https://lh3.googleusercontent.com/a-/SYNTHETIC-PROFILE' }, { ...syntheticPhoto(51), url: 'http://lh3.googleusercontent.com/p/SYNTHETIC-INSECURE' }] });
  const requested: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image') requested.push(request.url()); });
  await fakeApi(page, { authenticated: true, savedReport: report });
  await page.route('https://lh3.googleusercontent.com/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: syntheticRaster }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/investigate/${investigationId}`);
  const gallery = page.getByRole('region', { name: 'Source photos' });
  await expect(gallery.locator('figure')).toHaveCount(12);
  await expect(gallery.getByText('Showing the first 12 of 18 distinct source photos.')).toBeVisible();
  await gallery.getByRole('img').first().scrollIntoViewIfNeeded();
  await expect.poll(() => gallery.getByRole('img').first().evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(requested.some(url => url.includes('SYNTHETIC-PROFILE') || url.includes('SYNTHETIC-INSECURE'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('synthetic-source-photos-mobile.png'), fullPage: false });
});
