import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/New_York', reducedMotion: 'reduce' });

let backend: { origin: string; stop: () => Promise<void> };
let ssr: { origin: string; stop: () => Promise<void> };
const now = Date.now();
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const channel = { id: 'amc', name: 'AMC', normalizedName: 'amc', group: 'cine', type: 'Cine', access: 'pay', distribution: 'operator', aliases: [], sourceIds: ['amc'], subgroups: ['cine'], sortOrder: 1 };
const item = (id: string, title: string, start: number, detailPath?: string) => ({
  id, channel, detailPath,
  program: { brandKey: id, title, normalizedTitle: title.toLowerCase(), titleAliases: [], editorialCategory: 'Otros', description: 'Información verificada de esta emisión.' },
  airing: { id, date: at(start).slice(0, 10).replaceAll('-', ''), start: at(start), end: at(start + 1), durationMinutes: 60, liveNow: start === -0.5, partOfDay: 'tarde', timeSlotKey: '18:00' },
  assets: { fallbackChain: [] }, availability: { live: true, catchup: false, streaming: false },
  sourceProvenance: { schedule: ['epg'], metadata: [], assets: [] },
  timingContext: { start: at(start), end: at(start + 1), liveNow: start === -0.5, window: 'today' }, relevance: { score: 0, reason: 'test' },
});
const previous = item('past', 'Programa terminado', -2);
const current = item('current', 'Programa M07', -0.5, '/programas/m07-program');
const next = item('next', 'Otro programa del canal', 1.5);
const relatedChannel = { ...channel, id: 'tcm', name: 'TCM', normalizedName: 'tcm' };
const relatedCurrent = { ...item('related-current', 'En otro canal', -0.5), channel: relatedChannel };
const surface = { date: current.airing.date, channel, current, next, tonightItems: [], scheduleItems: [next, previous, current], relatedChannels: [{ channel: relatedChannel, current: relatedCurrent, tonight: [], counts: { total: 1, live: 1, tonight: 0 } }], meta: { totalItems: 3, generatedAt: at(0) } };
const programme = {
  catalogId: 'program:m07-program', source: 'program', contentType: 'program', title: 'Programa M07', slug: 'm07-program', detailPath: '/programas/m07-program',
  channel: { id: 'amc', name: 'AMC' }, start: at(-0.5), end: at(0.5),
  synopsis: 'Información verificada de esta emisión.', genres: ['Actualidad'], primaryPlatforms: [],
  airings: [{ channelId: 'amc', channelName: 'AMC', title: 'Programa M07', start: at(-0.5), end: at(0.5) }, { channelId: 'amc', channelName: 'AMC', title: 'Programa M07', start: at(5), end: at(6) }],
  channelAirings: [{ channelId: 'amc', channelName: 'AMC', title: next.program.title, start: at(1.5), end: at(2.5) }],
};
const api: Record<string, unknown> = {
  '/v2/tv/surface/channels/amc': surface,
  '/v2/tv/surface/channels/m07_empty': { ...surface, channel: { ...channel, id: 'm07-empty', name: 'Canal sin emisiones' }, current: undefined, next: undefined, scheduleItems: [], meta: { ...surface.meta, totalItems: 0 } },
  '/v2/tv/surface/channels/m07_missing': { ...surface, channel: null, current: undefined, next: undefined, scheduleItems: [] },
  '/v2/catalog/slug/program/m07-program': programme,
};

test.beforeAll(async () => {
  // @ts-ignore shared ESM harness
  const harness = await import('../../apps/frontend/scripts/entity-ssr-harness.mjs');
  backend = await harness.startBackend({ '/programas/m07-program': { status: 404, code: 'ENTITY_PUBLIC_READ_DISABLED' } }, api);
  ssr = await harness.launchSsr(backend.origin);
});
test.afterAll(async () => { await ssr?.stop(); await backend?.stop(); });
test.beforeEach(async ({ page }) => {
  await page.route(/\/v2\//, route => {
    const path = new URL(route.request().url()).pathname;
    const data = api[path];
    return route.fulfill({ status: data ? 200 : 404, contentType: 'application/json', body: JSON.stringify(data ? { success: true, data } : { success: false, error: { code: 'ENTITY_PUBLIC_READ_DISABLED' } }) });
  });
});

