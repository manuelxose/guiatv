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
import { gzipSync } from 'node:zlib';

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
    // MaxMind forced without credentials: refuses to run.
    const missing = await run({ GEOIP_DIR: target, GEOIP_ENV_FILE: '/nonexistent', GEOIP_SOURCE: 'maxmind' });
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /MAXMIND_ACCOUNT_ID missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('geoip-update: without MaxMind credentials uses DB-IP Lite (previous month fallback), verifies the .mmdb, keeps the current file on corruption', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'geoip-dbip-'));
  const target = join(dir, 'GeoIP');
  const mmdb = readFileSync(fixture);
  const now = new Date();
  const month = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const previous = month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
  const serve = (files) => new Promise((resolve) => {
    const seen = [];
    const server = createServer((req, res) => {
      seen.push(req.url);
      const body = files[req.url];
      if (!body) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
  const env = { GEOIP_DIR: target, GEOIP_ENV_FILE: '/nonexistent' };
  try {
    // Only last month's files are published yet.
    const files = {
      [`/free/dbip-city-lite-${previous}.mmdb.gz`]: gzipSync(mmdb),
      [`/free/dbip-asn-lite-${previous}.mmdb.gz`]: gzipSync(mmdb),
    };
    let s = await serve(files);
    try {
      const first = await run({ ...env, DBIP_BASE_URL: s.base });
      assert.equal(first.code, 0, first.stderr);
      assert.match(first.stdout, /dbip-city-lite.mmdb updated/);
      assert.match(first.stdout, /dbip-asn-lite.mmdb updated/);
      assert.match(first.stdout, new RegExp(`DB-IP Lite ${previous}`));
      assert.deepEqual(readFileSync(join(target, 'dbip-city-lite.mmdb')), mmdb);
      assert.ok(s.seen.some((url) => url.includes(month(now))), 'tries the current month first');
      const again = await run({ ...env, DBIP_BASE_URL: s.base });
      assert.match(again.stdout, /dbip-city-lite.mmdb unchanged/);
    } finally { s.server.close(); }
    // A gzip that is not an .mmdb, then a truncated gzip: the installed file stays.
    for (const body of [gzipSync(Buffer.from('<html>not a database</html>')), gzipSync(mmdb).subarray(0, 100)]) {
      s = await serve({ [`/free/dbip-city-lite-${previous}.mmdb.gz`]: body, [`/free/dbip-asn-lite-${previous}.mmdb.gz`]: body });
      try {
        const bad = await run({ ...env, DBIP_BASE_URL: s.base });
        assert.notEqual(bad.code, 0);
        assert.match(bad.stderr, /keeping the current database/);
        assert.deepEqual(readFileSync(join(target, 'dbip-city-lite.mmdb')), mmdb);
      } finally { s.server.close(); }
    }
    // Nothing published: fails without touching anything.
    s = await serve({});
    try {
      const none = await run({ ...env, DBIP_BASE_URL: s.base });
      assert.notEqual(none.code, 0);
      assert.match(none.stderr, /DB-IP city download failed/);
      assert.ok(existsSync(join(target, 'dbip-city-lite.mmdb')));
    } finally { s.server.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
