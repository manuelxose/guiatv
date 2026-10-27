import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_AUTHOR,
  aiDisclosure,
  changedClaims,
  CostLedger,
  EditorialBudgetExceeded,
  EditorialProvenance,
  EvidenceBundle,
  evaluateEvidence,
  hashBundle,
  hashText,
  measureValue,
  nextReviewAt,
  provenanceSignatureValid,
  signProvenance,
  stripClaimMarkers,
  verifyBundle,
} from './EditorialEvidence';

const NOW = new Date('2026-10-26T12:00:00Z');
const RETRIEVED = '2026-10-26T09:00:00Z';

const OFFICIAL = 'Plan Estándar con anuncios: 6,99 €/mes. Plan Estándar: 13,99 €/mes. Plan Premium: 19,99 €/mes.';
const INTERNAL = '{"title":"El Padrino","channel":"La 2","start":"2026-10-27T22:00:00+01:00"}';
const PRESS_A = 'Según fuentes del sector, Netflix subirá el precio del plan Premium en 2027.';

export function bundleFixture(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    topic: 'Qué ver esta semana',
    intent: 'informational',
    researchQuestions: ['¿Cuánto cuesta Netflix?'],
    createdAt: RETRIEVED,
    conflicts: [],
    sources: [
      { id: 's1', url: 'https://www.netflix.com/es/signup/planform', publisher: 'Netflix', kind: 'official', retrievedAt: RETRIEVED, contentHash: 'h1' },
      { id: 's2', url: 'https://guiaprogramaciontv.com/v2/programs/el-padrino', publisher: 'GuíaTV', kind: 'internal', retrievedAt: RETRIEVED, contentHash: 'h2' },
      { id: 's3', url: 'https://press.example.com/netflix-2027', publisher: 'Example Press', kind: 'press', retrievedAt: RETRIEVED, contentHash: 'h3' },
    ],
    claims: [
      { id: 'c1', text: 'El plan Estándar con anuncios cuesta 6,99 € al mes', volatility: 'pricing', quotes: [{ sourceId: 's1', quote: 'Plan Estándar con anuncios: 6,99 €/mes' }] },
      { id: 'c2', text: 'La 2 emite El Padrino el 27 de octubre a las 22:00', volatility: 'tv-schedule', quotes: [{ sourceId: 's2', quote: '"channel":"La 2","start":"2026-10-27T22:00' }] },
      { id: 'c3', text: 'Netflix subirá el Premium en 2027', volatility: 'pricing', quotes: [{ sourceId: 's3', quote: 'Netflix subirá el precio del plan Premium en 2027' }] },
    ],
    ...over,
  };
}
const snapshots = new Map([['s1', OFFICIAL], ['s2', INTERNAL], ['s3', PRESS_A]]);

const DRAFT = [
  '# Qué ver esta semana',
  '',
  'El martes 27 de octubre, La 2 emite El Padrino a las 22:00 [[c2]]. Si prefieres el streaming, el plan con anuncios de Netflix cuesta 6,99 € al mes [[c1]].',
  '',
  'Consulta la [web de Netflix](https://www.netflix.com/es/signup/planform) antes de suscribirte.',
].join('\n');
const render = (md: string) =>
  `<div class="editorial-body"><p>${stripClaimMarkers(md).replace(/^# .*\n/, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')}</p>` +
  `${aiDisclosure(new Date(RETRIEVED))}</div>`;

function provenanceFor(bundle: EvidenceBundle, draftMarkdown = DRAFT, verdict: 'pass' | 'revise' = 'pass'): EditorialProvenance {
  const bundleHash = hashBundle(bundle);
  const draftHash = hashText(draftMarkdown);
  return {
    pipelineVersion: 'm11b-1', state: 'verified', bundle, bundleHash, draftMarkdown, draftHash,
    critic: { model: 'claude-opus-5-5', verdict, issues: verdict === 'pass' ? [] : [{ severity: 'high', message: 'falta contexto' }], bundleHash, draftHash, reviewedAt: RETRIEVED },
  };
}
const codes = (f: Array<{ code: string; severity: string }>) => f.map((x) => x.code).sort();

