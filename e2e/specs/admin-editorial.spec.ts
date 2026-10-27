import { test, expect, Page, BrowserContext, Request } from '@playwright/test';
import { MOCK_ADMIN_PROFILE } from '../fixtures/admin-shell-mock';

/**
 * M12 entry gate — Admin "Operaciones IA" essential operations. Every `/v2/**`
 * call is intercepted (same convention as admin-shell/admin-affiliate): this
 * suite never touches the shared database or a real review key.
 *
 * Guards: a held draft shows its critic/unverified-claims blockers and never
 * its public cover URL; the emergency stop needs a reason and a confirmation;
 * the review key travels only as a header, is cleared from the form and is
 * never persisted; a refused daily-limit change is surfaced, not swallowed.
 */

const POLICY = {
  envEnabled: false,
  paused: false,
  activated: false,
  activatedAt: null,
  activatedBy: null,
  active: false,
  pausedAt: null,
  pausedBy: null,
  pausedReason: null,
  dailyLimit: 3,
  dailyLimitBy: 'owner',
  dailyLimitRange: { recommended: 3, min: 1, max: 10 },
  approvalsLast24h: 0,
  signingKeyConfigured: true,
  liveProviders: ['anthropic'],
};

const HELD_POST_ID = '6ae0d88eab70f0c81c342315';

const OVERVIEW = {
  policy: POLICY,
  limits: { budget: 'capped', maxArticleUsd: 3, maxDailyUsd: 4, maxDailyArticles: 3 },
  today: { generated: 1, published: 0, ready: 0, held: 0, rejected: 1, revisions: 2, models: {}, reasons: { 'critic-rejected': 1 } },
  routes: { research: [], evidence: [], editorial: [], seo: [], critic: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }] },
  imageRoutes: [],
  spend: { todayUsd: 0.6732, last30dUsd: 1.4756 },
  jobs: [
    {
      jobId: 'job-1', slug: 'cine-en-abierto-tdt-miercoles-28-octubre-2026', state: 'blocked',
      reason: 'agotados los ciclos de revisión', startedAt: '2026-10-27T15:00:00Z', backend: 'anthropic',
      costUsd: 0.673, costEntries: [], blockingCodes: ['critic-rejected'], imageFailure: null,
    },
  ],
  posts: [
    {
      id: HELD_POST_ID, slug: 'cine-en-abierto-tdt-miercoles-28-octubre-2026',
      title: 'Robos o guardaespaldas: tres películas y cómo elegir entre ellas',
      status: 'draft', reviewState: 'unreviewed', reviewedBy: null, updatedAt: '2026-10-27T16:00:00Z',
      pipelineState: 'blocked', backend: 'anthropic', signed: true, costUsd: 0.673,
      claims: { supported: 7, conflicting: 0, unverified: 7 }, sources: 3, criticVerdict: 'revise',
      coverUrl: '/storage/editorial/abc-1600.webp', nextReviewAt: null,
    },
  ],
};

const DETAIL = {
  post: {
    id: HELD_POST_ID, slug: OVERVIEW.posts[0].slug, title: OVERVIEW.posts[0].title,
    status: 'draft', reviewState: 'unreviewed', reviewedBy: null, reviewNotes: null,
    excerpt: 'Tres películas en abierto.', content: '<p>Cuerpo del borrador.</p>',
    metaTitle: 'Robos o guardaespaldas', metaDescription: 'Tres películas.',
    coverUrl: '/storage/editorial/abc-1600.webp', coverAlt: 'Portada de prueba', author: null,
    // 1x1 transparent PNG: the unpublished cover is shown only through the authenticated preview.
    coverPreview: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  },
  provenance: {
    pipelineVersion: 'm11b-1', state: 'blocked', backend: 'anthropic', signed: true,
    bundle: {
      topic: 'cine-en-abierto', intent: 'guide',
      sources: [{ id: 's1', url: 'https://guiaprogramaciontv.com/programas/x', publisher: 'GuíaTV', kind: 'internal' }],
      claims: [
        { id: 'c1', text: 'Ocean’s 13 se emite el miércoles.', volatility: 'high', status: 'supported', quotes: [{ sourceId: 's1', quote: 'miércoles', verified: true }] },
        { id: 'c2', text: 'La protagonista es una heredera consentida.', volatility: 'low', status: 'unverified', quotes: [] },
      ],
      conflicts: [],
    },
    critic: {
      model: 'claude-opus-5-5', verdict: 'revise',
      issues: [{ claimId: 'c2', severity: 'medium', message: 'Presenta como hecho lo que la sinopsis solo sugiere.' }],
      reviewedAt: '2026-10-27T16:00:00Z',
    },
    cost: { entries: [], usd: 0.673, inputTokens: 60343, outputTokens: 21852, sourceFetches: 3, draftAttempts: 3, reviewFailures: 3 },
    images: [],
    lastVerifiedAt: null,
    nextReviewAt: null,
  },
  findings: [
    { severity: 'human', code: 'critic-rejected', message: 'El crítico pidió revisión' },
    { severity: 'human', code: 'unverified-claims', message: '7 afirmaciones sin verificar' },
  ],
  policyBlockers: [
    { severity: 'human', code: 'critic-rejected', message: 'El crítico pidió revisión' },
    { severity: 'human', code: 'unverified-claims', message: '7 afirmaciones sin verificar' },
  ],
  revisions: [],
};

