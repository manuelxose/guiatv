import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GracefulDegradation,
  isEpgOnly,
  isEpgOnlyBatch,
  mergeRichAndEpg,
  refuseEpgOnlyDowngrade,
} from './GracefulDegradation';

interface Item {
  id: string;
  sourceProvenance?: { source?: string };
}

test('provider failure returns the last good value marked stale', async () => {
  const degradation = new GracefulDegradation<Item[]>();
  const first = await degradation.get(async () => [{ id: 'a', sourceProvenance: { source: 'openligadb' } }]);
  assert.equal(first.stale, false);

  const second = await degradation.get(async () => {
    throw new Error('provider down');
  });
  assert.equal(second.stale, true);
  assert.equal(second.fromFallback, true);
  assert.equal(second.value.length, 1);
  assert.match(second.lastError ?? '', /provider down/);
});

test('never downgrades a rich record to an EPG-only record', async () => {
  const degradation = new GracefulDegradation<Item[]>(refuseEpgOnlyDowngrade);
  const rich = [{ id: 'a', sourceProvenance: { source: 'openligadb' } }];
  await degradation.get(async () => rich);

  const epgOnly = [{ id: 'a', sourceProvenance: { source: 'epg' } }];
  const result = await degradation.get(async () => epgOnly);
  assert.equal(result.stale, true);
  assert.equal(result.value, rich); // the rich record is preserved
});

test('isEpgOnly and isEpgOnlyBatch detect EPG-only records', () => {
  assert.equal(isEpgOnly({ sourceProvenance: { source: 'epg' } }), true);
  assert.equal(isEpgOnly({ sourceProvenance: { source: 'openligadb' } }), false);
  assert.equal(isEpgOnly(undefined), false);
  assert.equal(isEpgOnlyBatch([{ sourceProvenance: { source: 'epg' } }]), true);
  assert.equal(isEpgOnlyBatch([{ sourceProvenance: { source: 'openligadb' } }]), false);
  assert.equal(isEpgOnlyBatch([]), false);
});

test('mergeRichAndEpg keeps rich records per key and only fills gaps with EPG', () => {
  const rich: Item[] = [{ id: 'a', sourceProvenance: { source: 'openligadb' } }];
  const epg: Item[] = [
    { id: 'a', sourceProvenance: { source: 'epg' } },
    { id: 'b', sourceProvenance: { source: 'epg' } },
  ];
  const merged = mergeRichAndEpg(rich, epg, (item) => item.id);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((m) => m.id === 'a')?.sourceProvenance?.source, 'openligadb');
  assert.equal(merged.find((m) => m.id === 'b')?.sourceProvenance?.source, 'epg');
});
