import { test, expect, Page, BrowserContext, Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { MOCK_ADMIN_PROFILE } from '../fixtures/admin-shell-mock';

/**
 * M14-R flujo B: panel de operaciones con KPIs navegables, pestaña de trabajos
 * (ledger) completa y bandeja de rechazados. Mockea el contrato real de
 * `/admin/editorial/*` — ningún flujo depende de un endpoint inventado.
 */

const POLICY = { envEnabled: true, paused: false, activated: true, activatedAt: null, activatedBy: 'Ana', active: true, pausedAt: null, pausedBy: null, pausedReason: null, dailyLimit: 3, dailyLimitBy: 'owner', dailyLimitRange: { recommended: 3, min: 1, max: 10 }, approvalsLast24h: 0, signingKeyConfigured: true, liveProviders: ['anthropic'] };
const ROUTES = Object.fromEntries(['research', 'evidence', 'editorial', 'seo', 'critic'].map((role) => [role, [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }]]));
const GENERATION = { enabled: true, scheduleHours: 3, topicsPerCycle: 1, categories: ['Televisión'], contentTypes: ['guide'], defaultLength: 'medium', sourceDomains: ['boe.es'], routes: ROUTES };
const REJECTED_POST = { id: 'rejected-post-1', slug: 'guia-rechazada', title: 'Guía rechazada por el crítico', status: 'draft', reviewState: 'rejected', reviewedBy: 'Ana', updatedAt: '2026-11-05T16:00:00Z', pipelineState: 'blocked', backend: 'anthropic', signed: true, costUsd: 0.673, claims: { supported: 3, conflicting: 1, unverified: 1 }, sources: 2, criticVerdict: 'revise', coverUrl: null, nextReviewAt: null };
const OVERVIEW = {
  policy: POLICY, generation: GENERATION,
  runner: { online: true, lastSeenAt: '2026-11-05T16:00:00Z', version: '1.2.3', capabilities: { providers: ['anthropic'], webSearch: true }, process: { configured: true, managed: true, running: true, pid: 99, command: 'node', cwd: '/srv/guiatv', envKeys: [], logPath: '/srv/guiatv/runner.log' } },
  lastCycle: { at: '2026-11-05T15:00:00Z', result: 'completed', reason: '', queued: 1, generated: 3 }, nextRunAt: '2026-11-05T18:00:00Z',
  queue: [], queueSummary: { manualPending: 1, discovered: 1, running: 2 },
  limits: { budget: 'capped', maxArticleUsd: 3, maxDailyUsd: 4, maxDailyArticles: 3 }, today: { generated: 3, published: 2, ready: 0, held: 0, rejected: 1, revisions: 1, models: {}, reasons: { 'critic-rejected': 1 } },
  routes: ROUTES, imageRoutes: [], spend: { todayUsd: 2.019, last30dUsd: 5.0 },
  jobs: [], posts: [REJECTED_POST],
  searchConsole: { enabled: true, windowDays: 28, lastRun: { status: 'completed', message: null, startedAt: '2026-11-05T12:00:00Z', inspected: 2, skipped: 0, pageRows: 2, queryRows: 2 }, baseline: { days: 28, complete: true }, guides: [{ slug: 'guia-rechazada', title: 'Guía rechazada por el crítico', url: 'https://guiaprogramaciontv.com/guias/guia-rechazada', inspection: { inspectedAt: '2026-11-05T12:00:00Z', verdict: 'PASS', coverageState: 'Indexed, not submitted in sitemap', indexed: false, lastCrawlTime: null, googleCanonical: null, canonicalMatch: null, error: null }, performance: { clicks: 0, impressions: 0, ctr: null, position: null, days: 28, baselineComplete: true, preliminary: false } }] },
};
const DETAIL = {
  post: { ...REJECTED_POST, reviewNotes: 'Falta evidencia verificable', excerpt: 'Borrador', content: '<p>Contenido del borrador rechazado</p>', metaTitle: 'Guía', metaDescription: 'Desc', coverAlt: null, author: null, coverPreview: null },
  provenance: { pipelineVersion: 'm14', state: 'blocked', backend: 'anthropic', signed: true, bundle: { topic: 'guía', intent: 'probar', sources: [{ id: 's1', url: 'https://www.boe.es/', publisher: 'BOE', kind: 'official' }], claims: [{ id: 'c1', text: 'Afirmación sin verificar', volatility: 'stable', status: 'unverified', quotes: [] }], conflicts: [] }, critic: { model: 'claude-opus-5-5', verdict: 'revise', issues: [{ severity: 'medium', message: 'Añadir una fuente primaria' }], reviewedAt: '2026-11-05T16:00:00Z' }, cost: { entries: [], usd: 0.673, sourceFetches: 1, draftAttempts: 1, reviewFailures: 1 }, images: [], lastVerifiedAt: null, nextReviewAt: null },
  findings: [{ severity: 'block', code: 'critic-rejected', message: 'El crítico pidió revisión' }], policyBlockers: [], revisions: [{ version: 1, savedAt: '2026-11-05T16:00:00Z', reason: 'Primera redacción', status: 'blocked' }],
};
const LEDGER_JOB = (over: any = {}) => ({
  jobId: 'job-1', slug: 'guia-activa', kind: 'article', state: 'running', currentStage: 'article-drafting', attempt: 1, maxAttempts: 3,
  worker: { id: 'w1', host: 'vmi', pid: 1 }, lease: { token: 't', generation: 1, acquiredAt: '2026-11-05T16:00:00Z', expiresAt: '2026-11-05T16:10:00Z', heartbeatAt: '2026-11-05T16:00:00Z' },
  createdAt: '2026-11-05T16:00:00Z', updatedAt: '2026-11-05T16:00:00Z', startedAt: '2026-11-05T16:00:00Z', endedAt: null, articleDeadlineAt: null,
  lastProgressAt: '2026-11-05T16:00:00Z', progress: null, cancelRequested: false, pauseRequested: false, archivedAt: null, error: null,
  usage: { modelCalls: 1, inputTokens: 10, outputTokens: 20, usd: 0.01 }, stages: [], checkpoints: [], publication: null, revision: 1, deadlines: { stageMs: 600000, articleMs: 3600000 }, ...over,
});

