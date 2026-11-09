import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREST_HOSTS, fetchCrest } from './football.routes';

const res = (status: number, type: string, bytes = 10) =>
  (async () => new Response(new Uint8Array(bytes), { status, headers: { 'content-type': type } })) as unknown as typeof fetch;
// Unique URLs per run: successful crests are also kept on disk.
const run = `${process.pid}-${Date.now()}`;
const u = (name: string) => `https://test.invalid/${run}/${name}.png`;

test('crest proxy keeps real images, refuses non-images, errors and oversized bodies', async () => {
  assert.ok((await fetchCrest(u('ok'), res(200, 'image/png'))).body);
  assert.equal((await fetchCrest(u('html'), res(200, 'text/html'))).body, null);
  assert.equal((await fetchCrest(u('missing'), res(404, 'image/png'))).body, null);
  assert.equal((await fetchCrest(u('big'), res(200, 'image/png', 600 * 1024))).body, null);
  const failed = await fetchCrest(u('net'), (async () => { throw new Error('net'); }) as unknown as typeof fetch);
  assert.equal(failed.body, null);
  assert.ok(failed.expiresAt > Date.now(), 'a failure is remembered, not re-fetched on every view');
  // Downloaded once: the disk copy answers without touching the provider again.
  const again = await fetchCrest(u('ok'), (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch);
  assert.ok(again.body, 'served from the durable copy');
});

test('crest proxy identifies itself and only allows the observed crest hosts', async () => {
  let ua = '';
  await fetchCrest(u('ua'), (async (_u: string, init: RequestInit) => {
    ua = String((init.headers as Record<string, string>)['User-Agent']);
    return new Response(new Uint8Array(1), { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch);
  assert.match(ua, /^GuiaTV-crest-proxy\//);
  assert.ok(CREST_HOSTS.has('footballdata.io'));
  assert.equal(CREST_HOSTS.has('evil.example'), false);
});

test('Wikimedia originals are fetched as their 120px thumbnail; other hosts and thumbs are left alone', async () => {
  const { wikimediaThumb } = await import('./football.routes');
  assert.equal(
    wikimediaThumb('https://upload.wikimedia.org/wikipedia/de/d/da/Manchester_United_FC.svg?utm_source=x'),
    'https://upload.wikimedia.org/wikipedia/de/thumb/d/da/Manchester_United_FC.svg/120px-Manchester_United_FC.svg.png'
  );
  assert.equal(
    wikimediaThumb('https://upload.wikimedia.org/wikipedia/commons/9/97/FC_Schalke_04_Logo.png'),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/FC_Schalke_04_Logo.png/120px-FC_Schalke_04_Logo.png'
  );
  assert.equal(wikimediaThumb('https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/x.svg/960px-x.svg.png'), null);
  assert.equal(wikimediaThumb('https://footballdata.io/img/team/arsenal-fc.png'), null);
});