test('M07 channel SSR, canonical, chronological schedule and verified navigation', async ({ page, request }) => {
  const response = await request.get(`${ssr.origin}/canales/amc`);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Programa M07');
  await page.goto(`${ssr.origin}/canales/amc`);
  await expect(page.locator('h1')).toHaveText('AMC');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://guiaprogramaciontv.com/canales/amc');
  const rows = page.locator('.schedule-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(previous.program.title);
  await expect(rows.nth(1)).toContainText(current.program.title);
  await expect(rows.nth(2)).toContainText(next.program.title);
  await expect(rows.nth(0)).toContainText('Finalizado');
  await expect(rows.nth(1)).toContainText('En directo');
  const madridTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(current.airing.start));
  await expect(rows.nth(1)).toContainText(madridTime);
  await expect(rows.nth(2)).toContainText('Próximamente');
  const category = page.getByRole('button', { name: 'Cine', exact: true });
  await category.focus();
  await page.keyboard.press('Enter');
  await expect(category).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpiar filtro', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).locator('a[href="/programas/m07-program"]').first()).toBeVisible();
  await expect(rows.nth(2).locator('a[href*="/programas/"]')).toHaveCount(0);
  await rows.nth(1).locator('a[href="/programas/m07-program"]').first().click();
  await expect(page.locator('h1')).toHaveText('Programa M07');
  await expect(page.getByText(/En emisión ahora · Horario peninsular/)).toBeVisible();
});

test('M07 programme keeps its broadcasts separate and retains programme SEO identity', async ({ page, request }) => {
  const response = await request.get(`${ssr.origin}/programas/m07-program`);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Programa M07');
  await page.goto(`${ssr.origin}/programas/m07-program`);
  await expect(page.locator('h1')).toHaveText('Programa M07');
  await expect(page.locator('app-entity-broadcast-list li')).toHaveCount(2);
  await expect(page.locator('app-entity-broadcast-list')).not.toContainText(next.program.title);
  await expect(page.locator('section[aria-labelledby="channel-programmes-heading"]')).toContainText(next.program.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://guiaprogramaciontv.com/programas/m07-program');
  const schema = await page.locator('script[type="application/ld+json"]').evaluateAll(els => els.flatMap(el => [JSON.parse(el.textContent || '[]')].flat()));
  expect(schema.some(x => ['Movie', 'TVSeries', 'TVEpisode'].includes(x['@type']))).toBe(false);
});

test('M07 empty and unavailable channels are distinct', async ({ page, request }) => {
  await page.goto(`${ssr.origin}/canales/m07-empty`);
  await expect(page.locator('h1')).toHaveText('Canal sin emisiones');
  await expect(page.locator('.schedule-row')).toHaveCount(0);
  await expect(page.getByText('Sin emisiones para esta selección')).toBeVisible();
  const missing = await request.get(`${ssr.origin}/canales/m07-missing`);
  expect(missing.status()).toBe(404);
  await page.goto(`${ssr.origin}/canales/m07-missing`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
});

test('M07 channel and programme responsive WCAG AA matrix', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${ssr.origin}/canales/amc`);
  for (const width of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('guiatv-theme', value), theme);
      for (const [path, scope] of [['/canales/amc', 'app-canal-completo'], ['/programas/m07-program', 'app-catalog-detail']]) {
        await page.goto(`${ssr.origin}${path}`);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        // The theme is applied after hydration and backgrounds transition: axe must read the settled colours.
        await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== 'running'));
        const axe = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => `${n.target}: ${n.failureSummary}`).join(', ')}`)).toEqual([]);
        await page.screenshot({ path: info.outputPath(`m07-${path.split('/')[1]}-${width}-${theme}.png`), fullPage: true });
      }
    }
  }
  expect(errors).toEqual([]);
});
