import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminEditorialService, EditorialOverview, EditorialPolicyStatus } from '../../../../services/admin-editorial.service';
import { AdminEditorialSectionComponent, policyStateText } from './admin-editorial-section.component';

const BASE: EditorialPolicyStatus = {
  envEnabled: true, paused: false, activated: true, activatedAt: null, activatedBy: 'ana@guiatv.es', active: true,
  pausedAt: null, pausedBy: null, pausedReason: null, dailyLimit: 3, dailyLimitBy: null,
  dailyLimitRange: { recommended: 3, min: 1, max: 10 }, approvalsLast24h: 0, signingKeyConfigured: true, liveProviders: [],
};
const routes = { research: [], evidence: [], editorial: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }], seo: [], critic: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }] } as any;
const overview = {
  policy: BASE, limits: { budget: 'capped', maxArticleUsd: 1, maxDailyUsd: 5, maxDailyArticles: 3 },
  today: { generated: 0, published: 0, ready: 0, held: 0, rejected: 0, revisions: 0, models: {}, reasons: {} },
  routes, imageRoutes: [], spend: { todayUsd: 0, last30dUsd: 0 }, jobs: [], posts: [],
  generation: { enabled: true, scheduleHours: 3, topicsPerCycle: 1, categories: ['Streaming'], contentTypes: ['guide'], defaultLength: 'medium', sourceDomains: ['boe.es'], routes },
  runner: { online: false, lastSeenAt: null, version: null, capabilities: { providers: [], webSearch: false } },
  lastCycle: null, nextRunAt: null, queue: [], queueSummary: { manualPending: 0, discovered: 0, running: 0 },
  searchConsole: {
    enabled: true, windowDays: 28, baseline: { days: 3, complete: false },
    lastRun: { status: 'ok', message: null, startedAt: '2026-10-28T06:00:00Z', inspected: 2, skipped: 0 },
    guides: [
      { slug: 'guia-a', title: 'A', url: 'https://guiaprogramaciontv.com/guias/guia-a', inspection: { inspectedAt: null, verdict: 'PASS', coverageState: 'Submitted and indexed', indexed: true, lastCrawlTime: null, googleCanonical: 'x', canonicalMatch: true, error: null }, performance: { clicks: 3, impressions: 50, ctr: 0.06, position: 6, days: 3, baselineComplete: false, preliminary: true } },
      { slug: 'guia-b', title: 'B', url: 'https://guiaprogramaciontv.com/guias/guia-b', inspection: { inspectedAt: null, verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed', indexed: false, lastCrawlTime: null, googleCanonical: null, canonicalMatch: null, error: null }, performance: null },
    ],
  },
} as unknown as EditorialOverview;

describe('policyStateText', () => {
  it('distinguishes active, unactivated, disabled and paused publication', () => {
    expect(policyStateText(BASE)).toContain('Publicación automática activa');
    expect(policyStateText({ ...BASE, activated: false, active: false })).toContain('pendiente de activación humana');
    expect(policyStateText({ ...BASE, envEnabled: false })).toContain('desactivada por la configuración');
    expect(policyStateText({ ...BASE, paused: true, pausedBy: 'Ana', pausedReason: 'fuentes caídas' })).toBe('Publicación pausada por Ana: fuentes caídas');
  });
});

describe('Operaciones IA', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: { getOverview: () => of(overview) } }] }));

  it('keeps generation, publication and runner states separate', () => {
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Generación programada');
    expect(text).toContain('Publicación automática');
    expect(text).toContain('Sin señal');
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]').length).toBe(4);
  });

  it('separates Google indexing and performance without zero-filling', () => {
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.desktop-table tbody tr')).slice(-2).map((r: any) => (r.textContent || '').replace(/\s+/g, ' '));
    expect(rows[0]).toContain('Indexada');
    expect(rows[0]).toContain('3/28');
    expect(rows[1]).toContain('Discovered - currently not indexed');
    expect(rows[1]).toContain('Sin datos de Google');
  });

  it('uses accessible tabs with arrow-key navigation', () => {
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.tabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(component.activeTab).toBe('queue');
    expect(fixture.nativeElement.querySelector('#editorial-tab-queue').getAttribute('aria-selected')).toBe('true');
  });
});
