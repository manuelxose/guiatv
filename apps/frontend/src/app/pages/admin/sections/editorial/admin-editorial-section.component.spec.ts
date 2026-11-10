import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AdminEditorialService, EditorialOverview, EditorialPolicyStatus } from '../../../../services/admin-editorial.service';
import { diffLines, gateDetails, postStage, queueStage } from './editorial-status';
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

describe('stage mapping', () => {
  it('places queue entries and posts in exactly one column, and drops finished history', () => {
    expect(queueStage({ status: 'queued' })).toBe('queued');
    expect(queueStage({ state: 'running' })).toBe('running');
    expect(queueStage({ state: 'held' })).toBe('held');
    expect(queueStage({ state: 'rejected' })).toBeNull();
    expect(postStage({ status: 'publish', pipelineState: 'published' })).toBe('published');
    expect(postStage({ status: 'draft', pipelineState: 'blocked' })).toBe('held');
    expect(postStage({ status: 'draft', pipelineState: 'verified' })).toBe('review');
  });
});

describe('Operaciones IA', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: { getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), submitGuideSitemap: () => of({ submittedAt: new Date().toISOString() }) } }] }));

  it('keeps generation, publication and runner states separate', () => {
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Generación programada');
    expect(text).toContain('Publicación automática');
    expect(text).toContain('Sin señal');
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]').length).toBe(8);
  });

  it('separates Google indexing and performance without zero-filling', () => {
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectTab('search');
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.desktop-table tbody tr')).slice(-2).map((r: any) => (r.textContent || '').replace(/\s+/g, ' '));
    expect(rows[0]).toContain('Indexada');
    expect(rows[0]).toContain('3/28');
    expect(rows[1]).toContain('Discovered - currently not indexed');
    expect(rows[1]).toContain('Sin datos de Google');
    expect(fixture.nativeElement.textContent).toContain('No es una solicitud individual');
    const button = fixture.nativeElement.querySelector('.desktop-table tbody tr button');
    expect(button.textContent).toContain('Solicitar indexación');
    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.notice).toContain('Google ha aceptado el sitemap');
  });

  it('uses accessible tabs with arrow-key navigation', () => {
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.tabKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(component.activeTab).toBe('topics');
    expect(fixture.nativeElement.querySelector('#editorial-tab-topics').getAttribute('aria-selected')).toBe('true');
  });
});

describe('topic control', () => {
  it('sends a human decision to the runner queue and filters by state', () => {
    const calls: unknown[][] = [];
    const withQueue = { ...overview, queue: [
      { id: 'a', title: 'Tema retenido de prueba para la cola', state: 'held', source: 'discovered', score: 40 },
      { id: 'b', title: 'Tema en cola de prueba para la cola', state: 'queued', source: 'discovered', score: 60, pinned: false },
    ], pendingActions: [{ id: 'r1', action: 'reject', topicId: 'a' }] } as unknown as EditorialOverview;
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(withQueue), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), queueAction: (...args: unknown[]) => { calls.push(args); return of({}); },
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    expect(c.topicCount('held')).toBe(1);
    expect(c.pendingFor('a')?.action).toBe('reject');
    c.topicFilter = 'queued';
    expect(c.topics.map((t) => t.id)).toEqual(['b']);
    c.topicAction('b', 'reject', { reason: 'duplicado' });
    expect(calls[0]).toEqual(['b', 'reject', { reason: 'duplicado' }]);
  });
});

