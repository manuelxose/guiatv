import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballSnapshotModel, FootballProviderSyncStateModel } from './models';

// The mongoose `IndexDefinition` union (string | object) makes a precise type
// noisy; the runtime value for our numeric indexes is a plain object.
function hasUniqueIndex(schema: any, fields: Record<string, number>): boolean {
  const key = JSON.stringify(fields);
  return schema.indexes().some(([indexFields, opts]: [any, any]) => JSON.stringify(indexFields) === key && opts.unique === true);
}

test('snapshot schema declares the unique {canonicalKey, providerId} and contentHash indexes', () => {
  assert.equal(hasUniqueIndex(FootballSnapshotModel.schema, { canonicalKey: 1, providerId: 1 }), true);
  assert.equal(hasUniqueIndex(FootballSnapshotModel.schema, { contentHash: 1 }), true);
});

test('sync state schema declares a unique provider index', () => {
  assert.equal(hasUniqueIndex(FootballProviderSyncStateModel.schema, { provider: 1 }), true);
});
