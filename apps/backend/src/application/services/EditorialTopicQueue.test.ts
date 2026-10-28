/** M11-F: autonomous topic discovery, screening, scoring, diversity and queue recovery (no network, no model). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSeeds, pickTopics, proposeTopics, QueuedTopic, recoverQueue, screenProposal, scoreProposal, sourceFamily, TopicProposal, TopicQueueFile,
} from './EditorialTopicQueue';
import { DEFAULT_ROUTES, EditorialModel } from './EditorialAgentPipeline';

const NOW = new Date('2026-10-28T09:00:00Z');
const coverage = [
  { slug: 'horario-proteccion-menores-television-calificacion-por-edades', title: 'Horario de emisión de contenidos para adultos en la televisión en España', categories: ['Televisión'], sourceFamilies: ['boe.es:BOE-A-2022-11311'] },
  { slug: 'limite-anuncios-television-minutos-por-hora-ley', title: 'Publicidad permitida en televisión en España: topes y cortes', categories: ['Televisión'], sourceFamilies: ['boe.es:BOE-A-2022-11311'] },
  { slug: 'subtitulos-audiodescripcion-lengua-de-signos-television-obligaciones', title: 'Subtítulos, audiodescripción y signos: mínimos que exige la ley a cada TV', categories: ['Televisión'], sourceFamilies: ['boe.es:BOE-A-2022-11311'] },
];
const proposal = (over: Partial<TopicProposal> = {}): TopicProposal => ({
  slug: 'como-resintonizar-canales-tdt-television', title: 'Cómo resintonizar los canales de la TDT paso a paso',
  topic: 'Resintonización de la televisión digital terrestre cuando cambian las frecuencias', intent: 'cómo volver a sintonizar los canales de la TDT en el televisor',
  category: 'Tecnología', volatility: 'stable', seedUrls: ['https://www.rtve.es/television/tdt/', 'https://www.cnmc.es/ambitos-de-actuacion/audiovisual'], readerNeed: 4, whyDistinct: 'nadie lo cubre', ...over,
});
const ctx = (queue: QueuedTopic[] = []) => ({ now: NOW, coverage, queue });
const queued = (id: string, over: Partial<QueuedTopic> = {}): QueuedTopic => ({
  id, title: id.replace(/-/g, ' '), intent: `intención de ${id}`, category: 'Streaming', sourceCandidates: [], sourceFamilies: [], score: 50, scoreExplanation: [],
  freshUntil: null, duplicateCheck: { maxSimilarity: 0, closest: null }, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), state: 'queued', attempts: 0,
  topic: { slug: id, topic: id, intent: id, volatility: 'stable', categories: ['Streaming'], internalSources: [], seedUrls: ['https://www.boe.es/a', 'https://www.cnmc.es/b'] }, ...over,
});

test('a valid, new, primary-sourced topic is eligible and gets an explained score', async () => {
  const p = proposal();
  assert.deepEqual(screenProposal(p, ctx()), []);
  const page = `${'Texto oficial sobre la TDT. '.repeat(40)} resintonizar los canales del televisor tras el cambio de frecuencias de la televisión digital`;
  const seeds = await checkSeeds(p, async () => ({ status: 200, text: page }));
  assert.equal(seeds[0].ok, true);
  const { score, explanation } = scoreProposal(p, { ...ctx(), seeds, linkTargets: 2, publishedCategories: ['Televisión', 'Televisión', 'Televisión'] });
  assert.ok(score >= 70, `score ${score}`);
  assert.equal(explanation.length, 7);
  assert.match(explanation.join('\n'), /evidencia 30: 2\/2 semillas verificadas, 2 editor/);
  assert.match(explanation.join('\n'), /diversidad 10: 0 guías publicadas en Tecnología/);
});

test('duplicate intent, taken slug and invalid candidates are rejected with their reason', () => {
  const dup = screenProposal(proposal({ slug: 'horario-adultos-television-espana', title: 'Horario de emisión de contenidos para adultos en la televisión', intent: 'a qué hora se emiten contenidos para adultos en la televisión en España' }), ctx());
  assert.ok(dup.some((r) => r.startsWith('duplicate: misma intención que horario-proteccion-menores')), dup.join(' | '));
  assert.ok(screenProposal(proposal({ slug: coverage[0].slug }), ctx()).includes('duplicate: slug ya usado'));
  const invalid = screenProposal(proposal({ slug: 'Mal Slug', title: 'corto', category: 'Cocina', volatility: 'nope' as never, seedUrls: [] }), ctx());
  for (const r of ['invalid-candidate: slug', 'invalid-candidate: título', 'invalid-candidate: categoría Cocina', 'invalid-candidate: volatilidad', 'insufficient-evidence: 1-4 fuentes semilla']) {
    assert.ok(invalid.includes(r), r);
  }
  // A recently rejected candidate is remembered, so discovery cannot resubmit it under a new slug.
  const rejected = queued('ver-canales-tdt-sin-antena', { state: 'rejected', title: 'Cómo resintonizar los canales de la TDT paso a paso', intent: 'cómo volver a sintonizar los canales de la TDT en el televisor' });
  assert.ok(screenProposal(proposal(), ctx([rejected])).some((r) => r.startsWith('duplicate')));
});

test('one law cannot back every topic, and one category cannot fill the queue', () => {
  const law = 'https://www.boe.es/buscar/act.php?id=BOE-A-2022-11311#:~:text=Art%C3%ADculo%20120';
  assert.equal(sourceFamily(law), 'boe.es:BOE-A-2022-11311');
  assert.equal(sourceFamily('https://www.boe.es/buscar/act.php?id=BOE-A-1998-1234'), 'boe.es:BOE-A-1998-1234', 'another law is another family');
  const reasons = screenProposal(proposal({ slug: 'patrocinio-television-reglas-ley', title: 'Patrocinio en televisión: qué reglas debe cumplir', intent: 'qué dice la ley sobre el patrocinio de programas', category: 'Televisión', seedUrls: [law] }), ctx());
  assert.ok(reasons.includes('source-concentration: boe.es:BOE-A-2022-11311 ya respalda 3 temas'), reasons.join(' | '));
  const full = ['a-b-c', 'd-e-f', 'g-h-i'].map((id) => queued(id, { category: 'Tecnología' }));
  assert.ok(screenProposal(proposal(), ctx(full)).includes('category-concentration: ya hay 3 temas de Tecnología en cola'));
});

test('low-value and expired opportunities never enter the queue', () => {
  assert.ok(screenProposal(proposal({ volatility: 'tv-schedule' }), ctx()).includes('low-value: vida útil inferior a una semana'));
  assert.ok(screenProposal(proposal({ freshUntil: '2026-10-29' }), ctx()).includes('expired: la oportunidad caduca en menos de 3 días'));
  assert.ok(screenProposal(proposal({ seedUrls: ['https://www.elpais.com/television/tdt'] }), ctx()).includes('source-reliability: www.elpais.com no es fuente primaria'));
});

test('missing source and insufficient evidence: a seed must exist, be readable and be about the topic', async () => {
  const p = proposal({ seedUrls: ['https://www.rtve.es/no-existe', 'https://www.atresplayer.com/directo', 'https://www.rtve.es/otra-cosa'] });
  const pages: Record<string, { status: number; text: string }> = {
    'https://www.rtve.es/no-existe': { status: 404, text: 'not found' },
    'https://www.atresplayer.com/directo': { status: 200, text: '<div id="app"></div>' },
    'https://www.rtve.es/otra-cosa': { status: 200, text: 'Noticias de deportes y del tiempo. '.repeat(60) },
  };
  const seeds = await checkSeeds(p, async (url) => pages[url]);
  assert.deepEqual(seeds.map((s) => s.ok), [false, false, false]);
  assert.deepEqual(seeds.map((s) => s.note.split(' ')[0]), ['HTTP', 'página', '0/6']);
  const outage = await checkSeeds(proposal(), async () => { throw new Error('ECONNRESET'); });
  assert.deepEqual([outage[0].ok, outage[0].status], [false, 0]);
});

test('discovery: the model only proposes; a provider outage throws to the cycle, a bad answer yields nothing', async () => {
  const answer = (json: unknown): EditorialModel => ({ provider: 'anthropic', webSearch: true, call: async () => ({ json, usage: { input_tokens: 1000, output_tokens: 500 } }) });
  const ok = await proposeTopics([answer({ candidates: [proposal()] })], DEFAULT_ROUTES, { now: NOW, coverage, queue: [], siteInventory: '- Canales: La 1' });
  assert.equal(ok.proposals.length, 1);
  assert.ok(ok.cost.usd > 0, 'the discovery call is priced and journaled');
  assert.equal((await proposeTopics([answer({ nope: 1 })], DEFAULT_ROUTES, { now: NOW, coverage, queue: [], siteInventory: '' })).proposals.length, 0);
  const down: EditorialModel = { provider: 'anthropic', call: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:20128'); } };
  await assert.rejects(proposeTopics([down], DEFAULT_ROUTES, { now: NOW, coverage, queue: [], siteInventory: '' }), /ECONNREFUSED/);
  await assert.rejects(proposeTopics([], DEFAULT_ROUTES, { now: NOW, coverage, queue: [], siteInventory: '' }), /ninguna ruta/);
});

test('picking: best score first, one per category per cycle, a per-day category cap, empty queue = nothing', () => {
  const file: TopicQueueFile = { version: 1, topics: [
    queued('streaming-a', { score: 90 }), queued('streaming-b', { score: 80 }), queued('cine-a', { score: 70, category: 'Cine' }),
    queued('futbol-a', { score: 60, category: 'Fútbol' }), queued('held-a', { score: 99, state: 'held' }),
  ] };
  assert.deepEqual(pickTopics(file, 3, []).map((t) => t.id), ['streaming-a', 'cine-a', 'futbol-a']);
  const today = [queued('x', { category: 'Streaming' }), queued('y', { category: 'Streaming' })];
  assert.deepEqual(pickTopics(file, 1, today).map((t) => t.id), ['cine-a'], 'two Streaming topics already started today');
  assert.deepEqual(pickTopics({ version: 1, topics: [] }, 3, []), []);
});

test('restart recovery: an interrupted topic goes back once, then is held; past deadlines expire', () => {
  const file: TopicQueueFile = { version: 1, topics: [
    queued('crashed-once', { state: 'running' }), queued('crashed-twice', { state: 'running', attempts: 1 }),
    queued('stale', { freshUntil: '2026-10-28T12:00:00Z' }), queued('fine', { freshUntil: '2026-12-01' }),
  ] };
  const notes = recoverQueue(file, NOW);
  assert.deepEqual(file.topics.map((t) => t.state), ['queued', 'held', 'expired', 'queued']);
  assert.equal(file.topics[0].attempts, 1);
  assert.equal(notes.length, 3);
});

test('one publisher cannot pass the value gate: rejected at screening and dropped from the queue (canary finding)', () => {
  const law = (id: string) => `https://www.boe.es/buscar/act.php?id=${id}`;
  assert.ok(screenProposal(proposal({ seedUrls: [law('BOE-A-1995-25444'), law('BOE-A-1996-8930')] }), ctx())
    .includes('insufficient-evidence: una sola entidad editora entre las fuentes semilla (hacen falta dos)'));
  const single = queued('solo-boe', { topic: { ...queued('solo-boe').topic, seedUrls: [law('BOE-A-1995-25444'), law('BOE-A-1996-8930')] } });
  const withData = queued('con-datos', { topic: { ...queued('con-datos').topic, seedUrls: [law('BOE-A-1995-25444')], internalSources: [{ id: 'g1', url: 'https://guiaprogramaciontv.com/v2/x' }] } });
  const file: TopicQueueFile = { version: 1, topics: [single, withData] };
  recoverQueue(file, NOW);
  assert.deepEqual(file.topics.map((t) => t.state), ['rejected', 'queued'], 'GuíaTV data also satisfies the value gate');
});