interface Captured {
  requests: Request[];
}

async function mockEditorialBackend(context: BrowserContext, captured: Captured, overview: object = OVERVIEW): Promise<void> {
  await context.route('**/v2/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'GET' && url.includes('/user/profile')) {
      return route.fulfill({ json: { success: true, data: { profile: MOCK_ADMIN_PROFILE } } });
    }
    if (!url.includes('/admin/editorial/')) return route.fulfill({ json: { success: true, data: [] } });
    captured.requests.push(req);
    if (url.endsWith('/admin/editorial/overview')) return route.fulfill({ json: { success: true, data: overview } });
    if (url.endsWith('/policy/resume')) {
      const by = req.headers()['x-editorial-reviewer'];
      return route.fulfill({ json: { success: true, data: { policy: { ...POLICY, envEnabled: true, activated: true, active: true, activatedBy: by, activatedAt: '2026-10-27T18:00:00Z' } } } });
    }
    if (url.includes(`/admin/editorial/posts/${HELD_POST_ID}`)) return route.fulfill({ json: { success: true, data: DETAIL } });
    if (url.endsWith('/policy/pause')) {
      const reason = req.postDataJSON()?.reason;
      return route.fulfill({
        json: { success: true, data: { policy: { ...POLICY, paused: true, pausedBy: 'e2e', pausedAt: '2026-10-27T17:00:00Z', pausedReason: reason } } },
      });
    }
    if (url.endsWith('/policy/daily-limit')) {
      return route.fulfill({ status: 403, json: { success: false, message: 'Clave de revisión no válida' } });
    }
    return route.fulfill({ status: 404, json: { success: false, message: 'not mocked' } });
  });
}

async function openEditorialSection(page: Page, context: BrowserContext, captured: Captured, overview?: object): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('gtv_id_token', 'e2e-mock-editorial-admin-token'));
  await mockEditorialBackend(context, captured, overview);
  await page.goto('/admin');
  await page.locator('aside button[title="Pipeline editorial, evidencia y parada de emergencia"]').click();
  await expect(page.getByRole('heading', { name: 'Política de publicación' })).toBeVisible();
}

