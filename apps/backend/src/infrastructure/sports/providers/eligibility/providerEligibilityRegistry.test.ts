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

test('M07: football-data-org and footballdata-io are owner-approved keyed providers', () => {
  for (const id of ['football-data-org', 'footballdata-io']) {
    const entry = assertEligible(id);
    assert.equal(entry.eligibility.approvedBy, 'owner');
    assert.equal(entry.authMode, 'api_key');
  }
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
  for (const id of ['google-search', 'flashscore', 'made-up-provider']) {
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

test('F05: assertEligible is the sole admission gate — a locally installed adapter cannot become an authorised provider', () => {
  // Only `approved` entries pass. A locally installed adapter for a prototype,
  // blocked or unknown provider has NO path through this gate, so it can never
  // construct a client, issue a request or write. This is the single boundary
  // every ingestion entry path (scheduled loop, manual sync, CLI, startup) uses.
  for (const id of ['google-search', 'flashscore', 'made-up-provider']) {
    assert.throws(
      () => assertEligible(id as never),
      (error: unknown) => error instanceof ProviderNotEligibleError
    );
  }
  assert.equal(assertEligible('openligadb').eligibility.state, 'approved');
});
