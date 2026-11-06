import { of } from 'rxjs';
import { AdminJobLedgerComponent } from './admin-job-ledger.component';
import { EditorialLedgerJob } from '../../../../../services/admin-editorial.service';

const job = (over: Partial<EditorialLedgerJob> = {}): EditorialLedgerJob => ({
  jobId: 'job-1', slug: 'guia-de-prueba', kind: 'article', state: 'running', currentStage: 'article-drafting', attempt: 1, maxAttempts: 3,
  worker: { id: 'w', host: 'vmi', pid: 1 }, lease: { token: 't', generation: 1, acquiredAt: '2026-11-05T18:00:00Z', expiresAt: '2026-11-05T18:02:00Z', heartbeatAt: '2026-11-05T18:00:00Z' },
  createdAt: '2026-11-05T18:00:00Z', updatedAt: '2026-11-05T18:00:00Z', startedAt: '2026-11-05T18:00:00Z', endedAt: null,
  articleDeadlineAt: '2026-11-05T19:00:00Z', lastProgressAt: '2026-11-05T18:00:00Z', progress: null,
  cancelRequested: false, pauseRequested: false, archivedAt: null, error: null,
  usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }, stages: [], checkpoints: [],
  publication: null, revision: 1, deadlines: { stageMs: 600000, articleMs: 3600000 }, ...over,
});

const routeMock = () => ({
  snapshot: { queryParamMap: { get: () => null } },
  queryParamMap: of({ get: () => null }),
});
const routerMock = () => ({ navigate: () => Promise.resolve(true) });

describe('AdminJobLedgerComponent', () => {
  let component: AdminJobLedgerComponent;

  beforeEach(() => {
    component = new AdminJobLedgerComponent({} as never, routeMock() as never, routerMock() as never);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-11-05T18:00:30Z'));
  });
  afterEach(() => jasmine.clock().uninstall());

  it('offers only actions the current state supports', () => {
    expect(component.can('pause', job())).toBeTrue();
    expect(component.can('cancel', job())).toBeTrue();
    expect(component.can('retry', job())).toBeFalse();
    expect(component.can('archive', job({ state: 'completed' }))).toBeTrue();
    expect(component.can('delete', job({ state: 'completed' }))).toBeTrue();
    expect(component.can('delete', job({ state: 'completed', archivedAt: '2026-11-05T18:00:00Z' }))).toBeTrue();
    expect(component.can('delete', job({ state: 'blocked', publication: { key: 'k', state: 'published', url: null, at: '2026-11-05T18:00:00Z' } }))).toBeFalse();
  });

  it('shows a live lease in seconds and an expired one explicitly', () => {
    expect(component.leaseText(job())).toBe('90s');
    expect(component.leaseText(job({ lease: { token: 't', generation: 1, acquiredAt: '', expiresAt: '2026-11-05T17:00:00Z', heartbeatAt: '' } }))).toBe('Expirado');
    expect(component.leaseText(job({ lease: null }))).toBe('-');
  });

  it('escape closes the topmost layer without trapping focus', () => {
    component.pending = { action: 'cancel', ids: ['job-1'], title: 'Cancelar', needsReason: true };
    component.onEscape();
    expect(component.pending).toBeNull();
    component.detail = job();
    component.detailOpen = true;
    component.onEscape();
    expect(component.detailOpen).toBeFalse();
  });

  it('sorts the loaded page client-side without mutating the source order', () => {
    component.page.items = [
      job({ jobId: 'job-b', slug: 'b-guia', state: 'failed', attempt: 2, updatedAt: '2026-11-05T18:01:00Z' }),
      job({ jobId: 'job-a', slug: 'a-guia', state: 'running', attempt: 1, updatedAt: '2026-11-05T18:00:00Z' }),
    ];
    component.sortKey = 'slug';
    component.sortDir = 'asc';
    expect(component.sortedItems.map((item) => item.slug)).toEqual(['a-guia', 'b-guia']);
    component.toggleSort('slug');
    expect(component.sortDir).toBe('desc');
    expect(component.sortedItems[0].slug).toBe('b-guia');
  });

  it('refuses select-all when more results than the safe bulk cap', () => {
    component.page.total = 51;
    component.selectAllMatching();
    expect(component.error).toContain('50');
  });
});