test.describe('Admin editorial operations', () => {
  test('a held draft shows its critic and unverified-claims blockers, and only the private cover preview', async ({ page, context }) => {
    const captured: Captured = { requests: [] };
    await openEditorialSection(page, context, captured);

    await expect(page.getByText('Publicación automática: desactivada (variable de entorno)')).toBeVisible();
    await expect(page.getByText('0 / 3')).toBeVisible();

    await page.getByRole('button', { name: OVERVIEW.posts[0].title }).click();
    const detail = page.locator('section[aria-labelledby="editorial-detail-title"]');
    await expect(detail.getByRole('heading', { name: OVERVIEW.posts[0].title })).toBeVisible();
    await expect(detail.getByText('CMS: draft / unreviewed', { exact: false })).toBeVisible();

    const blockers = detail.locator('h4', { hasText: 'Bloqueos de la política' }).locator('xpath=..');
    await expect(blockers.locator('code', { hasText: 'critic-rejected' })).toBeVisible();
    await expect(blockers.locator('code', { hasText: 'unverified-claims' })).toBeVisible();
    await expect(detail.getByText('Revisión humana (2)')).toBeVisible();

    const cover = detail.locator('img[alt="Portada de prueba"]');
    await expect(cover).toHaveAttribute('src', /^data:image\/png;base64,/);
    // No request for the unpublished /storage path ever leaves the page.
    expect(captured.requests.some((r) => r.url().includes('/storage/editorial/'))).toBe(false);
  });

  test('the emergency stop needs a reason and an explicit confirmation', async ({ page, context }) => {
    const captured: Captured = { requests: [] };
    await openEditorialSection(page, context, captured);

    const stop = page.locator('#editorial-pause-reason').locator('xpath=..').getByRole('button', { name: 'Parada de emergencia' });
    await expect(stop).toBeDisabled();
    await page.getByLabel('Motivo de la parada (obligatorio)').fill('prueba e2e');
    await stop.click();
    expect(captured.requests.some((r) => r.url().endsWith('/policy/pause'))).toBe(false);

    await page.getByRole('button', { name: 'Pausar publicación' }).click();
    await expect(page.getByText(/Publicación automática: pausada por e2e .*: prueba e2e/)).toBeVisible();
    const pause = captured.requests.find((r) => r.url().endsWith('/policy/pause'));
    expect(pause?.postDataJSON()).toEqual({ reason: 'prueba e2e' });
    // Resuming now needs the human review key.
    await expect(page.locator('#editorial-resume-key')).toBeVisible();
  });

  test('a refused daily-limit change is shown, the key goes only in a header and is never kept', async ({ page, context }) => {
    const captured: Captured = { requests: [] };
    await openEditorialSection(page, context, captured);

    await page.getByLabel(/Nuevo límite/).fill('5');
    await page.locator('#editorial-limit-reviewer').fill('Revisor E2E');
    await page.locator('#editorial-limit-key').fill('not-the-key');
    await page.getByRole('button', { name: 'Guardar límite' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Clave de revisión no válida' })).toBeVisible();
    const req = captured.requests.find((r) => r.url().endsWith('/policy/daily-limit'));
    expect(req?.postDataJSON()).toEqual({ dailyLimit: 5 });
    expect(req?.headers()['x-editorial-review-key']).toBe('not-the-key');
    expect(req?.headers()['x-editorial-reviewer']).toBe('Revisor E2E');
    expect(req?.postData() || '').not.toContain('not-the-key');

    await expect(page.locator('#editorial-limit-key')).toHaveValue('');
    // Limit unchanged on the page after a refusal.
    await expect(page.getByText('0 / 3')).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('not-the-key');
  });

  test('M11-E2: an available but unactivated mode is activated once with the human key; today and the budget are shown', async ({ page, context }) => {
    const captured: Captured = { requests: [] };
    const overview = {
      ...OVERVIEW,
      policy: { ...POLICY, envEnabled: true, dailyLimit: 10, approvalsLast24h: 2 },
      limits: { budget: 'unlimited', maxArticleUsd: null, maxDailyUsd: null, maxDailyArticles: 10 },
      today: { generated: 4, published: 2, ready: 0, held: 1, rejected: 1, revisions: 5, models: { 'claude-opus-5-5': { calls: 12, inputTokens: 90000, outputTokens: 30000, usd: 0.96 } }, reasons: { 'no-distinct-value': 1 } },
      jobs: [{ ...OVERVIEW.jobs[0], slug: 'guia-publicada', state: 'published', reason: null, blockingCodes: [], revisions: 2, revisionLog: ['revise/re-research', 'pass/pass'], budget: 'unlimited', publicUrl: 'https://guiaprogramaciontv.com/guias/guia-publicada' }],
    };
    await openEditorialSection(page, context, captured, overview);

    await expect(page.getByText('Publicación automática: disponible, pendiente de activación por un administrador')).toBeVisible();
    await expect(page.getByText('2 / 10')).toBeVisible();
    await expect(page.getByText('presupuesto sin tope (modo de prueba)').first()).toBeVisible();
    const today = page.locator('h4', { hasText: 'Hoy (UTC)' }).locator('xpath=..');
    await expect(today.locator('dt', { hasText: 'Generados' }).locator('xpath=../dd')).toHaveText('4');
    await expect(today.locator('dt', { hasText: 'Publicados' }).locator('xpath=../dd')).toHaveText('2');
    await expect(today.getByText('no-distinct-value')).toBeVisible();
    await expect(today.getByText(/claude-opus-5-5: 12 llamadas/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'guia-publicada' })).toHaveAttribute('href', 'https://guiaprogramaciontv.com/guias/guia-publicada');

    await page.locator('#editorial-resume-reviewer').fill('Propietario');
    await page.locator('#editorial-resume-key').fill('human-key');
    await page.getByRole('button', { name: 'Activar publicación automática' }).click();
    await expect(page.getByText(/Publicación automática: activa \(activada por Propietario el .*\)\. Sin aprobación humana por artículo\./)).toBeVisible();
    const req = captured.requests.find((r) => r.url().endsWith('/policy/resume'));
    expect(req?.headers()['x-editorial-review-key']).toBe('human-key');
    await expect(page.locator('#editorial-resume-key')).toHaveCount(0);
  });
});
