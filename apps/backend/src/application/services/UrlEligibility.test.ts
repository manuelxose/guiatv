import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUrlEligibility, templateShare, type EligibilityInput } from './UrlEligibility';

// 320 distinct tokens per seed, so different seeds share no 4-gram.
const prose = (seed: string, n = 320) => Array.from({ length: n }, (_, k) => `${seed}${k}`).join(' ');
const good = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  path: '/x/a', httpStatus: 200, canonicalPath: '/x/a', robots: 'index, follow',
  title: 'Titulo util y distinto de la pagina A', description: 'Descripcion con valor propio para la pagina A que supera el minimo de setenta caracteres.',
  mainText: prose('a'), intentKey: 'intent-a',
  claims: [{ text: 'dato', source: 'https://fuente.example/a', sourceDate: '2026-11-01' }],
  jsonLd: [{ '@context': 'https://schema.org', '@type': 'Article' }], inboundLinks: 4, entityVerified: true,
  peers: [{ path: '/x/b', intentKey: 'intent-b', mainText: prose('b') }], ...over,
});
const reasons = (o: Partial<EligibilityInput>) => evaluateUrlEligibility(good(o)).reasons;

test('a page meeting every criterion is eligible with a stable evidence hash', () => {
  const v = evaluateUrlEligibility(good());
  assert.deepEqual(v.reasons, []);
  assert.equal(v.eligible, true);
  assert.equal(v.evidenceHash, evaluateUrlEligibility(good()).evidenceHash);
  assert.notEqual(v.evidenceHash, evaluateUrlEligibility(good({ inboundLinks: 9 })).evidenceHash);
});

test('each criterion has its own failing case', () => {
  assert.deepEqual(reasons({ httpStatus: 404 }), ['http-not-200']);
  assert.deepEqual(reasons({ canonicalPath: '/x/other' }), ['canonical-not-self']);
  assert.deepEqual(reasons({ robots: 'noindex, follow' }), ['robots-noindex']);
  assert.deepEqual(reasons({ title: 'corto' }), ['title-length']);
  assert.deepEqual(reasons({ description: 'corta' }), ['description-length']);
  assert.deepEqual(reasons({ mainText: prose('a', 50) }), ['thin-content']);
  assert.deepEqual(reasons({ claims: [{ text: 'x', source: null, sourceDate: '2026-11-01' }] }), ['claim-unsourced']);
  assert.deepEqual(reasons({ claims: [] }), ['claim-unsourced']);
  assert.deepEqual(reasons({ jsonLd: [] }), ['jsonld-invalid']);
  assert.deepEqual(reasons({ jsonLd: [{ '@type': 'Article' }] }), ['jsonld-invalid']);
  assert.deepEqual(reasons({ inboundLinks: 1 }), ['low-internal-links']);
  assert.deepEqual(reasons({ entityVerified: false }), ['entity-unverified']);
});

test('word count alone is not enough: duplicate intent and template-shaped pages fail', () => {
  const peer = { path: '/x/b', intentKey: 'intent-a', mainText: prose('b') };
  assert.deepEqual(reasons({ peers: [peer] }), ['duplicate-intent']);
  const clone = { path: '/x/c', intentKey: 'intent-c', mainText: prose('a') };
  const v = evaluateUrlEligibility(good({ peers: [clone] }));
  assert.deepEqual(v.reasons, ['template-share']);
  assert.ok(v.metrics.templateShare >= 0.3);
  assert.equal(templateShare(prose('a'), [{ mainText: prose('z') }]), 0);
});

test('H1: thin content counts total words and vocabulary variety, not distinct tokens alone', () => {
  const repeated = Array.from({ length: 400 }, (_, k) => `w${k % 90}`).join(' '); // 400 words, 90 distinct (ratio 0.225)
  assert.deepEqual(reasons({ mainText: repeated }), ['thin-content']);
  assert.deepEqual(reasons({ mainText: prose('a', 250) }), ['thin-content']); // all distinct but under 300 words
  const natural = Array.from({ length: 400 }, (_, k) => `w${k % 160}`).join(' '); // 400 words, 160 distinct (0.4)
  assert.ok(!reasons({ mainText: natural }).includes('thin-content'));
  assert.equal(evaluateUrlEligibility(good({ mainText: 'Áéí ÁÉÍ aei '.repeat(2) })).metrics.totalWords, 6);
});

test('H2: evidenceHash changes with every evaluated input and ignores peer order', () => {
  const base = evaluateUrlEligibility(good()).evidenceHash;
  const changed = (o: Partial<EligibilityInput>) => evaluateUrlEligibility(good(o)).evidenceHash !== base;
  assert.ok(changed({ title: 'Otro titulo igual de util para la pagina A' }));
  assert.ok(changed({ description: 'Otra descripcion con valor propio para la pagina A que supera el minimo de setenta caracteres.' }));
  assert.ok(changed({ jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage' }] }));
  assert.ok(changed({ peers: [{ path: '/x/b', intentKey: 'intent-b', mainText: prose('q') }] }));
  assert.ok(changed({ peers: [] }));
  assert.ok(changed({ mainText: prose('a') + ' extra' }));
  const p1 = { path: '/x/b', intentKey: 'intent-b', mainText: prose('b') }, p2 = { path: '/x/c', intentKey: 'intent-c', mainText: prose('c') };
  assert.equal(evaluateUrlEligibility(good({ peers: [p1, p2] })).evidenceHash, evaluateUrlEligibility(good({ peers: [p2, p1] })).evidenceHash);
});

test('H2: evidenceHash ignores JSON key order and does not collide on separators inside peer fields', () => {
  const ld = (o: object) => evaluateUrlEligibility(good({ jsonLd: [o] })).evidenceHash;
  assert.equal(ld({ '@context': 'https://schema.org', '@type': 'WebPage', a: { x: 1, y: 2 } }), ld({ a: { y: 2, x: 1 }, '@type': 'WebPage', '@context': 'https://schema.org' }));
  const peer = (path: string, intentKey: string) => evaluateUrlEligibility(good({ peers: [{ path, intentKey, mainText: prose('b') }] })).evidenceHash;
  assert.notEqual(peer('/x/b|k', 'c'), peer('/x/b', 'k|c'));
});