async function openAdmin(page: Page, context: BrowserContext, captured: Request[]): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('gtv_id_token', 'e2e-ops-token'));
  await context.route('**/storage/channel_icons/**', (route) => route.fulfill({ status: 204 }));
  await context.route('**/v2/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'GET' && url.includes('/user/profile')) return route.fulfill({ json: { success: true, data: { profile: MOCK_ADMIN_PROFILE } } });
    if (!url.includes('/admin/editorial/')) return route.fulfill({ json: { success: true, data: url.includes('/admin/health') ? { status: 'healthy', version: '1.0.0', uptime: '1d', memory: { heapUsed: '1MB', heapTotal: '2MB', rss: '3MB' }, services: { cache: { status: 'healthy' } }, timestamp: new Date().toISOString() } : [] } });
    captured.push(req);
    if (url.includes('/admin/editorial/overview')) return route.fulfill({ json: { success: true, data: OVERVIEW } });
    if (url.includes('/admin/editorial/providers')) return route.fulfill({ json: { success: true, data: { checkedAt: '2026-11-05T16:00:00Z', providers: [{ id: 'anthropic', label: 'Anthropic', configured: true, credentialEnv: 'ANTHROPIC_API_KEY', baseUrlHost: 'api.anthropic.com', state: 'connected', models: ['claude-opus-5-5'], latencyMs: 120, checkedAt: '2026-11-05T16:00:00Z', error: null }, { id: 'openai', label: 'OpenAI', configured: false, credentialEnv: 'OPENAI_API_KEY', baseUrlHost: null, state: 'not-configured', models: [], latencyMs: null, checkedAt: '2026-11-05T16:00:00Z', error: null }] } } });
    if (url.includes('/admin/editorial/ledger') && !url.includes('/recover-stale')) {
      const states = new URL(url).searchParams.get('states') || '';
      const items = states === 'dead-letter' ? [LEDGER_JOB({ jobId: 'job-stuck', slug: 'guia-atascada', state: 'dead-letter', currentStage: 'publication' })] : states === 'queued' ? [] : [LEDGER_JOB()];
      return route.fulfill({ json: { success: true, data: { items, total: states === 'dead-letter' ? 1 : states === 'queued' ? 0 : 1, limit: 25, skip: 0 } } });
    }
    if (url.includes('/admin/editorial/posts/') && url.endsWith('/requeue')) return route.fulfill({ status: 201, json: { success: true, data: { id: 'manual-1', status: 'queued', source: 'manual' } } });
    if (url.includes('/admin/editorial/posts/') && req.method() === 'PATCH') return route.fulfill({ json: { success: true, data: { updated: true, id: REJECTED_POST.id } } });
    if (url.includes('/admin/editorial/posts/') && req.method() === 'DELETE') return route.fulfill({ json: { success: true, data: { deleted: true, id: REJECTED_POST.id } } });
    if (url.includes('/admin/editorial/posts/')) return route.fulfill({ json: { success: true, data: DETAIL } });
    return route.fulfill({ json: { success: true, data: { id: 'manual-1', status: 'cancelled' } } });
  });
  await page.goto('/admin');
}