test('provenance: a claim is supported only by a verbatim quote found in its retrieved source', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  assert.equal(v.claims.find((c) => c.id === 'c1')!.status, 'supported');
  assert.equal(v.claims.find((c) => c.id === 'c2')!.status, 'supported');
  // One press source is not enough on its own.
  assert.equal(v.claims.find((c) => c.id === 'c3')!.status, 'unverified');
  assert.match(v.claims.find((c) => c.id === 'c3')!.note!, /prensa/);
});

test('provenance: fabricated quotes, unretrieved sources and invented figures are rejected', () => {
  const bundle = bundleFixture({
    sources: [...bundleFixture().sources, { id: 's4', url: 'https://www.hbomax.com/es/es', publisher: 'HBO Max', kind: 'official' }],
    claims: [
      { id: 'q1', text: 'Netflix Premium cuesta 19,99 €', volatility: 'pricing', quotes: [{ sourceId: 's1', quote: 'Plan Premium: 17,99 €/mes' }] },
      { id: 'q2', text: 'HBO Max cuesta 6,99 €', volatility: 'pricing', quotes: [{ sourceId: 's4', quote: 'Básico con anuncios 6,99 €' }] },
      { id: 'q3', text: 'Netflix Premium cuesta 21,99 €', volatility: 'pricing', quotes: [{ sourceId: 's1', quote: 'Plan Premium: 19,99 €/mes' }] },
      { id: 'q4', text: 'Netflix tiene planes', volatility: 'pricing', quotes: [{ sourceId: 's1', quote: '6,99' }] },
      { id: 'q5', text: 'Hay un plan Estándar', volatility: 'pricing', quotes: [{ sourceId: 'nope', quote: 'Plan Estándar: 13,99 €/mes' }] },
    ],
  });
  const v = verifyBundle(bundle, snapshots);
  assert.deepEqual(v.claims.map((c) => c.status), ['unverified', 'unverified', 'unverified', 'unverified', 'unverified']);
  assert.match(v.claims[2].note!, /21,99/);
});

test('provenance: trust comes from the source URL, not from the label an agent gives it', () => {
  const v = verifyBundle(bundleFixture({
    sources: [{ id: 's3', url: 'https://press.example.com/netflix-2027', publisher: 'Netflix', kind: 'official', retrievedAt: RETRIEVED, contentHash: 'h3' }],
    claims: [bundleFixture().claims[2]],
  }), snapshots);
  assert.equal(v.sources[0].kind, 'press');
  assert.equal(v.claims[0].status, 'unverified');
});

test('authorship: an AI-written post signed with a person-like byline blocks', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  const f = evaluateEvidence({ author: { name: 'Laura Martín' }, content: render(DRAFT) }, provenanceFor(v), NOW);
  assert.deepEqual(codes(f), ['human-byline']);
});

test('provenance: two press sources on different domains corroborate; two pages of one domain do not', () => {
  const press = (id: string, url: string) => ({ id, url, publisher: id, kind: 'press' as const, retrievedAt: RETRIEVED, contentHash: id });
  const claim = (ids: string[]) => [{ id: 'c', text: 'Netflix subirá precios en 2027', volatility: 'pricing' as const, quotes: ids.map((sourceId) => ({ sourceId, quote: 'Netflix subirá el precio del plan Premium en 2027' })) }];
  const snaps = new Map([['a', PRESS_A], ['b', PRESS_A], ['c', PRESS_A]]);
  const independent = verifyBundle(bundleFixture({ sources: [press('a', 'https://a.example.com/x'), press('b', 'https://other.org/y')], claims: claim(['a', 'b']) }), snaps);
  assert.equal(independent.claims[0].status, 'supported');
  const same = verifyBundle(bundleFixture({ sources: [press('a', 'https://a.example.com/x'), press('c', 'https://www.example.com/z')], claims: claim(['a', 'c']) }), snaps);
  assert.equal(same.claims[0].status, 'unverified');
});

test('contradictory evidence: a conflict marks every involved claim conflicting and blocks it', () => {
  const v = verifyBundle(bundleFixture({ conflicts: [{ claimIds: ['c1'], note: 'la ayuda de Netflix dice 7,99 €' }] }), snapshots);
  assert.equal(v.claims[0].status, 'conflicting');
  const findings = evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, provenanceFor(v), NOW);
  assert.ok(findings.some((f) => f.code === 'unsupported-claim' && /c1 \(conflicting\)/.test(f.message)));
});

