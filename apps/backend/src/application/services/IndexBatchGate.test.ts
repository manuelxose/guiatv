import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IndexBatchGate, parseBatchAllowlist, signBatchDocument, BATCH_HARD_CAP, CUMULATIVE_HARD_CAP } from './IndexBatchGate';

const KEY = 'k'.repeat(32);
const entry = (n: number) => ({ path: `/guias-x/p${n}`, approvedBy: 'Ana Revisora', approvedAt: '2026-11-03T10:00:00Z', evidenceHash: 'ab'.repeat(16) });
const batch = (batchId: string, entries: any[], key = KEY) => ({ batchId, policyVersion: 'g2-v1', entries, signature: signBatchDocument({ version: 1, batchId, policyVersion: 'g2-v1', entries }, key) });
const doc = (...batches: any[]) => JSON.stringify({ version: 1, batches });
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => entry(from + i));

function gate(env: Record<string, string>, files: Record<string, string>, clock = { t: 0 }) {
  const ledger: string[] = [];
  const g = new IndexBatchGate({
    env: { INDEX_BATCH_ENABLED: 'true', INDEX_BATCH_SIGNING_KEY: KEY, INDEX_BATCH_ALLOWLIST_FILE: 'allow.json', INDEX_BATCH_LEDGER_FILE: 'ledger', ...env },
    now: () => clock.t,
    read: (f) => files[f] ?? null,
    exists: (f) => f in files,
    append: (_f, line) => ledger.push(line),
  });
  return { g, ledger, clock };
}

test('disabled gate makes nothing indexable', () => {
  const { g } = gate({ INDEX_BATCH_ENABLED: 'false' }, { 'allow.json': doc(batch('b1', rows(2))) });
  assert.equal(g.state(), 'disabled');
  assert.equal(g.isIndexable('/guias-x/p0'), false);
});

test('signed allowlist makes exactly the listed paths indexable', () => {
  const { g } = gate({}, { 'allow.json': doc(batch('b1', rows(2))) });
  assert.equal(g.state(), 'active');
  assert.deepEqual(g.paths(), ['/guias-x/p0', '/guias-x/p1']);
  assert.equal(g.isIndexable('/guias-x/p1/'), true);
  assert.equal(g.isIndexable('/guias-x/p2'), false);
});

test('kill file stops indexing within the recheck window without a restart, and recovery is ledgered', () => {
  const files: Record<string, string> = { 'allow.json': doc(batch('b1', rows(1))) };
  const { g, ledger, clock } = gate({ INDEX_BATCH_KILL_FILE: 'kill' }, files);
  assert.equal(g.isIndexable('/guias-x/p0'), true);
  const before = g.partition();
  files.kill = '1'; clock.t += 6000;
  assert.equal(g.isIndexable('/guias-x/p0'), false);
  assert.equal(g.state(), 'killed');
  assert.notEqual(g.partition(), before, 'sitemap cache key changes so the child rebuilds at once');
  delete files.kill; clock.t += 6000;
  assert.equal(g.isIndexable('/guias-x/p0'), true);
  assert.deepEqual(ledger.map((l) => JSON.parse(l).event), ['active', 'killed', 'active']);
});

test('wrong signature, missing key or tampered entry makes everything non-indexable', () => {
  const bad = batch('b1', rows(1), 'other-key');
  assert.equal(gate({}, { 'allow.json': doc(bad) }).g.state(), 'invalid');
  assert.equal(gate({ INDEX_BATCH_SIGNING_KEY: '' }, { 'allow.json': doc(batch('b1', rows(1))) }).g.state(), 'invalid');
  const good = batch('b1', rows(1));
  good.entries[0].path = '/guias-x/other';
  assert.throws(() => parseBatchAllowlist(doc(good), KEY), /signature invalid/);
});

test('hard caps: 26th entry in a batch and 101st overall are refused', () => {
  assert.throws(() => parseBatchAllowlist(doc(batch('b1', rows(BATCH_HARD_CAP + 1))), KEY), /ceiling/);
  const full = [0, 1, 2, 3].map((i) => batch(`b${i}`, rows(BATCH_HARD_CAP, i * BATCH_HARD_CAP)));
  assert.equal(parseBatchAllowlist(doc(...full), KEY).length, CUMULATIVE_HARD_CAP);
  assert.throws(() => parseBatchAllowlist(doc(...full, batch('b4', rows(1, 500))), KEY), /cumulative/);
});

test('entries need approver, date, evidence hash, unique valid path', () => {
  const noHash = [{ ...entry(0), evidenceHash: 'zz' }];
  assert.throws(() => parseBatchAllowlist(doc(batch('b1', noHash)), KEY), /evidenceHash/);
  assert.throws(() => parseBatchAllowlist(doc(batch('b1', [{ ...entry(0), approvedBy: ' ' }])), KEY), /approver/);
  assert.throws(() => parseBatchAllowlist(doc(batch('b1', [{ ...entry(0), path: '/Bad Path' }])), KEY), /path/);
  assert.throws(() => parseBatchAllowlist(doc(batch('b1', [entry(0), entry(0)])), KEY), /duplicate/);
});
