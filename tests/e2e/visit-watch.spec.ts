import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { PublicJob, Report, Venue } from '../../lib/contracts';
import type { NewsArticle, NewsCheckResult, PublicNewsCheck } from '../../lib/news/contracts';

// Synthetic, intercepted browser-only data. Production never imports this file.
const parentId = '44444444-4444-4444-8444-444444444444';
const checkId = '55555555-5555-4555-8555-555555555555';
const venue: Venue = { id: 'synthetic-news-venue', name: 'Synthetic News Venue', address: 'Synthetic East Road, Bengaluru', googlePlaceId: null, dataCid: null, dataId: 'synthetic-news-data-id', website: null, phone: null, category: null, sourceUrl: null, latitude: null, longitude: null, rating: null, provisional: false };
const briefTime = '2026-10-10T08:00:00.000Z';
const report: Report = { venue, requirements: [{ feature: 'entrance_step_free', priority: 'must_have', status: 'insufficient', claimIds: [], sourceIds: [], explanation: 'Synthetic test evidence is missing.', barrierToConfirm: false, conditions: [], dataQualityFlags: [] }], claims: [], sources: [], overall: 'needs_confirmation', generatedAt: briefTime, isPartial: false, questions: ['Confirm the entrance directly.'], limitations: ['Synthetic test fixture only.'], algorithmVersion: 'synthetic', extractorVersion: 'synthetic', reviewsExamined: 0 };
const originalHeadline = 'Requirements not confirmed — check with the venue before visiting.';

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return { id: 'synthetic-news-1', title: 'Synthetic News Venue renovation announced in Bengaluru', url: 'https://example.com/synthetic-news-article', publisher: 'Synthetic test publisher', snippet: 'Synthetic test snippet: renovation was announced.', publishedAt: '2026-10-11T06:00:00.000Z', dateLabel: null, recency: 'recent', relation: 'venue_and_area', topics: ['maintenance'], newerThanBrief: true, ...overrides };
}
function result(articles: NewsArticle[] = [article()], expired = false): NewsCheckResult {
  const retrievedAt = new Date(Date.now() - (expired ? 7_200_000 : 60_000)).toISOString();
  return { articles, retrievedAt, expiresAt: new Date(Date.parse(retrievedAt) + 3_600_000).toISOString(), query: '"Synthetic News Venue" Bengaluru closure renovation outage when:90d', providerSearchId: 'synthetic-news-provider-id', briefGeneratedAt: briefTime, limitations: ['Synthetic publication dates never establish current operation.'] };
}
function check(overrides: Partial<PublicNewsCheck> = {}): PublicNewsCheck {
  return { id: checkId, parentJobId: parentId, phase: 'news_search', stateVersion: 0, providerAttempts: 0, appCacheHits: 0, searchCap: 2, result: null, nextRetryAt: null, canResume: true, stopReason: null, errorCode: null, ...overrides };
}
async function intercepted(page: Page, options: {
  saved?: PublicNewsCheck; articles?: NewsArticle[]; wait?: boolean; createTransportFailure?: boolean;
  stepTransportFailure?: boolean; unfinishedParent?: boolean; holdFirstStep?: boolean; completeAfterTwo?: boolean;
} = {}) {
  let saved = options.saved ?? null;
  let reads = 0, creates = 0, steps = 0;
  const keys: string[] = [];
  let heldRelease: (() => void) | null = null;
  let wait = options.wait ?? false;
  const job: PublicJob = { id: parentId, kind: 'investigation', phase: options.unfinishedParent ? 'reviews' : 'complete', stateVersion: 6, venue, candidates: [], requirements: [{ feature: 'entrance_step_free', priority: 'must_have' }], report, providerAttempts: 6, appCacheHits: 1, searchCap: 26, llmAttempts: 2, llmCap: 56, sourceCount: 0, reviewsExamined: 0, events: [], stopReason: 'no_more_actions', nextRetryAt: null, canResume: !!options.unfinishedParent, remainingAction: null, discoveryJobId: null, candidateId: null, lastKnownProviderRemaining: 200, allowanceCheckedAt: briefTime, searchMode: 'expanded', effectiveProviderRemaining: 200 };
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/session') return json({ authenticated: true, configured: true, csrfToken: 'synthetic-news-csrf' });
    if (path === `/api/jobs/${parentId}`) return json(job);
    if (path === `/api/jobs/${parentId}/news-check`) {
      if (request.method() === 'GET') { reads += 1; return json({ check: saved }); }
      const body = request.postDataJSON(); expect(request.headers()['x-csrf-token']).toBe('synthetic-news-csrf');
      expect(Object.keys(body)).toEqual(['idempotencyKey']);
      expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i); keys.push(body.idempotencyKey); creates += 1;
      if (!saved || !saved.canResume) saved = check({ id: creates > 1 ? '66666666-6666-4666-8666-666666666666' : checkId });
      if (options.createTransportFailure && creates === 1) return route.abort('failed');
      return json({ check: saved });
    }
    if (path === `/api/jobs/${parentId}/news-check/step`) {
      const body = request.postDataJSON(); expect(request.headers()['x-csrf-token']).toBe('synthetic-news-csrf');
      expect(body.checkId).toBe(saved!.id); expect(body.expectedVersion).toBe(saved!.stateVersion); steps += 1;
      if (options.holdFirstStep && steps === 1) await new Promise<void>(resolve => { heldRelease = resolve; });
      if (options.stepTransportFailure && steps === 1) return route.abort('failed');
      if ((wait || options.completeAfterTwo) && steps === 1) saved = check({ stateVersion: 1, providerAttempts: 1, nextRetryAt: wait ? new Date(Date.now() + 60_000).toISOString() : null, errorCode: wait ? 'upstream_rate_limited' : null });
      else saved = check({ id: saved!.id, phase: 'complete', stateVersion: saved!.stateVersion + 1, providerAttempts: options.completeAfterTwo || wait ? 2 : 1, canResume: false, result: result(options.articles), stopReason: 'news_check_complete' });
      return json({ check: saved });
    }
    return json({ error: { code: 'unexpected_test_route', message: path, retryable: false } }, 404);
  });
  return { counts: () => ({ reads, creates, steps, keys }), clearWait: () => { wait = false; if (saved) saved.nextRetryAt = null; }, release: () => heldRelease?.() };
}