test('publication gate: a cited, verified, reviewed draft passes with no findings', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  assert.deepEqual(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, provenanceFor(v), NOW), []);
  assert.deepEqual(measureValue(DRAFT, v), { internalClaims: 1, publishers: 2, tables: 0, claimsUsed: 2 });
});

test('publication gate: missing evidence, uncited figures and unknown markers block', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  const draft = `${DRAFT}\n\nNetflix subirá el Premium en 2027 [[c3]]. Disney+ cuesta 5,99 €. Otro dato [[c9]].`;
  const f = evaluateEvidence({ author: AI_AUTHOR, content: render(draft) }, provenanceFor(v, draft), NOW);
  assert.deepEqual([...new Set(codes(f))], ['figure-not-in-claim', 'uncited-factual-statement', 'unknown-claim', 'unsupported-claim']);
});

test('publication gate: fabricated sources, experience, placeholders and missing disclosure block', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  const draft = `${DRAFT}\n\nLo hemos probado en casa y funciona. Más en [la fuente](https://invented.example.org/a). [cita pendiente]`;
  const html = render(draft).replace(/<p data-ai-disclosure>.*?<\/p>/, '');
  const f = evaluateEvidence({ author: AI_AUTHOR, content: html }, provenanceFor(v, draft), NOW);
  assert.deepEqual(codes(f), ['fabricated-experience', 'missing-ai-disclosure', 'placeholder-text', 'unsourced-link']);
});

test('publication gate: the critic must have passed this exact draft and bundle', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, provenanceFor(v, DRAFT, 'revise'), NOW)), ['critic-rejected']);
  const stale = { ...provenanceFor(v), critic: { ...provenanceFor(v).critic!, draftHash: 'older' } };
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, stale, NOW)), ['critic-stale']);
  const { critic: _c, ...none } = provenanceFor(v);
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, none, NOW)), ['critic-missing']);
});

test('publication gate: edited HTML, tampered evidence and leaked markers block', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  const p = provenanceFor(v);
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT).replace('6,99', '4,99') }, p, NOW)), ['content-not-reviewed-draft']);
  const tampered = { ...p, bundle: { ...p.bundle, topic: 'otro' } };
  assert.ok(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, tampered, NOW)).includes('evidence-tampered'));
  assert.ok(codes(evaluateEvidence({ author: AI_AUTHOR, content: `${render(DRAFT)}[[c1]]` }, p, NOW)).includes('claim-marker-leak'));
});

test('freshness: stated claims past their volatility cadence block; schedule follows the most volatile', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  assert.equal(nextReviewAt(v, DRAFT)!.toISOString(), '2026-10-27T09:00:00.000Z'); // TV schedule: 1 day
  const pricingOnly = 'Netflix con anuncios cuesta 6,99 € al mes [[c1]], según la [web de Netflix](https://www.netflix.com/es/signup/planform).';
  assert.equal(nextReviewAt(v, pricingOnly)!.toISOString(), '2026-11-25T09:00:00.000Z'); // pricing: 30 days
  const later = new Date('2026-10-28T12:00:00Z');
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(DRAFT) }, provenanceFor(v), later)), ['stale-evidence']);
});

test('maintenance: only stated claims that lost support need a targeted update', () => {
  const before = verifyBundle(bundleFixture(), snapshots);
  const priceChanged = new Map(snapshots).set('s1', OFFICIAL.replace('6,99', '7,99'));
  assert.deepEqual(changedClaims(before, verifyBundle(bundleFixture(), priceChanged), DRAFT), ['c1']);
  assert.deepEqual(changedClaims(before, verifyBundle(bundleFixture(), snapshots), DRAFT), []);
  const gone = new Map(snapshots);
  gone.delete('s3');
  assert.deepEqual(changedClaims(before, verifyBundle(bundleFixture(), gone), DRAFT), [], 'c3 is not stated in the draft');
});

