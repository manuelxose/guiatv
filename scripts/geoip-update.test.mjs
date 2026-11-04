import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'geoip-update.sh');
const fixture = join(here, '../apps/backend/test-fixtures/geoip/GeoIP2-City-Test.mmdb');

function archive(dir, edition, content) {
  const root = join(dir, `${edition}_20261103`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${edition}.mmdb`), content);
  const out = join(dir, `${edition}.tar.gz`);
  execFileSync('tar', ['-czf', out, '-C', dir, `${edition}_20261103`]);
  return readFileSync(out);
}

async function withServer(files, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const url = new URL(req.url, 'http://x');
    const edition = url.pathname.split('/')[3];
    const body = files[edition]?.[url.searchParams.get('suffix')];
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, seen); } finally { server.close(); }
}

const run = (env) => new Promise((resolve) => execFile('bash', [script], { env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));

test('geoip-update: verified download, atomic replace with .prev, checksum mismatch keeps the current file, key never printed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'geoip-update-'));
  const work = join(dir, 'src');
  mkdirSync(work);
  const target = join(dir, 'GeoIP');
  try {
    const mmdb = readFileSync(fixture);
    const tgz = archive(work, 'GeoLite2-City', mmdb);
    const sha = `${createHash('sha256').update(tgz).digest('hex')}  GeoLite2-City.tar.gz\n`;
    const env = { MAXMIND_ACCOUNT_ID: '12345', MAXMIND_LICENSE_KEY: 'super-secret-key', GEOIP_DIR: target, GEOIP_EDITIONS: 'GeoLite2-City', GEOIP_ENV_FILE: '/nonexistent' };
    await withServer({ 'GeoLite2-City': { 'tar.gz': tgz, 'tar.gz.sha256': sha } }, async (base, seen) => {
      const first = await run({ ...env, MAXMIND_BASE_URL: base });
      assert.equal(first.code, 0, first.stderr);
      assert.match(first.stdout, /GeoLite2-City updated/);
      assert.deepEqual(readFileSync(join(target, 'GeoLite2-City.mmdb')), mmdb);
      assert.ok(seen.every((r) => r.auth === `Basic ${Buffer.from('12345:super-secret-key').toString('base64')}`));
      assert.ok(!(first.stdout + first.stderr).includes('super-secret-key'));
      const second = await run({ ...env, MAXMIND_BASE_URL: base });
      assert.match(second.stdout, /unchanged/);
    });
    // New content but a wrong checksum: the current database must stay.
    const tgz2 = archive(work, 'GeoLite2-City', Buffer.concat([mmdb, Buffer.from('x')]));
    await withServer({ 'GeoLite2-City': { 'tar.gz': tgz2, 'tar.gz.sha256': `${'0'.repeat(64)}  x\n` } }, async (base) => {
      const bad = await run({ ...env, MAXMIND_BASE_URL: base });
      assert.notEqual(bad.code, 0);
      assert.match(bad.stderr, /checksum mismatch/);
      assert.deepEqual(readFileSync(join(target, 'GeoLite2-City.mmdb')), mmdb);
    });
    // Valid new version: replaced, previous kept for rollback.
    const sha2 = `${createHash('sha256').update(tgz2).digest('hex')}  GeoLite2-City.tar.gz\n`;
    await withServer({ 'GeoLite2-City': { 'tar.gz': tgz2, 'tar.gz.sha256': sha2 } }, async (base) => {
      const ok = await run({ ...env, MAXMIND_BASE_URL: base });
      assert.equal(ok.code, 0, ok.stderr);
      assert.ok(existsSync(join(target, 'GeoLite2-City.mmdb.prev')));
      assert.deepEqual(readFileSync(join(target, 'GeoLite2-City.mmdb.prev')), mmdb);
    });
    // Missing credentials: refuses to run.
    const missing = await run({ GEOIP_DIR: target, GEOIP_ENV_FILE: '/nonexistent' });
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /MAXMIND_ACCOUNT_ID missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
