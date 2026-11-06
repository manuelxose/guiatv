import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEligible,
  getProviderEligibility,
  providerEligibilityRegistry,
  ProviderNotEligibleError,
} from './providerEligibilityRegistry';

test('openligadb is approved and assertEligible admits it', () => {
  const entry = assertEligible('openligadb');
  assert.equal(entry.eligibility.state, 'approved');
  assert.equal(entry.eligibility.approvedBy, 'owner');
});

test('football-data-org is a prototype and assertEligible throws', () => {
  assert.throws(
    () => assertEligible('football-data-org'),
    (error: unknown) =>
      error instanceof ProviderNotEligibleError && error.state === 'prototype'
  );
});

test('google-search and flashscore are blocked with a reason and no adapter capabilities', () => {
  for (const id of ['google-search', 'flashscore'] as const) {
    const entry = getProviderEligibility(id);
    assert.ok(entry);
    assert.equal(entry.eligibility.state, 'blocked');
    assert.ok(entry.eligibility.reason.length > 0);
    assert.equal(entry.capabilities.length, 0);
  }
  assert.equal(getProviderEligibility('google-search')?.rightsState, 'prohibited');
  assert.equal(getProviderEligibility('flashscore')?.rightsState, 'unverified');
});

test('assertEligible throws for every non-approved and unknown provider', () => {
  for (const id of ['football-data-org', 'google-search', 'flashscore', 'made-up-provider']) {
    assert.throws(() => assertEligible(id), ProviderNotEligibleError);
  }
});

test('registry is frozen (entries, capabilities and competitions are immutable)', () => {
  assert.equal(Object.isFrozen(providerEligibilityRegistry), true);
  const openliga = getProviderEligibility('openligadb')!;
  assert.equal(Object.isFrozen(openliga), true);
  assert.equal(Object.isFrozen(openliga.capabilities), true);
  assert.equal(Object.isFrozen(openliga.competitions), true);
  assert.equal(Object.isFrozen(openliga.eligibility), true);
});

test('openligadb does not claim capabilities it cannot supply', () => {
  const caps = getProviderEligibility('openligadb')!.capabilities;
  assert.equal(caps.includes('live_minute'), false);
  assert.equal(caps.includes('lineups'), false);
  assert.equal(caps.includes('statistics'), false);
  assert.equal(caps.includes('standings'), false);
});