test('original value: no GuíaTV data and no multi-source comparison blocks', () => {
  const v = verifyBundle(bundleFixture(), snapshots);
  const generic = '# Netflix\n\nEl plan con anuncios de Netflix cuesta 6,99 € al mes [[c1]]. Consulta la [web de Netflix](https://www.netflix.com/es/signup/planform).';
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: render(generic) }, provenanceFor(v, generic), NOW)), ['no-distinct-value']);
});

test('cost ledger: prices tokens per model and stops at the article budget', () => {
  const ledger = new CostLedger({ maxArticleUsd: 0.5, maxDailyUsd: 10, maxResearchCalls: 1, maxSourceFetches: 2, maxRetries: 0, maxReviewLoops: 1, maxDailyArticles: 1, maxConcurrentJobs: 1 });
  assert.equal(ledger.charge('research', 'claude-opus-5-5', { input_tokens: 10_000, output_tokens: 5_000 }, 3).usd, 0.17);
  assert.equal(ledger.charge('seo', 'claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 0 }).usd, 0.01);
  assert.throws(() => ledger.charge('critic', 'claude-opus-5-5', { input_tokens: 50_000, output_tokens: 10_000 }), EditorialBudgetExceeded);
  assert.equal(ledger.summary.entries.length, 3, 'the call that crossed the limit is still recorded');
  assert.throws(() => ledger.charge('x', 'gpt-unknown', { input_tokens: 1, output_tokens: 1 }), /sin precio/);
  ledger.count('sourceFetches', 2);
  ledger.count('sourceFetches', 2);
  assert.throws(() => ledger.count('sourceFetches', 2), EditorialBudgetExceeded);
});

// ---- regressions from the independent review (each case passed the first version of the gate) ----
const gate = (draft: string, post: Record<string, unknown> = {}, bundle = verifyBundle(bundleFixture(), snapshots)) =>
  codes(evaluateEvidence({ author: AI_AUTHOR, content: render(draft), ...post }, provenanceFor(bundle, draft), NOW));

test('review H1: appended text or a reshuffled figure in the HTML is not the reviewed draft', () => {
  const p = provenanceFor(verifyBundle(bundleFixture(), snapshots));
  const appended = render(DRAFT).replace('</div>', '<p>Netflix cuesta 1 € desde marzo.</p></div>');
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: appended }, p, NOW)), ['content-not-reviewed-draft']);
  const shuffled = render(DRAFT).replace('6,99', '69,9');
  assert.deepEqual(codes(evaluateEvidence({ author: AI_AUTHOR, content: shuffled }, p, NOW)), ['content-not-reviewed-draft']);
  // Text slipped into the disclosure paragraph makes it a non-standard disclosure.
  const disclosure = render(DRAFT).replace('No contiene pruebas', 'Netflix sube a 9 €. No contiene pruebas');
  assert.ok(codes(evaluateEvidence({ author: AI_AUTHOR, content: disclosure }, p, NOW)).includes('missing-ai-disclosure'));
});

test('review H2: a cited sentence may only state its claims\' figures, or the Madrid time of a quoted UTC instant', () => {
  assert.deepEqual(gate(DRAFT.replace('6,99 € al mes [[c1]]', '2,99 € al mes [[c1]]')), ['figure-not-in-claim']);
  const utc = bundleFixture({
    claims: [...bundleFixture().claims, { id: 'c4', text: 'Vértigo se emite el 28 de octubre de 2026 de 21:30 a 23:40 UTC', volatility: 'tv-schedule', quotes: [{ sourceId: 's2', quote: '"start":"2026-10-28T21:30:00.000Z","end":"2026-10-28T23:40:00.000Z"' }] }],
  });
  const snaps = new Map(snapshots).set('s2', `${INTERNAL}{"start":"2026-10-28T21:30:00.000Z","end":"2026-10-28T23:40:00.000Z"}`);
  const v = verifyBundle(utc, snaps);
  const ok = `${DRAFT}\n\nEl miércoles 28 a las 22:30 hora peninsular, Vértigo hasta las 00:40 [[c4]].`;
  assert.deepEqual(gate(ok, {}, v), []);
  assert.deepEqual(gate(ok.replace('22:30', '20:15'), {}, v), ['figure-not-in-claim']);
});