test('news check requires an explicit click and leaves the saved accessibility result and counts unchanged', async ({ page }) => {
  const fake = await intercepted(page); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await expect(panel.getByRole('button', { name: 'Check before I go' })).toBeEnabled();
  expect(fake.counts().creates).toBe(0); expect(fake.counts().steps).toBe(0);
  await expect(panel.getByText(/one Google News query, up to 2 counted attempts/)).toBeVisible();
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect(panel.getByRole('heading', { name: 'Public reports to review before your visit.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: originalHeadline })).toBeVisible();
  expect(fake.counts().creates).toBe(1); expect(fake.counts().steps).toBe(1);
  await expect(panel.getByText(/1 \/ 2 search attempts/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Check news again' })).toBeDisabled();
});

test('news cards keep observed attribution, date uncertainty, match caution and the checked brief snapshot', async ({ page }) => {
  const articles = [article(), article({ id: 'synthetic-news-2', title: 'Synthetic city flood report', relation: 'area_context', publishedAt: '2025-10-10T00:00:00.000Z', recency: 'older', newerThanBrief: false, snippet: null, topics: ['weather'] }), article({ id: 'synthetic-news-3', title: 'Synthetic unknown-date venue story', relation: 'possible_venue', publishedAt: null, dateLabel: '2 days ago', recency: 'unknown', newerThanBrief: null, publisher: null, snippet: null }), article({ id: 'synthetic-news-4', title: 'Synthetic unmatched story', relation: 'unmatched', publishedAt: null, recency: 'unknown', newerThanBrief: null })];
  await intercepted(page, { saved: check({ phase: 'complete', canResume: false, providerAttempts: 1, result: result(articles) }) });
  await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await expect(panel.locator('.watch-article')).toHaveCount(4);
  await expect(panel.getByText('Published after the checked brief', { exact: true })).toHaveCount(1);
  await expect(panel.getByText('Older report', { exact: true })).toBeVisible();
  await expect(panel.getByText('City or area context · venue impact unverified')).toBeVisible();
  await expect(panel.getByText('Possible venue mention · exact branch unverified')).toBeVisible();
  await expect(panel.getByText('Venue or area match unverified')).toBeVisible();
  await expect(panel.getByText('Reported date: 2 days ago · exact publication date unknown')).toBeVisible();
  const link = panel.getByRole('link', { name: /Synthetic News Venue renovation/ });
  await expect(link).toHaveAttribute('href', 'https://example.com/synthetic-news-article');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await panel.getByText('Search scope and limits').click();
  await expect(panel.getByText(/Recently published means published within 14 days/)).toBeVisible();
  await expect(panel.getByText(/Reassessing the saved brief does not refresh this news check/)).toBeVisible();
  await expect(page.getByRole('heading', { name: originalHeadline })).toBeVisible();
});

test('an empty successful news response keeps current conditions unknown', async ({ page }) => {
  const fake = await intercepted(page, { articles: [] }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect(panel.getByRole('heading', { name: 'No matching reports found — current conditions remain unknown.' })).toBeVisible();
  await expect(panel.locator('.watch-article')).toHaveCount(0);
  await expect(panel.getByText(/No matching news is not an all-clear/)).toBeVisible();
  await expect(panel.getByText(/News cannot confirm current lift operation/)).toBeVisible();
  expect(fake.counts().steps).toBe(1);
});

test('news topics produce private requirement-aware confirmation questions without changing the result', async ({ page }) => {
  const fake = await intercepted(page, { articles: [article({ topics: ['closure', 'weather'] })] });
  await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect(panel.getByRole('heading', { name: 'What to confirm for your visit' })).toBeVisible();
  await expect(panel.getByText('Is the selected branch open for my visit?')).toBeVisible();
  await expect(panel.getByText('Has the reported event affected the entrance or arrival arrangements?')).toBeVisible();
  await expect(panel.getByText(/Your requirements stay private; these questions have not been sent/)).toBeVisible();
  await expect(panel.getByText(/Are the lift/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: originalHeadline })).toBeVisible();
  expect(fake.counts().creates).toBe(1); expect(fake.counts().steps).toBe(1);
});

test('known failures wait and only an explicit resume sends the permitted retry', async ({ page }) => {
  const fake = await intercepted(page, { wait: true }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect(panel.getByText(/The provider requested a wait/)).toBeVisible();
  expect(fake.counts().steps).toBe(1);
  await page.reload(); await expect(panel.getByRole('button', { name: 'Resume news check' })).toBeVisible();
  expect(fake.counts().steps).toBe(1);
  fake.clearWait(); await page.reload();
  await panel.getByRole('button', { name: 'Resume news check' }).click();
  await expect(panel.getByRole('heading', { name: 'Public reports to review before your visit.' })).toBeVisible();
  expect(fake.counts().steps).toBe(2); expect(fake.counts().creates).toBe(1);
});

test('transport failure on creation preserves the idempotency key for explicit recovery', async ({ page }) => {
  const fake = await intercepted(page, { createTransportFailure: true }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect(panel.getByRole('alert')).toBeVisible(); expect(fake.counts().steps).toBe(0);
  await panel.getByRole('button', { name: 'Try news check again' }).click();
  await expect(panel.getByRole('heading', { name: 'Public reports to review before your visit.' })).toBeVisible();
  expect(fake.counts().keys).toHaveLength(2); expect(fake.counts().keys[0]).toBe(fake.counts().keys[1]);
  expect(fake.counts().steps).toBe(1);
});

test('an ambiguous transport failure does not automatically replay a dispatched news step', async ({ page }) => {
  const fake = await intercepted(page, { stepTransportFailure: true }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect(panel.getByRole('alert')).toBeVisible(); expect(fake.counts().steps).toBe(1);
  await expect(panel.getByRole('button', { name: 'Resume news check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: originalHeadline })).toBeVisible();
  await page.reload(); await expect(panel.getByRole('button', { name: 'Resume news check' })).toBeVisible();
  expect(fake.counts().steps).toBe(1); expect(fake.counts().creates).toBe(1);
});

test('hiding the tab finishes an in-flight step but prevents another step until explicit resume', async ({ page }) => {
  const fake = await intercepted(page, { holdFirstStep: true, completeAfterTwo: true }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await panel.getByRole('button', { name: 'Check before I go' }).click();
  await expect.poll(() => fake.counts().steps).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  fake.release(); await expect(panel.getByRole('button', { name: 'Resume news check' })).toBeEnabled();
  expect(fake.counts().steps).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(fake.counts().steps).toBe(1);
  await panel.getByRole('button', { name: 'Resume news check' }).click();
  await expect(panel.getByRole('heading', { name: 'Public reports to review before your visit.' })).toBeVisible();
  expect(fake.counts().steps).toBe(2);
});

test('cached and expired news retain retrieval provenance and permit a new check only explicitly', async ({ page }) => {
  const cached = check({ phase: 'complete', canResume: false, appCacheHits: 1, result: result([article()], true) });
  const fake = await intercepted(page, { saved: cached }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await expect(panel.getByText(/This saved check has expired/)).toBeVisible();
  await expect(panel.getByText(/Reused from the one-hour app cache; the original retrieval time is shown/)).toBeVisible();
  expect(fake.counts().creates).toBe(0); expect(fake.counts().steps).toBe(0);
  await panel.getByRole('button', { name: 'Check news again' }).click();
  await expect(panel.getByRole('heading', { name: 'Public reports to review before your visit.' })).toBeVisible();
  expect(fake.counts().creates).toBe(1); expect(fake.counts().steps).toBe(1);
});

test('an incomplete check stays visibly unavailable and never alters the accessibility verdict', async ({ page }) => {
  const fake = await intercepted(page, { saved: check({ phase: 'partial', canResume: false, providerAttempts: 2, stopReason: 'budget_exhausted', errorCode: 'budget_exhausted' }) });
  await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await expect(panel.getByRole('heading', { name: 'News check incomplete — current conditions remain unknown.' })).toBeVisible();
  await expect(panel.getByText(/2 \/ 2 search attempts/)).toBeVisible();
  await expect(panel.getByText(/The permitted search allowance is unavailable for this check/)).toBeVisible();
  await expect(page.getByRole('heading', { name: originalHeadline })).toBeVisible();
  expect(fake.counts().steps).toBe(0);
});

test('a running investigation cannot create a news check before its saved terminal brief', async ({ page }) => {
  const fake = await intercepted(page, { unfinishedParent: true }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await expect(panel.getByRole('button', { name: 'Check before I go' })).toBeDisabled();
  await expect(panel.getByText(/Finish or save the accessibility investigation/)).toBeVisible();
  expect(fake.counts().reads).toBe(0); expect(fake.counts().creates).toBe(0); expect(fake.counts().steps).toBe(0);
});

test('news cards reject unsafe links and remain accessible on mobile', async ({ page }, testInfo) => {
  await intercepted(page, { saved: check({ phase: 'complete', canResume: false, result: result([article({ url: 'javascript:alert(1)' }), article({ id: 'synthetic-news-2', relation: 'area_context', recency: 'unknown', publishedAt: null, newerThanBrief: null, title: 'Synthetic city weather report', url: 'https://example.com/synthetic-city-weather' })]) }) });
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto(`/investigate/${parentId}`);
  const panel = page.getByRole('region', { name: 'Has anything changed since this brief?' });
  await expect(panel.getByText('Original article link unavailable.')).toBeVisible();
  await expect(panel.getByRole('link', { name: /Synthetic News Venue/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).analyze(); expect(audit.violations).toEqual([]);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('synthetic-before-you-go-mobile.png'), fullPage: false });
});
