import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Report, Requirements, Venue } from '../../lib/contracts';
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

async function fakeApi(page: Page, options: { mode?: 'complete' | 'unknown' | 'partial'; authenticated?: boolean; expire?: boolean; resumable?: boolean } = {}) {
  let authenticated = options.authenticated ?? false;
  let requirements = [...defaultRequirements];
  let stage = options.resumable ? 1 : 0;
  let retryAt: string | null = null;
  let searchCount = 0;
  let discoverySteps = 0;
  let assessmentCount = 0;
  let creates = 0;
  const mode = options.mode ?? 'complete';
  const job = (kind: 'discovery' | 'investigation'): Job => ({
    id: kind === 'discovery' ? discoveryId : investigationId, kind,
    phase: kind === 'discovery' ? discoverySteps ? 'complete' : 'discovery' : stage >= 3 ? mode === 'partial' ? 'partial' : 'complete' : ['details', 'reviews', 'extract'][stage],
    stateVersion: kind === 'discovery' ? discoverySteps : stage, venue: kind === 'discovery' ? null : syntheticVenue,
    candidates: kind === 'discovery' && discoverySteps ? [syntheticVenue] : [], requirements,
    report: kind === 'investigation' && stage >= 3 ? makeReport(mode, requirements) : null,
    providerAttempts: kind === 'discovery' ? discoverySteps : Math.min(stage, 2), appCacheHits: 0, searchCap: kind === 'discovery' ? 1 : 5,
    llmAttempts: kind === 'investigation' && stage >= 3 ? 1 : 0, llmCap: 6, sourceCount: stage >= 3 && mode === 'complete' ? 1 : 0, reviewsExamined: stage >= 3 && mode === 'complete' ? 2 : 0,
    events: [{ type: 'test_action', message: 'Synthetic test action: checking entrance evidence.', createdAt: stamp }],
    stopReason: stage >= 3 ? mode === 'partial' ? 'upstream_unavailable' : 'evidence_sufficient' : null, nextRetryAt: retryAt,
    canResume: stage < 3, remainingAction: stage < 3 ? 'FETCH_NEWEST_REVIEWS' : null,
    discoveryJobId: kind === 'investigation' ? discoveryId : null, candidateId: kind === 'investigation' ? syntheticVenue.id : null,
    lastKnownProviderRemaining: null, allowanceCheckedAt: null,
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