test('review H3: headings, title, metadata, FAQ and figures in words are checked too', () => {
  assert.deepEqual(gate(`${DRAFT}\n\n## Netflix sube a 25 € en 2027`), ['uncited-factual-statement']);
  assert.deepEqual(gate(DRAFT, { title: 'Netflix a 4,99 € esta semana' }), ['metadata-figure-not-in-claims']);
  assert.deepEqual(gate(DRAFT, { excerpt: 'El plan con anuncios cuesta 6,99 €.' }), []);
  assert.deepEqual(gate(DRAFT, { seo: { metaDescription: 'Desde veinte euros al mes' } }), ['metadata-figure-not-in-claims']);
  assert.deepEqual(gate(DRAFT, { faqItems: [{ question: '¿Precio?', answer: 'Barato' }] }), ['faq-not-evidenced']);
  assert.deepEqual(gate(`${DRAFT}\n\nCuesta veinte euros al mes.`), ['uncited-factual-statement']);
});

test('review H4: links are judged by their parsed hostname, in any attribute form', () => {
  const p = provenanceFor(verifyBundle(bundleFixture(), snapshots));
  for (const link of [
    '<a href="https://evil.example/?guiaprogramaciontv.com">x</a>',
    '<a href="https://guiaprogramaciontv.com.evil.example/">x</a>',
    '<a href=https://evil.example/a>x</a>',
    '<a href="//evil.example/a">x</a>',
    '<img src="https://evil.example/pixel.png">',
  ]) {
    const html = render(DRAFT).replace('</div>', `${link}</div>`);
    assert.ok(codes(evaluateEvidence({ author: AI_AUTHOR, content: html }, p, NOW)).includes('unsourced-link'), link);
  }
  const js = render(DRAFT).replace('</div>', '<a href="javascript:alert(1)">x</a></div>');
  assert.ok(codes(evaluateEvidence({ author: AI_AUTHOR, content: js }, p, NOW)).includes('invalid-link'));
});

test('review H5: a stored bundle cannot declare its own claims supported', () => {
  const real = verifyBundle(bundleFixture(), snapshots);
  const forged = { ...real, claims: real.claims.map((c) => (c.id === 'c3' ? { ...c, status: 'supported' as const } : c)) };
  assert.ok(gate(`${DRAFT}\n\nNetflix subirá el Premium en 2027 [[c3]].`, {}, forged).includes('unsupported-claim'));
});

test('review M4: a quote matches only at digit boundaries', () => {
  const v = verifyBundle(bundleFixture({ claims: [
    { id: 'd1', text: 'Netflix Estándar cuesta 1 €', volatility: 'pricing', quotes: [{ sourceId: 's1', quote: 'Plan Estándar: 1' }] },
    { id: 'd2', text: 'Estándar 3,99', volatility: 'pricing', quotes: [{ sourceId: 's1', quote: '3,99 €/mes. Plan Premium' }] },
  ] }), snapshots);
  assert.deepEqual(v.claims.map((c) => c.status), ['unverified', 'unverified']);
});

test('review L2: user-generated areas and marketplace pages of official domains are press', () => {
  const kind = (url: string) => verifyBundle(bundleFixture({ sources: [{ id: 'x', url, publisher: 'x', kind: 'official' }], claims: [] }), new Map()).sources[0].kind;
  assert.equal(kind('https://discussions.apple.com/thread/1'), 'press');
  assert.equal(kind('https://www.amazon.es/dp/B0TEST'), 'press');
  assert.equal(kind('https://www.amazon.es/gp/video/storefront'), 'official');
});

test('signature: only unmodified provenance signed with the runner key is attested', () => {
  const p = { ...provenanceFor(verifyBundle(bundleFixture(), snapshots)), backend: 'anthropic' };
  const signed = { ...p, signature: signProvenance(p, 'k') };
  assert.equal(provenanceSignatureValid(signed, 'k'), true);
  assert.equal(provenanceSignatureValid(signed, 'other'), false);
  assert.equal(provenanceSignatureValid(signed, undefined), false);
  assert.equal(provenanceSignatureValid({ ...signed, backend: 'replay' }, 'k'), false);
  assert.equal(provenanceSignatureValid({ ...signed, critic: { ...signed.critic!, verdict: 'revise' } }, 'k'), false);
});
