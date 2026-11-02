import { test, expect, Page, BrowserContext, Request } from '@playwright/test';
import { MOCK_ADMIN_PROFILE } from '../fixtures/admin-shell-mock';
import AxeBuilder from '@axe-core/playwright';

const POLICY = { envEnabled: true, paused: false, activated: true, activatedAt: null, activatedBy: 'Ana', active: true, pausedAt: null, pausedBy: null, pausedReason: null, dailyLimit: 3, dailyLimitBy: 'owner', dailyLimitRange: { recommended: 3, min: 1, max: 10 }, approvalsLast24h: 0, signingKeyConfigured: true, liveProviders: ['anthropic', 'openai'] };
const ROUTES = Object.fromEntries(['research', 'evidence', 'editorial', 'seo', 'critic'].map((role) => [role, [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }]]));
const GENERATION = { enabled: true, scheduleHours: 3, topicsPerCycle: 1, categories: ['Televisión', 'Cine', 'Series', 'Streaming', 'Fútbol', 'Deportes', 'Tecnología'], contentTypes: ['guide', 'ranking', 'analysis'], defaultLength: 'medium', sourceDomains: ['boe.es'], routes: ROUTES };
const OVERVIEW = {
  policy: POLICY, generation: GENERATION, runner: { online: false, lastSeenAt: null, version: null, capabilities: { providers: [], webSearch: false } },
  lastCycle: { at: '2026-10-27T15:00:00Z', result: 'no-eligible-topics', reason: 'No hay temas elegibles en la cola', queued: 0, generated: 0 }, nextRunAt: null,
  queue: [], queueSummary: { manualPending: 0, discovered: 0, running: 0 },
  limits: { budget: 'capped', maxArticleUsd: 3, maxDailyUsd: 4, maxDailyArticles: 3 }, today: { generated: 1, published: 0, ready: 0, held: 0, rejected: 1, revisions: 2, models: {}, reasons: {} },
  routes: ROUTES, imageRoutes: [], spend: { todayUsd: .6732, last30dUsd: 1.4756 },
  jobs: [{ jobId: 'job-1', slug: 'guia-bloqueada', state: 'blocked', reason: 'agotados los ciclos de revisión', startedAt: '2026-10-27T15:00:00Z', backend: 'anthropic', costUsd: .673, costEntries: [], blockingCodes: ['critic-rejected'], imageFailure: null }],
  posts: [{ id: '6ae0d88eab70f0c81c342315', slug: 'guia-bloqueada', title: 'Guía de prueba con evidencias verificadas', status: 'draft', reviewState: 'unreviewed', reviewedBy: null, updatedAt: '2026-10-27T16:00:00Z', pipelineState: 'blocked', backend: 'anthropic', signed: true, costUsd: .673, claims: { supported: 7, conflicting: 0, unverified: 1 }, sources: 1, criticVerdict: 'revise', coverUrl: '/storage/editorial/abc.webp', nextReviewAt: null }],
  searchConsole: null,
};
const DETAIL = { post: { ...OVERVIEW.posts[0], reviewNotes: null, excerpt: 'Borrador', content: '<p>Contenido</p>', metaTitle: 'Guía', metaDescription: 'Descripción', coverAlt: 'Portada privada', author: null, coverPreview: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }, provenance: { pipelineVersion: 'm11g', state: 'blocked', backend: 'anthropic', signed: true, bundle: { topic: 'guía', intent: 'probar', sources: [{ id: 's1', url: 'https://www.boe.es/', publisher: 'BOE', kind: 'official' }], claims: [{ id: 'c1', text: 'Afirmación', volatility: 'stable', status: 'unverified', quotes: [] }], conflicts: [] }, critic: { model: 'claude-opus-5-5', verdict: 'revise', issues: [{ severity: 'medium', message: 'Falta evidencia' }], reviewedAt: '2026-10-27T16:00:00Z' }, cost: { entries: [], usd: .673, sourceFetches: 1, draftAttempts: 1, reviewFailures: 1 }, images: [], lastVerifiedAt: null, nextReviewAt: null }, findings: [{ severity: 'human', code: 'critic-rejected', message: 'Revisión' }], policyBlockers: [], revisions: [] };

async function openSection(page: Page, context: BrowserContext, captured: Request[], overview: any = OVERVIEW) {
  await page.addInitScript(() => localStorage.setItem('gtv_id_token', 'e2e-editorial-token'));
  await context.route('**/v2/**', async (route) => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'GET' && url.includes('/user/profile')) return route.fulfill({ json: { success: true, data: { profile: MOCK_ADMIN_PROFILE } } });
    if (!url.includes('/admin/editorial/')) return route.fulfill({ json: { success: true, data: [] } });
    captured.push(req);
    if (url.endsWith('/overview')) return route.fulfill({ json: { success: true, data: overview } });
    if (url.includes('/posts/')) return route.fulfill({ json: { success: true, data: DETAIL } });
    if (url.endsWith('/policy/pause')) return route.fulfill({ json: { success: true, data: { policy: { ...POLICY, active: false, paused: true, pausedBy: 'e2e', pausedReason: req.postDataJSON().reason } } } });
    if (url.endsWith('/policy/resume')) return route.fulfill({ json: { success: true, data: { policy: { ...POLICY, activatedBy: req.headers()['x-editorial-reviewer'] } } } });
    if (url.endsWith('/policy/daily-limit')) return route.fulfill({ status: 403, json: { success: false, message: 'Clave de revisión no válida' } });
    if (url.endsWith('/generation/requests')) return route.fulfill({ status: 201, json: { success: true, data: { id: 'manual-1', source: 'manual', status: 'queued', ...req.postDataJSON() } } });
    if (url.endsWith('/generation/settings')) return route.fulfill({ json: { success: true, data: req.postDataJSON() } });
    if (url.endsWith('/generation/discovery')) return route.fulfill({ status: 201, json: { success: true, data: { id: 'discovery-1', status: 'queued' } } });
    return route.fulfill({ json: { success: true, data: { id: 'manual-1', status: 'cancelled' } } });
  });
  await page.goto('/admin');
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('aside button[title="Pipeline editorial, evidencia y parada de emergencia"]').click();
  if (viewport && viewport.width < 1024) await page.keyboard.press('Escape');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Operaciones IA', exact: true })).toBeVisible();
}

