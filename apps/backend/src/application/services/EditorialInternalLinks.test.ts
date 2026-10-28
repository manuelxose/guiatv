/** M11-F: internal links come only from the runner's verified list, a few at most, fixed before the critic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEditorialJob } from './EditorialAgentPipeline';
import { DEFAULT_EDITORIAL_LIMITS } from './EditorialEvidence';
import { deps, draft, LONG, pass, research, scripted, topic } from './EditorialAgentPipeline.fixtures';

const limits = { ...DEFAULT_EDITORIAL_LIMITS, maxResearchCalls: 1, maxReviewLoops: 1 };
const linked = (paths: string[]) => LONG.replace('Ficha en [GuíaTV](/programas/el-padrino)', paths.map((p, i) => `[página ${'abcde'[i]}](${p})`).join(', '));
const live = new Set(['/programas/el-padrino', '/canales/la-2', '/guias/a', '/guias/b', '/guias/c', '/guias/d', '/politica-editorial']);
const run = (markdowns: string[], linkTargets?: Array<{ path: string; label: string }>) => {
  const m = scripted({ research: [research], evidence: [{ conflicts: [] }], editorial: markdowns.map((md) => draft(md)), critic: [pass] }, undefined, 'anthropic');
  return { m, job: runEditorialJob({ ...topic, linkTargets }, deps(m.model, { internalLinkStatus: async (p) => (live.has(p) ? 200 : 404) }), limits) };
};

test('without a verified list the M11-E2 behaviour is unchanged', async () => {
  const { job } = run([LONG]);
  const r = await job;
  assert.ok(!r.findings.some((f) => /internal-link/.test(f.code)), JSON.stringify(r.findings));
});

test('a link outside the verified list is fixed by the writer before the critic sees the draft', async () => {
  const { job, m } = run([LONG, linked(['/canales/la-2'])], [{ path: '/canales/la-2', label: 'canal La 2' }]);
  const r = await job;
  assert.equal(r.revisions?.[0].gateFixes, 1);
  assert.match(r.draft?.content ?? '', /href="\/canales\/la-2"/);
  assert.ok(!r.findings.some((f) => /internal-link/.test(f.code)), JSON.stringify(r.findings));
  const prompt = m.calls.find((c) => c.role === 'editorial')!.prompt;
  assert.match(prompt, /Páginas de GuíaTV que puedes enlazar[^\n]*\n- \/canales\/la-2: canal La 2/);
  assert.equal(m.calls.filter((c) => c.role === 'critic').length, 1, 'the critic reviewed only the clean draft');
});

test('more than four internal links is a block the writer must reduce; the policy page does not count', async () => {
  const targets = ['/canales/la-2', '/guias/a', '/guias/b', '/guias/c', '/guias/d'].map((path) => ({ path, label: path }));
  const { job } = run([linked(targets.map((t) => t.path))], targets);
  const r = await job;
  assert.ok(r.findings.some((f) => f.code === 'excessive-internal-links' && /5 enlaces internos; máximo 4/.test(f.message)), JSON.stringify(r.findings.map((f) => f.code)));
  assert.notEqual(r.state, 'approved-by-policy');
});
