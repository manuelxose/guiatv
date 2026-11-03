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
