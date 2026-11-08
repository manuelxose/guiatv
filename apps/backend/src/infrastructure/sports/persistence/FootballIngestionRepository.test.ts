import test from 'node:test';
import assert from 'node:assert/strict';
import { FootballSnapshotModel, FootballProviderSyncStateModel, FootballIngestionRunModel } from './models';

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

test('F04: snapshot schema declares the stable unique {providerId, matchId} identity index', () => {
  assert.equal(hasUniqueIndex(FootballSnapshotModel.schema, { providerId: 1, matchId: 1 }), true);
});

test('sync state schema declares a unique provider index', () => {
  assert.equal(hasUniqueIndex(FootballProviderSyncStateModel.schema, { provider: 1 }), true);
});

test('F03: the ingestion run schema allows the truthful `empty` outcome', () => {
  const outcomePath = FootballIngestionRunModel.schema.path('outcome') as unknown as { enumValues?: string[] };
  assert.ok(Array.isArray(outcomePath.enumValues), 'outcome is an enum');
  assert.ok(outcomePath.enumValues!.includes('empty'), 'empty must be a first-class run outcome');
});
