/** M11-E2: legal references, the autonomous revision loop, unlimited budget and the publishable-per-day cap. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticVerdict, EDITORIAL_RUBRIC, EditorialModel, EditorialTopic, runEditorialBatch, runEditorialJob } from './EditorialAgentPipeline';
import { DEFAULT_EDITORIAL_LIMITS, EvidenceBundle, evaluateEvidence, hashText, provenanceSignatureValid, spelledNumbers, verifyBundle } from './EditorialEvidence';
import { deps, draft, GOOD, NOW, pass, research, scripted, topic } from './EditorialAgentPipeline.fixtures';

const BOE_URL = 'https://www.boe.es/buscar/act.php?id=BOE-A-2022-11311';
const CNMC_URL = 'https://www.cnmc.es/ambitos-de-actuacion/audiovisual';
// Shaped like the BOE consolidated text: title, an index that repeats the headings, then the articles.
const BOE = 'Ley 13/2022, de 7 de julio, General de Comunicación Audiovisual. Índice Artículo 98. Calificación por edades. Artículo 99. Franjas horarias. '
  + 'TÍTULO VI Artículo 98. Calificación por edades de los contenidos audiovisuales. 1. Los prestadores del servicio de comunicación audiovisual televisivo calificarán por edades los contenidos que emitan. '
  + '2. La calificación se mostrará de forma visible durante toda la emisión del programa. '
  + 'Artículo 99. Franjas de protección reforzada. 1. Conforme a lo previsto en el artículo 98. Se establecen tres franjas horarias de protección reforzada para los menores. '
  + 'Disposición derogatoria única. Queda derogada la Ley 7/2010, de 31 de marzo.';
const CNMC = 'La CNMC vela por el cumplimiento de las obligaciones de protección del menor en los servicios audiovisuales.';
const PAGES: Record<string, string> = { [BOE_URL]: BOE, [CNMC_URL]: CNMC };
const at = '2026-10-26T09:00:00.000Z';

function bundleOf(claims: Array<{ id: string; text: string; quote: string; legalRefs?: string[] }>): EvidenceBundle {
  return {
    topic: 't', intent: 'i', researchQuestions: [], conflicts: [], createdAt: at,
    sources: [{ id: 's1', url: BOE_URL, publisher: 'boe.es', kind: 'official', retrievedAt: at, contentHash: hashText(BOE), httpStatus: 200 }],
    claims: claims.map((c) => ({ id: c.id, text: c.text, volatility: 'stable', legalRefs: c.legalRefs, quotes: [{ sourceId: 's1', quote: c.quote }] })),
  };
}

test('M11-E2 legal references: a provision is located around the quote, never assumed', () => {
  const out = verifyBundle(bundleOf([
    { id: 'ok-apartado', text: 'Las televisiones deben calificar por edades lo que emiten (art. 98.1)', quote: 'calificarán por edades los contenidos que emitan' },
    { id: 'ok-ley', text: 'Según la Ley 13/2022, la calificación debe verse toda la emisión (artículo 98)', quote: 'La calificación se mostrará de forma visible durante toda la emisión' },
    { id: 'wrong-apartado', text: 'Deben calificar por edades (art. 98.2)', quote: 'calificarán por edades los contenidos que emitan' },
    { id: 'wrong-article', text: 'Deben calificar por edades (art. 99)', quote: 'calificarán por edades los contenidos que emitan' },
    { id: 'wrong-law', text: 'La Ley 14/2022 obliga a calificar por edades', quote: 'calificarán por edades los contenidos que emitan' },
    // "artículo 98." inside art. 99 is a lowercase cross-reference, not the heading of art. 98.
    { id: 'cross-reference', text: 'Hay franjas de protección reforzada (art. 98)', quote: 'Se establecen tres franjas horarias de protección reforzada' },
    // "tres" in the quote backs a 3, never a 4.
    { id: 'figure', text: 'Hay 4 franjas de protección reforzada (art. 99)', quote: 'Se establecen tres franjas horarias de protección reforzada' },
    // A model cannot declare a reference located: verifyBundle recomputes it.
    { id: 'forged', text: 'Deben calificar por edades (art. 99)', quote: 'calificarán por edades los contenidos que emitan', legalRefs: ['art. 99'] },
    // Review H1: a figure equal to the reference number is still a figure.
    { id: 'same-number', text: 'Deben calificar 98 contenidos por edades (art. 98)', quote: 'calificarán por edades los contenidos que emitan' },
    // Review H2a: the quote containing the reference's number does not locate it (there is no article 2).
    { id: 'covered-by-quote', text: 'Según el artículo 2, la calificación se mostrará toda la emisión', quote: 'que emitan. 2. La calificación se mostrará de forma visible' },
    // Review H2b: a law the page merely mentions is not the page's own law, so its article cannot be located there.
    { id: 'other-law', text: 'Según el artículo 98 de la Ley 7/2010 hay que calificar por edades', quote: 'calificarán por edades los contenidos que emitan' },
  ]), new Map([['s1', BOE]]));
  const by = Object.fromEntries(out.claims.map((c) => [c.id, c]));
  assert.deepEqual([by['ok-apartado'].status, by['ok-apartado'].legalRefs], ['supported', ['art. 98.1']]);
  assert.deepEqual([by['ok-ley'].status, by['ok-ley'].legalRefs], ['supported', ['ley 13/2022', 'art. 98']]);
  assert.deepEqual([by['same-number'].status, by['same-number'].note], ['unverified', 'cifras sin respaldo en las citas: 98']);
  for (const id of ['wrong-apartado', 'wrong-article', 'wrong-law', 'cross-reference', 'forged', 'covered-by-quote', 'other-law']) {
    assert.equal(by[id].status, 'unverified', id);
    assert.match(by[id].note!, /referencia legal no localizada/, id);
  }
  assert.deepEqual([by.figure.status, by.figure.note, by.figure.legalRefs], ['unverified', 'cifras sin respaldo en las citas: 4', ['art. 99']], 'a real figure still needs its quote');
});

const legalTopic: EditorialTopic = {
  slug: 'calificacion-por-edades-television', topic: 'Calificación por edades en la televisión', intent: 'qué obliga la ley a las televisiones',
  volatility: 'stable', categories: ['Televisión'], internalSources: [], seedUrls: [BOE_URL, CNMC_URL],
};
const legalResearch = {
  researchQuestions: ['¿Qué obliga la ley?'], sources: [],
  claims: [
    { id: 'c1', text: 'Las televisiones deben calificar por edades lo que emiten (art. 98.1)', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'calificarán por edades los contenidos que emitan' }] },
    { id: 'c2', text: 'Según la Ley 13/2022 la calificación debe verse toda la emisión (art. 98.2)', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'La calificación se mostrará de forma visible durante toda la emisión' }] },
    { id: 'c3', text: 'La CNMC vigila la protección del menor en el audiovisual', volatility: 'stable', quotes: [{ sourceId: 's2', quote: 'La CNMC vela por el cumplimiento de las obligaciones de protección del menor' }] },
  ],
};
const LEGAL_MD = [
  '# Calificación por edades en la televisión: qué obliga la ley',
  '',
  'La Ley 13/2022 obliga a las televisiones a calificar por edades lo que emiten, según su artículo 98.1 [[c1,c2]].',
  '',
  '| Obligación | Fuente |',
  '|---|---|',
  `| Calificar por edades (art. 98.1) [[c1]] | [BOE](${BOE_URL}) |`,
  `| Mostrar la calificación toda la emisión (art. 98.2) [[c2]] | [BOE](${BOE_URL}) |`,
  `| Vigilar la protección del menor [[c3]] | [CNMC](${CNMC_URL}) |`,
].join('\n');
const legalDraft = (markdown = LEGAL_MD) => ({
  title: 'Calificación por edades en la televisión: qué obliga la ley', excerpt: 'Qué obliga la ley a las televisiones sobre la calificación por edades.',
  metaTitle: 'Calificación por edades en televisión',
  metaDescription: 'Qué obliga la ley a las televisiones sobre la calificación por edades y quién vigila la protección del menor.', markdown,
  distinctValue: { readerBenefit: 'Pone en una tabla la obligación legal del BOE junto a quién vigila su cumplimiento según la CNMC.', claimIds: ['c1', 'c3'] },
});
const legalDeps = (model: EditorialModel) => deps(model, { fetchSource: async (url) => (PAGES[url] ? { status: 200, text: PAGES[url] } : { status: 404, text: '' }) });

test('M11-E2 regression (M11-E live block): article numbers next to verified BOE quotes no longer demote the claims', async () => {
  const m = scripted({ research: [legalResearch], evidence: [{ conflicts: [] }], editorial: [legalDraft()], critic: [pass] });
  const run = await runEditorialJob(legalTopic, legalDeps(m.model));
  assert.equal(run.state, 'approved-by-policy', JSON.stringify(run.findings));
  assert.deepEqual(run.value, { internalClaims: 0, publishers: 2, tables: 1, claimsUsed: 3 });
  // A reference's numbers are not figures: "98.1" as a quantity next to the reference itself is still refused (review H1).
  const misuse = await runEditorialJob(legalTopic, legalDeps(scripted({ research: [legalResearch], evidence: [{ conflicts: [] }], editorial: [legalDraft(`${LEGAL_MD}\n| Calificar 98.1 programas (art. 98.1) [[c1]] | [BOE](${BOE_URL}) |`)], critic: [pass] }).model), { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 0 });
  assert.ok(misuse.findings.some((f) => f.code === 'figure-not-in-claim' && /: 98\.1 /.test(f.message)), JSON.stringify(misuse.findings));
});

test('M11-G distinct value: stated, proven by cited claims, signed, and required from this pipeline version on', async () => {
  const once = (draftAnswer: unknown) => runEditorialJob(legalTopic, legalDeps(scripted({ research: [legalResearch], evidence: [{ conflicts: [] }], editorial: [draftAnswer], critic: [pass] }).model), { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 0 });
  const { distinctValue: _omit, ...without } = legalDraft();
  const missing = await once(without);
  assert.notEqual(missing.state, 'approved-by-policy');
  assert.ok(missing.findings.some((f) => f.code === 'distinct-value-missing'), JSON.stringify(missing.findings));
  // A benefit "proven" by a claim the text never states, or a generic one-liner, is refused.
  for (const distinctValue of [{ readerBenefit: legalDraft().distinctValue.readerBenefit, claimIds: ['c1', 'c9'] }, { readerBenefit: 'Guía útil y completa.', claimIds: ['c1'] }]) {
    const run = await once({ ...legalDraft(), distinctValue });
    assert.ok(run.findings.some((f) => f.code === 'distinct-value-unsupported'), JSON.stringify(distinctValue));
  }
  // The critic is shown the claimed value and told to test it.
  const m = scripted({ research: [legalResearch], evidence: [{ conflicts: [] }], editorial: [legalDraft()], critic: [pass] });
  const ok = await runEditorialJob(legalTopic, { ...legalDeps(m.model), signingKey: 'k'.repeat(32) });
  assert.equal(ok.state, 'approved-by-policy', JSON.stringify(ok.findings));
  assert.match(m.calls.find((c) => c.role === 'critic')!.prompt, /Valor diferencial que declara el redactor: «Pone en una tabla/);
  assert.deepEqual(ok.provenance!.distinctValue, legalDraft().distinctValue);
  // Signed: rewording the claimed value afterwards breaks the attestation.
  assert.ok(provenanceSignatureValid(ok.provenance!, 'k'.repeat(32)));
  assert.ok(!provenanceSignatureValid({ ...ok.provenance!, distinctValue: { readerBenefit: 'Otro valor inventado después de la revisión del crítico.', claimIds: ['c1'] } }, 'k'.repeat(32)));
  // Provenance from before M11-G (already published guides) is not retroactively blocked.
  const legacy = { ...ok.provenance!, pipelineVersion: 'm11e2-1' };
  delete legacy.distinctValue;
  assert.ok(!evaluateEvidence({ content: ok.draft!.content }, legacy, NOW).some((f) => /^distinct-value/.test(f.code)));
});

test('M11-G: the channel line-up is context, not value, GuíaTV is no second publisher, and a broadcast slot is never stable', async () => {
  const LINEUP = 'https://guiaprogramaciontv.com/v2/editorial/facts?kind=channels&group=tdt&format=text';
  const SLOTS = 'https://guiaprogramaciontv.com/v2/editorial/facts?kind=schedule&channel=la_1&date=2026-10-27&format=text';
  const pages: Record<string, string> = {
    ...PAGES,
    [LINEUP]: 'GuíaTV publica la programación de los canales de la TDT nacional, entre ellos Antena 3, La 1.',
    [SLOTS]: 'La 1 emite «Telediario» el martes, 27 de octubre de 2026 de 15:00 a 15:45 (hora peninsular).',
  };
  const job = (source: string, claim: Record<string, unknown>, line: string) => runEditorialJob(
    { ...legalTopic, internalSources: [{ id: 'g1', url: source }], seedUrls: [BOE_URL] },
    deps(scripted({
      research: [{ researchQuestions: ['?'], sources: [], claims: [
        { id: 'c1', text: 'Las televisiones deben calificar por edades lo que emiten', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'calificarán por edades los contenidos que emitan' }] },
        { id: 'c3', text: 'La calificación debe verse toda la emisión', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'La calificación se mostrará de forma visible durante toda la emisión' }] },
        { id: 'c2', ...claim },
      ] }],
      evidence: [{ conflicts: [] }], critic: [pass],
      editorial: [{ ...legalDraft(['# Calificación por edades en la televisión: qué obliga la ley', '', 'Las televisiones deben calificar por edades lo que emiten [[c1]] y mostrarlo toda la emisión [[c3]].', '', line].join('\n')),
        distinctValue: { readerBenefit: 'Junta la obligación del BOE con la programación de la TDT que publica GuíaTV para el lector.', claimIds: ['c1', 'c2'] } }],
    }).model, { fetchSource: async (url) => (pages[url] ? { status: 200, text: pages[url] } : { status: 404, text: '' }) }),
    { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 0 },
  );
  // One BOE claim plus the line-up: no own value, one publisher (GuíaTV is not a second one).
  const lineup = await job(LINEUP, { text: 'GuíaTV publica la programación de los canales de la TDT nacional', volatility: 'stable', quotes: [{ sourceId: 'g1', quote: 'GuíaTV publica la programación de los canales de la TDT nacional' }] },
    'GuíaTV publica la programación de los canales de la TDT nacional [[c2]].');
  assert.deepEqual([lineup.value?.internalClaims, lineup.value?.publishers], [0, 1]);
  for (const code of ['no-distinct-value', 'distinct-value-unsupported']) assert.ok(lineup.findings.some((f) => f.code === code), `${code}: ${JSON.stringify(lineup.findings)}`);
  assert.notEqual(lineup.state, 'approved-by-policy');
  // A slot from the guide counts as GuíaTV data, but stated as a stable fact it is refused.
  const slot = await job(SLOTS, { text: 'La 1 emite Telediario el 27 de octubre de 2026 de 15:00 a 15:45', volatility: 'stable', quotes: [{ sourceId: 'g1', quote: 'La 1 emite «Telediario» el martes, 27 de octubre de 2026 de 15:00 a 15:45' }] },
    'La 1 emite el Telediario el 27 de octubre de 2026 de 15:00 a 15:45 [[c2]].');
  assert.equal(slot.value?.internalClaims, 1);
  assert.ok(slot.findings.some((f) => f.code === 'schedule-fact-not-dated'), JSON.stringify(slot.findings));
});

test('M11-E2 revise loop: an unsupported claim sends the job back to research, and the new version is re-verified and re-criticised', async () => {
  const more = {
    researchQuestions: [], sources: [{ id: 'r1', url: 'https://www.rtve.es/play/la-2/', publisher: 'RTVE' }],
    claims: [{ id: 'c1', text: 'La sesión de cine clásico de los martes se llama Días de cine clásico', volatility: 'stable', quotes: [{ sourceId: 'r1', quote: 'en la sesión "Días de cine clásico"' }] }],
  };
  const first = `${GOOD}\n\nTambién está en Netflix [[c5]].`;
  const second = `${GOOD}\n\nLa franja se llama Días de cine clásico [[r2-c1]].`;
  const revise = { verdict: 'revise', issues: [{ claimId: 'c5', severity: 'high', message: 'c5 no está verificada' }] };
  const m = scripted({ research: [research, more], evidence: [{ conflicts: [] }], editorial: [draft(first), draft(second)], critic: [revise, pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'approved-by-policy', JSON.stringify(run.findings));
  assert.deepEqual(run.revisions!.map((r) => [r.verdict, r.action, r.blocking]), [['revise', 're-research', ['unsupported-claim']], ['pass', 'pass', []]]);
  const researchCalls = m.calls.filter((c) => c.role === 'research');
  assert.equal(researchCalls.length, 2);
  assert.match(researchCalls[1].prompt, /unsupported-claim[\s\S]*c5: c5 no está verificada[\s\S]*c5: Netflix tiene El Padrino → ninguna cita/);
  assert.equal(run.provenance!.bundle.claims.find((c) => c.id === 'r2-c1')!.status, 'supported');
  assert.match(m.calls.filter((c) => c.role === 'editorial')[1].prompt, /r2-c1/, 'the writer gets the new claim');
  // No inherited PASS: the critic verdict is bound to the final draft and evidence, not to the first version.
  assert.equal(run.provenance!.critic!.draftHash, hashText(second));
  assert.equal(run.provenance!.critic!.bundleHash, run.provenance!.bundleHash);
  assert.notEqual(run.revisions![0].draftHash, run.provenance!.draftHash);
  assert.deepEqual(evaluateEvidence({ content: run.draft!.content, author: { name: run.draft!.authorName }, excerpt: run.draft!.excerpt, seo: { metaTitle: run.draft!.metaTitle, metaDescription: run.draft!.metaDescription } }, run.provenance!, NOW), []);
  // The critic never sees its previous findings or the writer's instructions: each round is an independent review.
  for (const c of m.calls.filter((x) => x.role === 'critic')) assert.doesNotMatch(c.prompt, /c5 no está verificada|Reglas: markdown/);
});

test('M11-E2 retry policy: research is retried a bounded number of times, then only rewrites, then the job is held', async () => {
  const revise = { verdict: 'revise', issues: [{ claimId: 'c5', severity: 'high', message: 'sigue sin respaldo' }] };
  const drafts = [1, 2, 3, 4, 5].map((n) => draft(`${GOOD}\n\nVersión ${'abcde'[n - 1]}: también está en Netflix [[c5]].`));
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: drafts, critic: [revise] });
  const run = await runEditorialJob(topic, deps(m.model), { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 4 });
  assert.equal(run.state, 'blocked');
  assert.match(run.reason!, /agotados los ciclos de revisión \(4\)/);
  assert.deepEqual(run.revisions!.map((r) => r.action), ['re-research', 're-research', 'rewrite', 'rewrite', 'rewrite']);
  assert.equal(m.calls.filter((c) => c.role === 'research').length, DEFAULT_EDITORIAL_LIMITS.maxResearchCalls);
  assert.equal(m.calls.filter((c) => c.role === 'critic').length, 5);
  // A definitive critic block is not retried: that version and its provenance are kept as they are.
  const blocked = await runEditorialJob(topic, deps(scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [{ verdict: 'block', issues: [{ severity: 'high', message: 'sin valor' }] }] }).model));
  assert.deepEqual([blocked.state, blocked.revisions!.map((r) => r.action), blocked.provenance!.critic!.verdict], ['blocked', ['block'], 'block']);
});

test('M11-E2 SEO repair: a passed text held only by a figure in its excerpt gets new metadata, not a new draft (live run 1)', async () => {
  const bad = { ...draft(), excerpt: 'El Padrino en La 2 para mayores de 18 años y otras 40 películas de la semana.' };
  const fixed = { excerpt: 'Cuándo emite La 2 El Padrino esta semana y por qué verla en abierto.', metaTitle: draft().metaTitle, metaDescription: draft().metaDescription };
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [bad], seo: [fixed], critic: [pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'approved-by-policy', JSON.stringify(run.findings));
  assert.equal(run.draft!.excerpt, fixed.excerpt);
  assert.deepEqual(run.revisions!.map((r) => [r.verdict, r.action, r.repaired, r.blocking]), [['pass', 'pass', 'metadata', []]]);
  assert.equal(m.calls.filter((c) => c.role === 'editorial').length, 1, 'the reviewed text was not rewritten');
  assert.equal(run.provenance!.critic!.draftHash, run.provenance!.draftHash, 'so the critic verdict still binds it');
  // A repair that still states an unsupported figure leaves the job to the normal loop: the gate decides, not the agent.
  const stubborn = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [bad], seo: [{ ...fixed, excerpt: bad.excerpt }], critic: [pass] });
  const held = await runEditorialJob(topic, deps(stubborn.model), { ...DEFAULT_EDITORIAL_LIMITS, maxReviewLoops: 0 });
  assert.equal(held.state, 'blocked');
  assert.ok(held.findings.some((f) => f.code === 'metadata-figure-not-in-claims'));
});

test('M11-E2b rubric: writer and critic share one standard, and the verdict follows the severities the critic reports', async () => {
  // Severities only tighten (review H-C): a model 'revise' is never turned into a pass.
  assert.equal(criticVerdict({ verdict: 'revise', issues: [{ severity: 'low', message: 'c3 no está respaldada' }] }), 'revise');
  assert.equal(criticVerdict({ verdict: 'revise', issues: [] }), 'revise');
  assert.equal(criticVerdict({ verdict: 'pass', issues: [{ severity: 'medium', message: 'inferencia' }] }), 'revise', 'a medium issue is never waved through');
  assert.equal(criticVerdict({ verdict: 'pass', issues: [{ severity: 'low', message: 'orden' }] }), 'pass');
  assert.equal(criticVerdict({ verdict: 'block', issues: [] }), 'block');
  const misgraded = { verdict: 'pass', issues: [{ severity: 'high', message: 'la hora no está en c1' }] };
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(), draft(`${GOOD}\n\nUna versión distinta.`)], critic: [misgraded, pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.equal(run.state, 'approved-by-policy');
  assert.deepEqual(run.revisions!.map((r) => r.verdict), ['revise', 'pass'], 'the high issue held the first version although the model said pass');
  assert.deepEqual([run.provenance!.critic!.verdict, run.provenance!.critic!.modelVerdict], ['pass', 'pass']);
  const [writer] = m.calls.filter((c) => c.role === 'editorial');
  const [critic] = m.calls.filter((c) => c.role === 'critic');
  assert.ok(writer.system.includes(EDITORIAL_RUBRIC) && critic.system.includes(EDITORIAL_RUBRIC), 'the same rubric on both sides');
  assert.match(writer.prompt, /Reglas que comprueba un programa[\s\S]*dieciocho/);
  // The critic never sees a draft the gates would block: it reviewed the fixed version.
  const sloppy = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft(`${GOOD}\n\nTambién la emitió Antena 3 en 2019.`), draft()], critic: [pass] });
  await runEditorialJob(topic, deps(sloppy.model));
  assert.doesNotMatch(sloppy.calls.find((c) => c.role === 'critic')!.prompt, /2019/);
});

test('M11-E2b spelled figures (live run 4): a law writes "ciento cuarenta y cuatro minutos"; the claim may say 144, nothing else', () => {
  assert.deepEqual(spelledNumbers('a) Máximo de ciento cuarenta y cuatro minutos entre las 6:00 y las 18:00 horas.'), ['144']);
  assert.deepEqual(spelledNumbers('setenta y dos minutos; dos mil veintidós; el veinte por ciento; una vez; treinta y los demás'), ['72', '2022', '20', '30']);
  // Review H-A: separate numbers stay separate; "un/una" counts only inside a number.
  for (const [text, expected] of [
    ['entre dos y tres horas', ['2', '3']], ['los apartados dos y tres', ['2', '3']], ['tres, cuatro y cinco', ['3', '4', '5']],
    ['tiene dos. Tres canales más', ['2', '3']], ['treinta y un días', ['31']], ['ciento un canales', ['101']],
    ['dos mil tres mil', ['2003', '1000']], ['mil y una noches', ['1001']], ['un canal y una cadena', []], ['veinte treinta', ['20', '30']],
  ] as const) assert.deepEqual(spelledNumbers(text), expected, text);
  const ads = 'Ley 13/2022, de 7 de julio. Artículo 137. Límite cuantitativo. 1. Podrán emitir con estos límites: a) Máximo de ciento cuarenta y cuatro minutos entre las 6:00 y las 18:00 horas. '
    + 'Artículo 142. Servicios a petición. 1. Conforme al artículo 7 de la Ley 7/2010 los prestadores deberán informar. 2. Tienen derecho a emitir comunicaciones comerciales, salvo lo previsto en el artículo 137.';
  const b: EvidenceBundle = { ...bundleOf([]), sources: [{ ...bundleOf([]).sources[0], contentHash: hashText(ads) }], claims: [
    { id: 'spelled', text: 'Como máximo 144 minutos de publicidad entre las 6:00 y las 18:00 (art. 137)', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'Máximo de ciento cuarenta y cuatro minutos entre las 6:00 y las 18:00 horas' }] },
    { id: 'wrong-figure', text: 'Como máximo 145 minutos entre las 6:00 y las 18:00', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'Máximo de ciento cuarenta y cuatro minutos entre las 6:00 y las 18:00 horas' }] },
    // The quote itself names the provision: located, even though it lies in art. 142.
    { id: 'named-in-quote', text: 'A los servicios a petición no se les aplica el artículo 137 (art. 142)', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'salvo lo previsto en el artículo 137' }] },
    // Review H-B: an article the quote names for another law is not that article of the claim's law, and a law the quote
    // merely cites is not the page's law.
    { id: 'other-law-article', text: 'El artículo 7 de la Ley 13/2022 obliga a informar a los prestadores', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'Conforme al artículo 7 de la Ley 7/2010 los prestadores deberán informar' }] },
    { id: 'cited-law', text: 'La Ley 7/2010 obliga a los prestadores a informar', volatility: 'stable', quotes: [{ sourceId: 's1', quote: 'Conforme al artículo 7 de la Ley 7/2010 los prestadores deberán informar' }] },
  ] };
  const by = Object.fromEntries(verifyBundle(b, new Map([['s1', ads]])).claims.map((c) => [c.id, c]));
  assert.equal(by.spelled.status, 'supported', by.spelled.note);
  assert.deepEqual([by['wrong-figure'].status, by['wrong-figure'].note], ['unverified', 'cifras sin respaldo en las citas: 145']);
  assert.deepEqual([by['named-in-quote'].status, by['named-in-quote'].legalRefs], ['supported', ['art. 137', 'art. 142']]);
  for (const id of ['other-law-article', 'cited-law']) assert.equal(by[id].status, 'unverified', id);
});

test('M11-E2b recoverable block (live run 4): a critic block over discarded evidence starts a new candidate; the blocked one is kept', async () => {
  const more = {
    researchQuestions: [], sources: [],
    claims: [{ id: 'c1', text: 'La sesión de cine clásico de los martes se llama Días de cine clásico', volatility: 'stable', quotes: [{ sourceId: 'r1', quote: 'en la sesión "Días de cine clásico"' }] }],
  };
  // No claimId: the critic names the discarded claim in its message, as the live critic did.
  const block = { verdict: 'block', issues: [{ severity: 'high', message: 'Sin c5 descartada el artículo no responde a la intención: verificarla antes de reescribir.' }] };
  const m = scripted({ research: [research, more], evidence: [{ conflicts: [] }], editorial: [draft(), draft(`${GOOD}\n\nLa franja se llama Días de cine clásico [[r2-c1]].`)], critic: [block, pass] });
  const run = await runEditorialJob(topic, deps(m.model, { signingKey: 'k' }));
  assert.equal(run.state, 'approved-by-policy', JSON.stringify(run.findings));
  assert.deepEqual(run.revisions!.map((r) => [r.verdict, r.action]), [['block', 'new-candidate'], ['pass', 'pass']]);
  const [blocked] = run.blockedCandidates!;
  assert.deepEqual([blocked.critic.verdict, blocked.draftHash], ['block', run.revisions![0].draftHash]);
  assert.notEqual(blocked.signature, run.provenance!.signature, 'the blocked signature is never reused');
  assert.equal(m.calls.filter((c) => c.role === 'research').length, 2);
  // The block stays visible: signed into the final provenance, and told to the next critic.
  assert.deepEqual(run.provenance!.blockedCandidates, [{ draftHash: blocked.draftHash, bundleHash: blocked.bundleHash, verdict: 'block' }]);
  assert.match(m.calls.filter((c) => c.role === 'critic')[1].prompt, /candidato anterior[\s\S]*Sin c5 descartada/);
  // Review M-A: a block with any serious non-evidence issue stays final, even if it also names a discarded claim.
  const mixed = { verdict: 'block', issues: [{ severity: 'high', message: 'Riesgo de difamación.' }, { severity: 'high', message: 'Además c5 está descartada.' }] };
  const final = await runEditorialJob(topic, deps(scripted({ research: [research, more], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [mixed] }).model));
  assert.deepEqual([final.state, final.revisions!.map((r) => r.action)], ['blocked', ['block']]);
});

test('M11-E2b metadata are reviewed and signed (review M-B): an excerpt changed after the critic blocks publication', async () => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
  const run = await runEditorialJob(topic, deps(m.model));
  assert.match(m.calls.find((c) => c.role === 'critic')!.prompt, /Resumen: Cuándo emite La 2[\s\S]*metaDescription: /);
  const post = { content: run.draft!.content, author: { name: run.draft!.authorName }, excerpt: run.draft!.excerpt, seo: { metaTitle: run.draft!.metaTitle, metaDescription: run.draft!.metaDescription } };
  assert.deepEqual(evaluateEvidence(post, run.provenance!, NOW), []);
  assert.deepEqual(evaluateEvidence({ ...post, excerpt: 'Gratis y en exclusiva: El Padrino en La 2.' }, run.provenance!, NOW).map((f) => f.code), ['metadata-not-reviewed']);
});

test('M11-E2 failed retrieval: an unreadable page is dropped from the evidence and recorded, instead of blocking every draft', async () => {
  const withDead = { ...research, sources: [...research.sources, { id: 'x9', url: 'https://muerto.example/pagina', publisher: 'Muerto' }] };
  const run = await runEditorialJob(topic, deps(scripted({ research: [withDead], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] }).model));
  assert.equal(run.state, 'approved-by-policy', JSON.stringify(run.findings));
  assert.deepEqual(run.droppedSources, ['https://muerto.example/pagina (HTTP 404)']);
  assert.ok(!run.provenance!.bundle.sources.some((s) => s.id === 'x9'));
});

test('M11-E2 unlimited budget: no USD cap stops the job, the journal stays numeric, and spend is still settled', async () => {
  const rows: Array<[string, string, number]> = [];
  const journal = { reserve: (slug: string, usd: number) => rows.push(['reserve', slug, usd]), settle: (run: { slug: string }, usd: number) => rows.push(['settle', run.slug, usd]) };
  const unlimited = { ...DEFAULT_EDITORIAL_LIMITS, maxArticleUsd: Infinity, maxDailyUsd: Infinity };
  // 200k/40k tokens per call: ~4 USD per article, over the default 3 USD cap.
  const heavy = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] }, { input_tokens: 200_000, output_tokens: 40_000 });
  const cut: EditorialModel = { provider: 'scripted', async call(r) { if (r.role === 'editorial') throw new Error('socket hang up'); return heavy.model.call(r); } };
  const [ok] = await runEditorialBatch([topic], deps(heavy.model), unlimited, 0, 1000, journal);
  const [lost] = await runEditorialBatch([{ ...topic, slug: 'cut' }], deps(cut), unlimited, 0, 1000, journal);
  assert.equal(ok.state, 'approved-by-policy');
  assert.ok(ok.cost.usd > DEFAULT_EDITORIAL_LIMITS.maxArticleUsd);
  assert.equal(lost.cost.unresolved, true);
  assert.deepEqual(rows, [['reserve', topic.slug, 0], ['settle', topic.slug, ok.cost.usd], ['reserve', 'cut', 0], ['settle', 'cut', lost.cost.usd]]);
  assert.ok(rows.every(([, , usd]) => Number.isFinite(usd)));
  // Unlimited money does not mean unlimited attempts.
  const capped = await runEditorialBatch([1, 2, 3].map((n) => ({ ...topic, slug: `a-${n}` })), deps(heavy.model), { ...unlimited, maxDailyAttempts: 2 }, 1);
  assert.deepEqual(capped.map((r) => r.reason ?? r.state), ['approved-by-policy', 'límite diario de 2 intentos', 'límite diario de 2 intentos']);
});

test('M11-E2 daily cap: held attempts do not use publishing slots, and concurrent jobs never exceed the publishable quota', async () => {
  const good = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
  const empty = { researchQuestions: [], sources: [], claims: [] };
  const model: EditorialModel = { provider: 'scripted', async call(r) { return r.role === 'research' && r.prompt.includes('Tema: MALO') ? { json: empty, usage: { input_tokens: 1, output_tokens: 1 } } : good.model.call(r); } };
  const topics = [{ ...topic, slug: 'malo', topic: 'MALO' }, ...[1, 2].map((n) => ({ ...topic, slug: `b-${n}` }))];
  const runs = await runEditorialBatch(topics, deps(model), { ...DEFAULT_EDITORIAL_LIMITS, maxDailyArticles: 1 });
  assert.deepEqual(runs.map((r) => r.reason ?? r.state), ['la investigación no devolvió afirmaciones', 'approved-by-policy', 'límite diario de 1 artículos']);

  const wide = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: [draft()], critic: [pass] });
  const ten = Array.from({ length: 12 }, (_, n) => ({ ...topic, slug: `c-${n}` }));
  const all = await runEditorialBatch(ten, deps(wide.model), { ...DEFAULT_EDITORIAL_LIMITS, maxDailyArticles: 10, maxConcurrentJobs: 4 });
  assert.equal(all.filter((r) => r.state === 'approved-by-policy').length, 10, 'the Admin testing limit of 10');
  assert.equal(all.filter((r) => r.reason === 'límite diario de 10 artículos').length, 2);
  assert.ok(wide.peak() <= 4);
});