test('separates states, explains inactivity and opens an accessible private detail drawer', async ({ page, context }) => {
  const captured: Request[] = [];
  await openSection(page, context, captured);
  await expect(page.getByText('No hay temas elegibles en la cola', { exact: true })).toBeVisible();
  await expect(page.locator('.status-card').filter({ hasText: 'Runner externo' })).toContainText('Sin señal');
  await page.getByRole('button', { name: OVERVIEW.posts[0].title }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('critic-rejected')).toBeVisible();
  await expect(drawer.locator('img')).toHaveAttribute('src', /^data:image/);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: OVERVIEW.posts[0].title }).first()).toBeFocused();
});

test('passes axe on light and dark themes', async ({ page, context }) => {
  await openSection(page, context, []);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    const accessibility = await new AxeBuilder({ page }).include('app-admin-editorial-section').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter((v) => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
  }
});

test('emergency stop requires reason and confirmation', async ({ page, context }) => {
  const captured: Request[] = [];
  await openSection(page, context, captured);
  const stop = page.getByRole('button', { name: 'Parada de emergencia', exact: true });
  await expect(stop).toBeDisabled();
  await page.getByLabel('Motivo de la parada').fill('prueba e2e');
  await stop.click();
  expect(captured.some((r) => r.url().endsWith('/policy/pause'))).toBe(false);
  await page.getByRole('button', { name: 'Detener automatización' }).click();
  await expect(page.getByRole('status')).toContainText('Generación y publicación detenidas');
  expect(captured.find((r) => r.url().endsWith('/policy/pause'))?.postDataJSON()).toEqual({ reason: 'prueba e2e' });
});

test('queues a configurable manual document and discovers topics without claiming immediate execution', async ({ page, context }) => {
  const captured: Request[] = [];
  await openSection(page, context, captured);
  await page.getByRole('tab', { name: 'Generar' }).click();
  await page.getByLabel('Título orientativo').fill('Guía completa para elegir una plataforma');
  await page.getByLabel('Tema y alcance').fill('Comparación verificada de plataformas disponibles en España');
  await page.getByLabel('Pregunta o intención del lector').fill('Qué plataforma se ajusta mejor a cada necesidad del lector');
  await page.getByLabel('Slug', { exact: true }).fill('elegir-plataforma-streaming-espana');
  await page.getByLabel('Tipo de documento').selectOption('ranking');
  await page.getByLabel('Longitud objetivo').selectOption('long');
  await page.getByLabel('Páginas de ingesta externas (1–4)').fill('https://www.boe.es/');
  await page.getByRole('button', { name: 'Generar en la próxima activación' }).click();
  await expect(page.getByRole('status')).toContainText('cuando el runner despierte');
  const req = captured.find((r) => r.url().endsWith('/generation/requests'));
  expect(req?.postDataJSON()).toMatchObject({ contentType: 'ranking', length: 'long', seedUrls: ['https://www.boe.es/'] });
  await page.getByRole('button', { name: 'Descubrir temas' }).click();
  await expect(page.getByRole('status')).toContainText('próxima activación');
});

test('changes provider configuration and keeps human key only in headers', async ({ page, context }) => {
  const captured: Request[] = [];
  await openSection(page, context, captured);
  await page.getByRole('tab', { name: 'Configuración' }).click();
  await page.getByLabel('Proveedor Redacción ruta 1').selectOption('openai');
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  expect(captured.find((r) => r.url().endsWith('/generation/settings'))?.postDataJSON().routes.editorial[0].provider).toBe('openai');
  await page.getByLabel('Nuevo límite').fill('5');
  await page.locator('#editorial-limit-reviewer').fill('Revisor E2E');
  await page.locator('#editorial-limit-key').fill('not-the-key');
  await page.getByRole('button', { name: 'Guardar límite' }).click();
  const req = captured.find((r) => r.url().endsWith('/policy/daily-limit'));
  expect(req?.headers()['x-editorial-review-key']).toBe('not-the-key');
  expect(req?.postData()).not.toContain('not-the-key');
  await expect(page.locator('#editorial-limit-key')).toHaveValue('');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('not-the-key');
});

for (const width of [360, 390, 768, 1440]) test(`responsive at ${width}px without page overflow`, async ({ page, context }) => {
  const captured: Request[] = [];
  await page.setViewportSize({ width, height: 800 });
  await openSection(page, context, captured);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('tab', { name: 'Actividad' })).toBeVisible();
  if (width < 768) await expect(page.locator('.mobile-list').first()).toBeVisible();
  else await expect(page.locator('.desktop-table').first()).toBeVisible();
});
