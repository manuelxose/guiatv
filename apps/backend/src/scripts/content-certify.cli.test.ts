/** The owner's offline flow through the real CLI: keygen -> authorize -> verify. No database, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { realInputsAvailable, realRoot } from '@/application/services/ContentCertification.fixtures';

const cli = path.resolve(__dirname, 'content-certify.js');
const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });

test('owner flow: only the owner key can authorise the exact committed batch; a stale, edited or foreign grant is refused', { skip: !realInputsAvailable() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-'));
  try {
    const committed = JSON.parse(fs.readFileSync(path.join(realRoot, 'phase-3c/canary-manifest.json'), 'utf8'));
    const admit = path.join(realRoot, 'phase-3c/canary-admit.jsonl');
    // The committed manifest ages out by design; the digest covers the batch, not the freshness window.
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ ...committed, freshUntil: new Date(Date.now() + 86_400_000).toISOString() }));

    assert.equal(run(['owner-keygen', path.join(dir, 'k1')]).status, 0);
    assert.equal(run(['owner-keygen', path.join(dir, 'k2')]).status, 0);
    // Windows has no POSIX permission bits: fs.chmod/statSync mode reports the file type only (0o666 for a
    // regular file, so mode & 0o077 is 0o066 = 54), and the "owner-only" guarantee is carried by NTFS ACLs
    // instead. Assert the real invariant per platform rather than a value Windows can never produce.
    if (process.platform === 'win32') {
      assert.ok(fs.statSync(path.join(dir, 'k1/owner-private.pem')).isFile(), 'the private key exists on Windows (ACL-protected, no POSIX bits)');
    } else {
      assert.equal(fs.statSync(path.join(dir, 'k1/owner-private.pem')).mode & 0o077, 0, 'the private key is owner-only');
    }
    assert.notEqual(run(['owner-keygen', path.join(dir, 'k1')]).status, 0, 'a key is never overwritten');

    const sign = (m: string, key: string, out: string) => run(['authorize', '--manifest', m, '--private-key', path.join(dir, key, 'owner-private.pem'), '--owner', 'manuelxose', '--statement', 'Authorised for this exact batch.', '--out', out]);
    const auth = path.join(dir, 'a.json');
    const signed = sign(manifest, 'k1', auth);
    assert.equal(signed.status, 0, signed.stderr);
    const payload = JSON.parse(fs.readFileSync(auth, 'utf8')).payload;
    assert.ok(Date.parse(payload.executeBy) <= Date.parse(JSON.parse(fs.readFileSync(manifest, 'utf8')).freshUntil), 'the signed window is clamped to the evidence freshness');
    assert.equal(payload.batch.ledgerHeadHash, committed.review.ledgerHeadHash);
    const verify = (key: string, m = manifest, a = auth) => run(['verify', '--manifest', m, '--authorization', a, '--public-key', path.join(dir, key, 'owner-public.pem'), '--admit', admit]);
    assert.equal(verify('k1').status, 0, verify('k1').stdout);
    assert.match(verify('k2').stdout, /authorization_signature/, 'another key');
    assert.equal(verify('k2').status, 2);

    const edited = path.join(dir, 'edited.json');
    fs.writeFileSync(edited, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), entities: committed.entities.slice(1) }));
    assert.match(sign(edited, 'k1', path.join(dir, 'b.json')).stderr, /manifest_digest/, 'a manifest edited after the fact cannot be signed');
    assert.match(verify('k1', edited).stdout, /manifest_digest|authorization_for_another_manifest/, 'nor can the old grant be reused for it');

    const stale = path.join(dir, 'stale.json');
    fs.writeFileSync(stale, JSON.stringify({ ...committed, freshUntil: '2026-01-01T00:00:00.000Z' }));
    assert.match(sign(stale, 'k1', path.join(dir, 'c.json')).stderr, /evidence_stale/, 'stale evidence cannot be signed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