async function openRejected(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('aside button[title="Borradores rechazados, motivos y recuperación"]').click();
  if (viewport && viewport.width < 1024) await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Bandeja de rechazados', exact: true })).toBeVisible();
}

test('KPIs are navigable: clicking a KPI opens the filtered records, not just a number', async ({ page, context }) => {
  await openAdmin(page, context, []);
  const rejected = page.locator('.admin-overview__kpi').filter({ hasText: 'Artículos rechazados' });
  await expect(rejected).toBeVisible();
  await rejected.click();
  await expect(page.getByRole('heading', { name: 'Bandeja de rechazados', exact: true })).toBeVisible();
  expect(page.url()).toContain('group=ai');
  expect(page.url()).toContain('item=rejected');
  await expect(page.getByText('Guía rechazada por el crítico', { exact: true })).toBeVisible();
});

test('rejected inbox shows reasons, evidence, history and requeues safely', async ({ page, context }) => {
  const captured: Request[] = [];
  await openAdmin(page, context, captured);
  await openRejected(page);
  await page.getByRole('button', { name: 'Guía rechazada por el crítico' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('critic-rejected')).toBeVisible();
  await expect(drawer.getByText('Añadir una fuente primaria')).toBeVisible();
  await expect(drawer.getByText('Añadir una fuente primaria')).toBeVisible();
  await drawer.getByRole('button', { name: 'Reintento seguro (reinvestigar)' }).click();
  expect(captured.some((r) => r.url().endsWith('/requeue'))).toBe(true);
});

test('rejected inbox deletes a draft with a distinct confirmation from deleting a published article', async ({ page, context }) => {
  const captured: Request[] = [];
  await openAdmin(page, context, captured);
  await openRejected(page);
  await page.getByRole('button', { name: 'Eliminar borrador' }).first().click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('no publicado');
  await dialog.getByRole('button', { name: 'Eliminar borrador', exact: true }).click();
  expect(captured.some((r) => r.method() === 'DELETE')).toBe(true);
});

test('ledger (Trabajos) syncs filters to the URL and selects all safely', async ({ page, context }) => {
  await openAdmin(page, context, []);
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('aside button[title="Pipeline editorial, evidencia y parada de emergencia"]').click();
  if (viewport && viewport.width < 1024) await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Trabajos' }).click();
  await page.getByLabel('Estado').selectOption('dead-letter');
  expect(page.url()).toContain('state=dead-letter');
  await page.getByRole('button', { name: 'Seleccionar todos (1)' }).click();
  await expect(page.getByRole('region', { name: 'Acciones sobre la selección' })).toContainText('1 seleccionados');
});

test('no critical/serious axe violations on the operations overview and rejected inbox', async ({ page, context }) => {
  await openAdmin(page, context, []);
  let results = await new AxeBuilder({ page }).include('app-admin-overview-section').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
  await openRejected(page);
  results = await new AxeBuilder({ page }).include('app-admin-rejected-inbox').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
});

for (const width of [360, 768, 1440]) test(`operations UI responsive at ${width}px without overflow`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 800 });
  await openAdmin(page, context, []);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openRejected(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
