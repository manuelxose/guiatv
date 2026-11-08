import { AvailabilityInput, DataAvailability, DEFAULT_STALE_AFTER_MS, isFresh, resolveAvailability } from './availability';

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  loading: false,
  hasApprovedProvider: true,
  fetchFailed: false,
  hasData: true,
  updatedAt: 1_000_000,
  now: 1_000_000 + 1_000,
  ...over,
});

describe('data availability', () => {
  it('exposes exactly the six documented states', () => {
    const states: readonly DataAvailability[] = ['loading', 'fresh', 'stale', 'provider_unavailable', 'unavailable', 'competition_not_covered'];
    expect(states.length).toBe(6);
    expect(new Set(states).size).toBe(6);
  });

  it('resolves loading while a fetch is in flight', () => {
    expect(resolveAvailability(base({ loading: true }))).toBe('loading');
  });

  it('resolves competition_not_covered when no provider is approved', () => {
    expect(resolveAvailability(base({ hasApprovedProvider: false }))).toBe('competition_not_covered');
  });

  it('resolves provider_unavailable when the fetch failed (fetch error transition)', () => {
    expect(resolveAvailability(base({ fetchFailed: true }))).toBe('provider_unavailable');
  });

  it('resolves unavailable when the provider is approved but has no data for the field (empty competition transition)', () => {
    expect(resolveAvailability(base({ hasData: false }))).toBe('unavailable');
  });

  it('resolves fresh when data exists and is within the freshness window', () => {
    expect(resolveAvailability(base({ updatedAt: 1_000_000, now: 1_000_000 + 60_000 }))).toBe('fresh');
  });

  it('moves fresh -> stale once data is older than the threshold', () => {
    expect(resolveAvailability(base({ updatedAt: 1_000_000, now: 1_000_000 }))).toBe('fresh');
    expect(resolveAvailability(base({ updatedAt: 1_000_000, now: 1_000_000 + DEFAULT_STALE_AFTER_MS + 1 }))).toBe('stale');
  });

  it('moves loading -> fresh when the fetch completes with data', () => {
    expect(resolveAvailability(base({ loading: true }))).toBe('loading');
    expect(resolveAvailability(base({ loading: false, hasData: true, updatedAt: 1_000_000, now: 1_000_000 + 1 }))).toBe('fresh');
  });

  it('moves provider_unavailable -> fresh after a successful retry', () => {
    expect(resolveAvailability(base({ fetchFailed: true }))).toBe('provider_unavailable');
    expect(resolveAvailability(base({ fetchFailed: false, hasData: true, updatedAt: 1_000_000, now: 1_000_000 + 1 }))).toBe('fresh');
  });

  it('moves unavailable -> fresh when data arrives', () => {
    expect(resolveAvailability(base({ hasData: false }))).toBe('unavailable');
    expect(resolveAvailability(base({ hasData: true, updatedAt: 1_000_000, now: 1_000_000 + 1 }))).toBe('fresh');
  });

  it('treats an unknown updatedAt as fresh (demo data has no staleness clock)', () => {
    expect(isFresh(null, 0)).toBeTrue();
    expect(resolveAvailability(base({ hasData: true, updatedAt: null, now: 1_000_000 }))).toBe('fresh');
  });

  it('never returns more than one state for ambiguous inputs (precedence is fixed)', () => {
    // Everything is wrong at once: loading wins first, then no provider, then failure, then no data.
    expect(resolveAvailability(base({ loading: true, hasApprovedProvider: false, fetchFailed: true, hasData: false }))).toBe('loading');
    expect(resolveAvailability(base({ hasApprovedProvider: false, fetchFailed: true, hasData: false }))).toBe('competition_not_covered');
    expect(resolveAvailability(base({ fetchFailed: true, hasData: false }))).toBe('provider_unavailable');
  });
});
