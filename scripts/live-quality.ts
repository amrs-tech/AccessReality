import { assertConfiguration, run } from './shared';
import { mkdir, writeFile } from 'node:fs/promises';
import { SYNTHETIC_EXTRACTION_QUALITY } from '../tests/fixtures/extraction-quality';
import { extractClaims, EXTRACTION_PROMPT_VERSION } from '../lib/providers/gemini';
import { validateExtractedClaims, EXTRACTOR_VERSION } from '../lib/evidence/validate';
import { makeSource } from '../lib/evidence/normalize';
import type { Venue } from '../lib/contracts';

// Synthetic labeled evidence for an explicit model-quality check only. No app routes import it.
const selected = ['positive-entrance', 'negative-entrance', 'question', 'portable-ramp', 'request-only', 'main-entrance-stairs', 'rear-entrance-ramp', 'positive-restroom', 'negative-restroom', 'condition-restroom', 'lift-presence', 'lift-working', 'lift-broken', 'upper-floor-lift', 'positive-parking', 'negative-parking', 'positive-seating', 'interior-barrier', 'arrival-path', 'another-branch', 'irrelevant-coffee', 'hindi-uncertain', 'kannada-uncertain', 'prompt-injection', 'speculation', 'planned-ramp', 'future-lift-operation', 'attributed-marketing'];
run(async () => {
  const env = assertConfiguration();
  if (!process.argv.includes('--confirm-live')) throw Object.assign(new Error(), { code: 'explicit_opt_in_required_use_--confirm-live' });
  const examples = selected.map(id => SYNTHETIC_EXTRACTION_QUALITY.find(example => example.id === id)!);
  const now = new Date().toISOString();
  const venue: Venue = { id: 'synthetic-quality-only', name: 'SYNTHETIC TEST VENUE', address: 'Synthetic test branch', googlePlaceId: null, dataCid: null, dataId: null, website: null, phone: null, category: null, sourceUrl: null, latitude: null, longitude: null, rating: null, provisional: false };
  const sources = examples.map(example => makeSource({ id: example.id, venueId: venue.id, kind: 'maps_review', text: example.text, sourceUrl: null, providerReviewId: null, providerSearchId: null, engine: 'synthetic-quality-test', retrievedAt: now, publishedAt: null, editedAt: null, observedAt: null, selectionMethod: 'newest', metadata: { venueMatch: example.ambiguousBranch ? 'ambiguous' : 'exact', syntheticTest: true } }));
  const proposed = await extractClaims(sources, venue, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  const validated = validateExtractedClaims(proposed.claims, sources, venue.id, now);
  let invalidAcceptedCitations = 0, unsupportedPositive = 0, mismatchedFeaturePolarity = 0, missingScope = 0;
  const rows = examples.map(example => {
    const claims = validated.accepted.filter(claim => claim.sourceId === example.id);
    let correct = 0;
    for (const claim of claims) {
      const source = sources.find(item => item.id === claim.sourceId)!;
      if (claim.quoteStart === null || claim.quoteEnd === null || source.text.slice(claim.quoteStart, claim.quoteEnd) !== claim.originalQuote) invalidAcceptedCitations++;
      const matching = example.expected === 'accepted' && claim.feature === example.feature && claim.polarity === example.expectedPolarity;
      if (matching) correct++; else mismatchedFeaturePolarity++;
      if (claim.polarity === 'supports' && !matching) unsupportedPositive++;
      if (matching && ((example.entrance && claim.scope.entrance !== example.entrance) || (example.floor && claim.scope.floor !== example.floor) || (example.condition && claim.scope.conditions.length === 0))) missingScope++;
    }
    return { id: example.id, expected: example.expectedPolarity ?? example.expected, accepted: claims.map(claim => ({ feature: claim.feature, polarity: claim.polarity, scope: claim.scope })), correct, unresolved: example.expected === 'accepted' && correct === 0 };
  });
  const critical = rows.filter(row => ['negative-entrance', 'main-entrance-stairs', 'negative-restroom', 'negative-parking', 'lift-broken', 'interior-barrier', 'portable-ramp', 'condition-restroom'].includes(row.id));
  const criticalUnresolved = critical.filter(row => row.correct === 0).map(row => row.id);
  const record = { checkedAt: now, model: env.GEMINI_MODEL, extractorVersion: EXTRACTOR_VERSION, promptVersion: EXTRACTION_PROMPT_VERSION, syntheticTestOnly: true, examples: examples.length, geminiRequests: 1, searchAttempts: 0, proposed: proposed.claims.length, accepted: validated.accepted.length, rejected: validated.rejected.map(item => item.reason), correctFeaturePolarity: rows.reduce((sum, row) => sum + row.correct, 0), unsupportedPositive, invalidAcceptedCitations, mismatchedFeaturePolarity, missingScope, criticalUnresolved, unresolvedExamples: rows.filter(row => row.unresolved).map(row => row.id), rows };
  await mkdir('.verification', { recursive: true });
  await writeFile(`.verification/quality-${Date.now()}.json`, JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  if (unsupportedPositive || invalidAcceptedCitations || mismatchedFeaturePolarity || missingScope || criticalUnresolved.length) throw Object.assign(new Error(), { code: 'reviewed_model_quality_gate_failed' });
});
