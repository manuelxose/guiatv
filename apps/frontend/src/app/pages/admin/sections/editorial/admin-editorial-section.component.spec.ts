import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminEditorialService, EditorialOverview, EditorialPolicyStatus } from '../../../../services/admin-editorial.service';
import { AdminEditorialSectionComponent, policyStateText } from './admin-editorial-section.component';

const BASE: EditorialPolicyStatus = {
  envEnabled: true,
  paused: false,
  activated: true,
  activatedAt: null,
  activatedBy: 'ana@guiatv.es',
  active: true,
  pausedAt: null,
  pausedBy: null,
  pausedReason: null,
  dailyLimit: 3,
  dailyLimitBy: null,
  dailyLimitRange: { recommended: 3, min: 1, max: 10 },
  approvalsLast24h: 0,
  signingKeyConfigured: true,
  liveProviders: [],
};

describe('policyStateText', () => {
  it('reports active publication', () => {
    expect(policyStateText(BASE)).toBe('Publicación automática: activa (activada por ana@guiatv.es). Sin aprobación humana por artículo.');
  });

  it('reports a switch that is on but not yet activated by an administrator', () => {
    expect(policyStateText({ ...BASE, activated: false, active: false, activatedBy: null })).toBe(
      'Publicación automática: disponible, pendiente de activación por un administrador'
    );
  });

  it('reports env-disabled publication', () => {
    expect(policyStateText({ ...BASE, envEnabled: false, active: false })).toBe(
      'Publicación automática: desactivada (variable de entorno)'
    );
  });

  it('reports who paused, when and why', () => {
    const text = policyStateText({
      ...BASE,
      paused: true,
      active: false,
      pausedBy: 'ana@guiatv.es',
      pausedAt: '2026-10-27T10:00:00.000Z',
      pausedReason: 'fuentes caídas',
    });
    expect(text).toContain('pausada por ana@guiatv.es el ');
    expect(text).toMatch(/: fuentes caídas$/);
  });

  it('mentions the env flag when paused and env is off', () => {
    const text = policyStateText({ ...BASE, envEnabled: false, paused: true, active: false, pausedBy: 'x' });
    expect(text).toBe('Publicación automática: pausada por x (además desactivada por variable de entorno)');
  });
});

describe('Search Console table', () => {
  const overview = {
    policy: BASE,
    limits: { budget: 'capped', maxArticleUsd: 1, maxDailyUsd: 5, maxDailyArticles: 3 },
    today: { generated: 0, published: 0, ready: 0, held: 0, rejected: 0, revisions: 0, models: {}, reasons: {} },
    routes: {}, imageRoutes: [], spend: { todayUsd: 0, last30dUsd: 0 }, jobs: [], posts: [],
    searchConsole: {
      enabled: true, windowDays: 28, baseline: { days: 3, complete: false },
      lastRun: { status: 'ok', message: null, startedAt: '2026-10-28T06:00:00Z', inspected: 2, skipped: 0 },
      guides: [
        {
          slug: 'guia-a', title: 'A', url: 'https://guiaprogramaciontv.com/guias/guia-a',
          inspection: { inspectedAt: null, verdict: 'PASS', coverageState: 'Submitted and indexed', indexed: true, lastCrawlTime: null, googleCanonical: 'x', canonicalMatch: true, error: null },
          performance: { clicks: 3, impressions: 50, ctr: 0.06, position: 6, days: 3, baselineComplete: false, preliminary: true },
        },
        {
          slug: 'guia-b', title: 'B', url: 'https://guiaprogramaciontv.com/guias/guia-b',
          inspection: { inspectedAt: null, verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed', indexed: false, lastCrawlTime: null, googleCanonical: null, canonicalMatch: null, error: null },
          performance: null,
        },
      ],
    },
  } as unknown as EditorialOverview;

  it('separates our publication state, Google indexing and performance without zero-filling', () => {
    TestBed.configureTestingModule({
      imports: [AdminEditorialSectionComponent],
      providers: [{ provide: AdminEditorialService, useValue: { getOverview: () => of(overview) } }],
    });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const section: HTMLElement = fixture.nativeElement.querySelector('[aria-labelledby="editorial-gsc-title"]');
    const rows = Array.from(section.querySelectorAll('tbody tr')).map((r) => (r.textContent || '').replace(/\s+/g, ' '));
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Pública en el CMS');
    expect(rows[0]).toContain('Indexada');
    expect(rows[0]).toContain('Submitted and indexed');
    expect(rows[0]).toContain('Coincide');
    expect(rows[0]).toContain('3/28 (incompleta)');
    expect(rows[1]).toContain('No indexada');
    expect(rows[1]).toContain('Discovered - currently not indexed');
    expect(rows[1]).toContain('Sin datos de Google');
  });
});
