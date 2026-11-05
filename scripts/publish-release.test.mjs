import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';

test('a release includes and runs the editorial runner from the same checkout', async () => {
  const root = mkdtempSync(resolve('.guiatv-release-test-'));
  const server = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('[]'));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const put = (path, value) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(resolve('scripts/publish-release.mjs'), join(root, 'scripts/publish-release.mjs'));
    const runner = readFileSync(resolve('scripts/editorial-agents.mjs'));
    put('scripts/editorial-agents.mjs', runner);
    put('docs/seo/editorial-drafts/publish.json', readFileSync(resolve('docs/seo/editorial-drafts/publish.json')));
    mkdirSync(join(root, 'apps/backend'), { recursive: true });
    cpSync(resolve('apps/backend/dist'), join(root, 'apps/backend/dist'), { recursive: true });
    put('apps/frontend/dist/guiatv/browser/index.html', 'frontend');
    for (const file of ['ssr-server.mjs', 'ssr-canonical.mjs', 'ssr-cache.mjs']) put(`apps/frontend/scripts/${file}`, '');
    put('releases/20261104000000/release.json', '{}');
    put('releases/20261104000000/artifacts/m11b/runs/evidence.json', 'previous evidence');
    symlinkSync(join(root, 'releases/20261104000000'), join(root, 'current'), 'junction');

    const published = spawnSync(process.execPath, [join(root, 'scripts/publish-release.mjs'), '20261105000000'], { encoding: 'utf8', env: { ...process.env, GUIATV_RELEASE_KEEP: '1' } });
    assert.equal(published.status, 0, published.stderr);
    assert.equal(readFileSync(join(root, 'releases/20261104000000/artifacts/m11b/runs/evidence.json'), 'utf8'), 'previous evidence');
    assert.deepEqual(readFileSync(join(root, 'current/scripts/editorial-agents.mjs')), runner);
    const cwd = join(root, 'current');
    const entrypoint = spawnSync(process.execPath, ['scripts/editorial-agents.mjs', 'invalid'], { cwd, encoding: 'utf8' });
    assert.equal(entrypoint.status, 2, entrypoint.stderr);
    assert.match(entrypoint.stderr, /usage: editorial-agents/);
    const adapters = spawnSync(process.execPath, ['-e', "for (const name of ['AnthropicEditorialModel', 'OpenAIEditorialModel', 'MockImageModel']) require('./apps/backend/dist/infrastructure/external/' + name + '.js')"], { cwd, encoding: 'utf8' });
    assert.equal(adapters.status, 0, adapters.stderr);
    put('topics.json', '[]');
    put('replay.json', '{}');
    const run = await new Promise((done) => {
      const child = spawn(process.execPath, ['scripts/editorial-agents.mjs', 'run', join(root, 'topics.json'), '--replay', join(root, 'replay.json'), '--site', `http://127.0.0.1:${server.address().port}`], {
        cwd, env: { ...process.env, EDITORIAL_SPEND_DIR: join(root, 'persistent-state'), EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '' },
      });
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('error', (error) => done({ status: null, stderr: error.message }));
      child.on('exit', (status) => done({ status, stderr }));
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(cwd, 'artifacts/m11b/runs/media')));
    const maintenance = spawnSync(process.execPath, ['scripts/editorial-agents.mjs', 'maintain', '--runs', join(root, 'empty-runs')], {
      cwd, encoding: 'utf8', env: { ...process.env, EDITORIAL_REVIEW_KEY: '', AUCTORIO_EDITORIAL_REVIEW_KEY: '' },
    });
    assert.equal(maintenance.status, 0, maintenance.stderr);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(root, { recursive: true, force: true });
  }
});