describe('review helpers', () => {
  it('does not reopen the editor if it was closed while saving', () => {
    const save = new Subject<{ updated: boolean; id: string }>();
    const detail = { version: 1, post: { id: 'p1', status: 'publish', title: 'Título publicado de veinte caracteres', slug: 's', content: '', excerpt: '', metaTitle: '', metaDescription: '' }, pendingEdit: null, provenance: { bundle: { sources: [], claims: [] } }, findings: [], policyBlockers: [], revisions: [], previous: null } as any;
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), getPost: () => of(detail), updatePost: () => save,
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    fixture.componentInstance.openPost('p1');
    fixture.componentInstance.savePostEdit();
    fixture.componentInstance.closeDetail();
    save.next({ updated: true, id: 'p1' });
    expect(fixture.componentInstance.detailOpen).toBeFalse();
  });

  it('edits a published article as a separate draft and keeps the public article', () => {
    const calls: unknown[][] = [];
    const detail = { version: 3, post: { id: 'p1', status: 'publish', title: 'Título publicado de veinte caracteres', slug: 's', content: '<p>Publicado</p>', excerpt: '', metaTitle: '', metaDescription: '' }, pendingEdit: null, provenance: { state: 'published', bundle: { sources: [], claims: [] } }, findings: [], policyBlockers: [], revisions: [], previous: null } as any;
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), getPost: () => of(detail), updatePost: (...args: unknown[]) => { calls.push(args); return of({ updated: true }); },
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openPost('p1');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Borrador de cambios');
    component.editDraft!.content = '<p>Pendiente</p>';
    component.savePostEdit();
    expect(calls[0][0]).toBe('p1');
    expect((calls[0][1] as { content: string }).content).toBe('<p>Pendiente</p>');
    expect((calls[0][1] as { expectedVersion: number }).expectedVersion).toBe(3);
    expect(component.editNotice).toContain('versión publicada sigue intacta');
  });

  it('diffs HTML by element and marks additions and removals', () => {
    const d = diffLines('<p>uno</p><p>dos</p><p>tres</p>', '<p>uno</p><p>dos cambiado</p><p>tres</p><p>cuatro</p>');
    expect(d.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['<p>dos</p>']);
    expect(d.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['<p>dos cambiado</p>', '<p>cuatro</p>']);
    expect(d.filter((l) => l.kind === 'same').length).toBe(2);
    expect(diffLines('<p>a</p>', '<p>a</p>').every((l) => l.kind === 'same')).toBe(true);
  });

  it('lists the failed checks of a rejected quality gate', () => {
    expect(gateDetails({ error: { error: { details: [{ message: 'acknowledge:x' }, { message: 'sin fuentes' }] } } })).toEqual(['acknowledge:x', 'sin fuentes']);
    expect(gateDetails({})).toEqual([]);
  });

  it('approves with the review key and the acknowledged codes, then clears the key', () => {
    const calls: unknown[][] = [];
    const detail = { post: { id: 'p1', status: 'draft', title: 't', slug: 's', content: '', excerpt: '', metaTitle: '', metaDescription: '' }, provenance: { bundle: { sources: [], claims: [] } }, findings: [{ severity: 'human', code: 'H1', message: 'm' }], policyBlockers: [], revisions: [], previous: null } as any;
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), getPost: () => of(detail), approvePost: (...a: unknown[]) => { calls.push(a); return of({}); },
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.openPost('p1');
    c.reviewer = 'Ana';
    c.reviewKey = 'secreta';
    c.toggleAck('H1');
    c.approve();
    expect(calls[0]).toEqual(['p1', 'secreta', 'Ana', ['H1']]);
    expect(c.reviewKey).toBe('');
  });

  it('M15: publishing from the drawer needs an explicit confirmation naming the public URL', () => {
    const calls: unknown[][] = [];
    const detail = { post: { id: 'p1', status: 'draft', title: 't', slug: 'guia-x', content: '', excerpt: '', metaTitle: '', metaDescription: '' }, provenance: { bundle: { sources: [], claims: [] } }, findings: [], policyBlockers: [{ severity: 'human', code: 'near-duplicate', message: 'parecido a otra guía' }], revisions: [], previous: null } as any;
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), getPost: () => of(detail), approvePost: (...a: unknown[]) => { calls.push(a); return of({}); },
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.openPost('p1');
    c.reviewer = 'Ana';
    c.reviewKey = 'secreta';
    fixture.detectChanges();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('near-duplicate');
    const publish = Array.from(page.querySelectorAll('button')).find((b) => b.textContent?.includes('Aprobar y publicar'))!;
    publish.click();
    fixture.detectChanges();
    expect(calls.length).toBe(0);
    expect(page.textContent).toContain('/guias/guia-x');
    c.confirmReview();
    expect(calls.length).toBe(1);
    expect(c.reviewConfirm).toBeNull();
  });
});

describe('M15 scheduler state', () => {
  const make = (patch: object) => {
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of({ ...overview, runner: { online: true, lastSeenAt: new Date().toISOString(), version: 'm11g-2', capabilities: { providers: [], webSearch: false } }, ...patch }), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }),
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  it('says when generation is on but the OS scheduler does not tick (no automatic cycle will start)', () => {
    const c = make({ scheduler: { active: false, lastTickAt: null, lastAutomaticStartAt: null, tickMinutes: 15 } });
    expect(c.schedulerText).toContain('sin tics');
    expect(c.diagnosis).toContain('planificador del sistema');
  });

  it('shows a ticking scheduler without a false alarm', () => {
    const c = make({ scheduler: { active: true, lastTickAt: new Date().toISOString(), lastAutomaticStartAt: null, tickMinutes: 15 } });
    expect(c.schedulerText).toContain('planificador activo');
    expect(c.diagnosis).toBeNull();
  });
});

describe('runner start contract', () => {
  it('does not announce success when a manual start is refused (started:false)', () => {
    const result = { started: false, reason: 'generation-disabled', mode: 'automatic', enabled: false, configured: true, managed: true, running: false, pid: null, command: null, cwd: null, envKeys: [], logPath: null };
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), runnerProcess: () => of(result),
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.runnerProcessAction('start');
    expect(c.notice).toBe('');
    expect(c.error).toContain('generation-disabled');
    expect(c.error).toContain('en pausa');
  });

  it('confirms a manual start as audited when started:true', () => {
    const result = { started: true, mode: 'manual', configured: true, managed: true, running: true, pid: 1, command: 'node', cwd: '/srv', envKeys: [], logPath: null };
    TestBed.configureTestingModule({ imports: [AdminEditorialSectionComponent], providers: [{ provide: AdminEditorialService, useValue: {
      getOverview: () => of(overview), getProviders: () => of({ checkedAt: new Date().toISOString(), providers: [] }), runnerProcess: () => of(result),
    } }] });
    const fixture = TestBed.createComponent(AdminEditorialSectionComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.runnerProcessAction('start');
    expect(c.notice).toContain('auditoría');
    expect(c.error).toBe('');
  });
});
