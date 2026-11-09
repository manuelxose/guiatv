import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderSelector, SelectorCandidate } from './ProviderSelector';

const candidate = (overrides: Partial<SelectorCandidate> = {}): SelectorCandidate => ({
  providerId: 'openligadb',
  capabilities: ['fixtures', 'results'],
  competitions: [],
  priority: 1,
  reliability: 1,
  remainingQuota: null,
  freshnessMs: 0,
  ...overrides,
});

test('prototype and blocked providers are never selected (eligibility hard gate)', () => {
  const selector = new ProviderSelector();
  const decision = selector.select(
    { capability: 'fixtures' },
    [
      candidate({ providerId: 'flashscore' }),
      candidate({ providerId: 'google-search' }),
      candidate({ providerId: 'openligadb' }),
    ]
  );
  assert.equal(decision.selected, 'openligadb');
  const proto = decision.candidates.find((c) => c.providerId === 'flashscore')!;
  assert.equal(proto.selected, false);
  assert.ok(proto.reasons.some((r) => r.startsWith('ineligible:')));
});

test('a candidate without the needed capability is rejected', () => {
  const selector = new ProviderSelector();
  const decision = selector.select(
    { capability: 'live_score' },
    [candidate({ capabilities: ['fixtures'] })]
  );
  assert.equal(decision.selected, null);
  assert.ok(decision.candidates[0].reasons.some((r) => r === 'missing_capability:live_score'));
});

test('a candidate that does not cover the requested competition is rejected', () => {
  const selector = new ProviderSelector();
  const decision = selector.select(
    { capability: 'fixtures', competitionSlug: 'laliga' },
    [candidate({ competitions: ['bl1'] })]
  );
  assert.equal(decision.selected, null);
  assert.ok(decision.candidates[0].reasons.some((r) => r === 'no_coverage:laliga'));
});

test('an exhausted quota candidate is rejected', () => {
  const selector = new ProviderSelector();
  const decision = selector.select(
    { capability: 'fixtures' },
    [candidate({ remainingQuota: 0 })]
  );
  assert.equal(decision.selected, null);
  assert.ok(decision.candidates[0].reasons.includes('quota_exhausted'));
});

test('ranking is deterministic: freshness before priority', () => {
  const selector = new ProviderSelector(() => undefined); // bypass eligibility to test pure ranking
  const decision = selector.select(
    { capability: 'fixtures' },
    [
      candidate({ providerId: 'provider-a', freshnessMs: 1000, priority: 1 }),
      candidate({ providerId: 'provider-b', freshnessMs: 100, priority: 5 }),
    ]
  );
  assert.equal(decision.selected, 'provider-b'); // fresher, despite worse priority
});

test('ranking prefers higher reliability on equal freshness', () => {
  const selector = new ProviderSelector(() => undefined);
  const decision = selector.select(
    { capability: 'fixtures' },
    [
      candidate({ providerId: 'provider-a', reliability: 0.5 }),
      candidate({ providerId: 'provider-b', reliability: 1 }),
    ]
  );
  assert.equal(decision.selected, 'provider-b');
});
