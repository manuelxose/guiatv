import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshCoordinator } from './RefreshCoordinator';

test('cold cache awaits the first fetch', async () => {
  const coordinator = new RefreshCoordinator<string>();
  const entry = await coordinator.get(async () => 'fresh');
  assert.ok(entry);
  assert.equal(entry.value, 'fresh');
  assert.equal(entry.stale, false);
});

test('serves the cached snapshot immediately and revalidates in the background', async () => {
  const coordinator = new RefreshCoordinator<string>();
  await coordinator.get(async () => 'v1');

  // This returns the cached v1 immediately (no await on the provider)…
  let fetched = 'v1';
  const immediate = await coordinator.get(async () => {
    fetched = 'v2';
    return fetched;
  });
  assert.equal(immediate?.value, 'v1');

  // …and the background revalidation then updates the cache.
  await coordinator.idle();
  assert.equal(coordinator.current()?.value, 'v2');
  assert.equal(fetched, 'v2');
});

test('a failed refresh keeps the last good snapshot and marks it stale', async () => {
  const coordinator = new RefreshCoordinator<string>();
  await coordinator.get(async () => 'good');

  coordinator.publish('good'); // simulate a prior successful foreground fetch
  const entry = await coordinator.get(async () => {
    throw new Error('provider down');
  });
  assert.equal(entry?.value, 'good');
  await coordinator.idle();
  assert.equal(coordinator.current()?.stale, true);
  assert.equal(coordinator.current()?.value, 'good');
  assert.match(coordinator.current()?.lastError ?? '', /provider down/);
});

test('cold cache with a failing provider rethrows (nothing to serve)', async () => {
  const coordinator = new RefreshCoordinator<string>();
  await assert.rejects(() =>
    coordinator.get(async () => {
      throw new Error('provider down');
    })
  );
});
