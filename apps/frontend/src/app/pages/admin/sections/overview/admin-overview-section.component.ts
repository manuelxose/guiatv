import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AdminOperationsService } from '../../../../services/admin-operations.service';
import { AdminSchedulesService, EpgOverview, HealthResponse } from '../../../../services/admin-schedules.service';
import { AdminAIAnalyticsService } from '../../../../services/admin-ai-analytics.service';
import { AdminEditorialService, EditorialOverview, EditorialProviderHealth } from '../../../../services/admin-editorial.service';
import { AdminGroupId, AdminNavTarget } from '../../admin.types';
import { AdminStatusBadgeComponent } from '../../components/admin-status-badge/admin-status-badge.component';

export type HealthStatus = 'healthy' | 'warning' | 'unavailable' | 'unknown';

export interface HealthTile {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  group?: AdminGroupId;
  item?: string;
}

export interface AttentionItem {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  subsystem: string;
  message: string;
  group: AdminGroupId;
  item: string;
}

export interface Kpi {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: 'positive' | 'warning' | 'critical' | 'neutral';
  target: AdminNavTarget;
}

const SUBSYSTEM_TARGET: Record<string, { group: AdminGroupId; item: string }> = {
  football: { group: 'operations', item: 'football' },
  jobs: { group: 'operations', item: 'jobs' },
  cache: { group: 'operations', item: 'cache' },
};

@Component({
  selector: 'app-admin-overview-section',
  standalone: true,
  imports: [CommonModule, AdminStatusBadgeComponent],
  templateUrl: './admin-overview-section.component.html',
  styleUrls: ['./admin-overview-section.component.scss'],
})
export class AdminOverviewSectionComponent implements OnInit, OnDestroy {
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  @Output() navigate = new EventEmitter<AdminNavTarget>();

  loading = true;
  error = '';

  healthTiles: HealthTile[] = [];
  attentionItems: AttentionItem[] = [];
  kpis: Kpi[] = [];

  epg: EpgOverview | null = null;
  football: {
    provider: { state: string };
    activeCompetitions: number;
    upcomingFixtures: number;
    fixturesMissingBroadcast: number;
    staleCompetitions: number;
    staleTeams: number;
  } | null = null;
  jobsRunning = 0;
  jobsFailed = 0;

  health: HealthResponse | null = null;
  editorial: EditorialOverview | null = null;
  providers: EditorialProviderHealth | null = null;
  ledgerRunning = 0;
  ledgerQueued = 0;
  ledgerStuck = 0;

  private readonly sub = new Subscription();

  constructor(
    private readonly operations: AdminOperationsService,
    private readonly schedules: AdminSchedulesService,
    private readonly aiAnalytics: AdminAIAnalyticsService,
    private readonly editorialService: AdminEditorialService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  goTo(target: AdminNavTarget): void {
    this.navigate.emit(target);
  }

  private load(): void {
    this.loading = true;
    this.error = '';

    this.sub.add(
      forkJoin({
        health: this.schedules.getHealth().pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null as HealthResponse | null }))
        ),
        epg: this.schedules.getEpgOverview().pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null as EpgOverview | null }))
        ),
        football: this.operations.getFootballOverview().pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
        alerts: this.operations.getAlerts().pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
        jobsRunning: this.operations.getJobs({ status: 'running', limit: 1 }).pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
        jobsFailed: this.operations.getJobs({ status: 'failed', limit: 1 }).pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
        // getOverview() already swallows HTTP errors into a null value, so
        // "ok" here only ever reflects that the observable completed — the
        // health tile below reads presence of `value`, not `ok`.
        ai: this.aiAnalytics.getOverview().pipe(map((value) => ({ ok: true as const, value }))),
        editorial: this.editorialService.getOverview().pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null as EditorialOverview | null }))
        ),
        providers: this.editorialService.getProviders().pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null as EditorialProviderHealth | null }))
        ),
        ledgerRunning: this.editorialService.getLedger({ states: 'running', limit: 1 }).pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
        ledgerQueued: this.editorialService.getLedger({ states: 'queued', limit: 1 }).pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
        ledgerStuck: this.editorialService.getLedger({ states: 'dead-letter,blocked', limit: 1 }).pipe(
          map((value) => ({ ok: true as const, value })),
          catchError(() => of({ ok: false as const, value: null }))
        ),
      }).subscribe((result) => {
        this.epg = result.epg.value;
        this.football = result.football.value as typeof this.football;
        this.health = result.health.value;
        this.jobsRunning = (result.jobsRunning.value as { total?: number } | null)?.total || 0;
        this.jobsFailed = (result.jobsFailed.value as { total?: number } | null)?.total || 0;
        this.editorial = result.editorial.value;
        this.providers = result.providers.value;
        this.ledgerRunning = (result.ledgerRunning.value as { total?: number } | null)?.total || 0;
        this.ledgerQueued = (result.ledgerQueued.value as { total?: number } | null)?.total || 0;
        this.ledgerStuck = (result.ledgerStuck.value as { total?: number } | null)?.total || 0;

        this.healthTiles = this.buildHealthTiles(result);
        this.attentionItems = this.buildAttentionItems(
          (result.alerts.value as { items?: AttentionItem[] } | null)?.items || []
        );
        this.kpis = this.buildKpis();

        this.loading = false;
        this.lastUpdatedChange.emit(new Date());
      })
    );
  }

  private buildKpis(): Kpi[] {
    const ed = this.editorial;
    const providers = this.providers?.providers ?? [];
    const connected = providers.filter((p) => p.state === 'connected').length;
    const degraded = providers.filter((p) => ['unauthorized', 'unreachable', 'error'].includes(p.state)).length;
    const published = ed?.today.published ?? 0;
    const generated = ed?.today.generated ?? 0;
    const rate = generated > 0 ? `${Math.round((published / generated) * 100)}%` : '—';
    const gscRun = ed?.searchConsole?.lastRun;
    const gscIssues = (ed?.searchConsole?.guides ?? []).filter((g) => g.inspection?.indexed === false || Boolean(g.inspection?.error)).length;

    return [
      {
        id: 'system', label: 'Estado del sistema', value: this.health?.status ?? '…', hint: this.health ? `v${this.health.version}` : 'Sin datos',
        tone: this.health?.status === 'healthy' ? 'positive' : 'warning', target: { group: 'system', item: 'health' },
      },
      {
        id: 'active', label: 'Trabajos activos', value: String(this.ledgerRunning), hint: 'en ejecución en el ledger',
        tone: 'neutral', target: { group: 'ai', item: 'editorial', tab: 'ledger', state: 'running' },
      },
      {
        id: 'queue', label: 'Cola', value: String(this.ledgerQueued), hint: 'trabajos pendientes',
        tone: 'neutral', target: { group: 'ai', item: 'editorial', tab: 'ledger', state: 'queued' },
      },
      {
        id: 'stuck', label: 'Trabajos atascados', value: String(this.ledgerStuck), hint: 'sin reintentos o bloqueados',
        tone: this.ledgerStuck > 0 ? 'critical' : 'positive', target: { group: 'ai', item: 'editorial', tab: 'ledger', state: 'dead-letter' },
      },
      {
        id: 'rejected', label: 'Artículos rechazados', value: String(ed?.today.rejected ?? 0), hint: 'hoy',
        tone: (ed?.today.rejected ?? 0) > 0 ? 'warning' : 'positive', target: { group: 'ai', item: 'rejected' },
      },
      {
        id: 'providers', label: 'Salud de proveedores', value: providers.length ? `${connected}/${providers.length}` : '—',
        hint: degraded ? `${degraded} con incidencia` : 'conectados', tone: degraded > 0 ? 'warning' : 'positive', target: { group: 'ai', item: 'editorial', tab: 'settings' },
      },
      {
        id: 'throughput', label: 'Rendimiento editorial', value: String(generated), hint: 'intentos hoy',
        tone: 'neutral', target: { group: 'ai', item: 'editorial', tab: 'pipeline' },
      },
      {
        id: 'publishRate', label: 'Tasa de éxito de publicación', value: rate, hint: `${published} publicados de ${generated} intentos`,
        tone: 'neutral', target: { group: 'ai', item: 'editorial', tab: 'pipeline' },
      },
      {
        id: 'workers', label: 'Salud de workers', value: ed?.runner.online ? 'Conectado' : 'Sin señal', hint: ed?.runner.version || 'runner externo',
        tone: ed?.runner.online ? 'positive' : 'warning', target: { group: 'ai', item: 'editorial', tab: 'ledger', state: 'running' },
      },
      {
        id: 'cost', label: 'Coste de IA', value: `$${(ed?.spend.todayUsd ?? 0).toFixed(2)}`, hint: 'hoy (orientativo)',
        tone: 'neutral', target: { group: 'ai', item: 'editorial', tab: 'pipeline' },
      },
      {
        id: 'gsc', label: 'Estado de Search Console', value: gscRun ? gscRun.status : 'Sin datos', hint: gscRun ? `${gscRun.inspected} inspeccionadas` : 'sin sincronización',
        tone: 'neutral', target: { group: 'ai', item: 'editorial', tab: 'search' },
      },
      {
        id: 'seoIssues', label: 'Incidencias SEO', value: String(gscIssues), hint: 'guías sin indexar o con error',
        tone: gscIssues > 0 ? 'critical' : 'positive', target: { group: 'ai', item: 'editorial', tab: 'search' },
      },
    ];
  }

  private buildHealthTiles(result: {
    health: { ok: boolean; value: HealthResponse | null };
    epg: { ok: boolean; value: EpgOverview | null };
    football: { ok: boolean; value: typeof this.football };
    ai: { ok: boolean; value: unknown };
  }): HealthTile[] {
    const cacheStatus = result.health.value?.services?.cache?.status;
    const providerState = result.football.value?.provider?.state;
    const epgHasIssues =
      !!result.epg.value && (result.epg.value.channelsMissingEpg > 0 || result.epg.value.staleChannels > 0);

    return [
      {
        id: 'api',
        label: 'API',
        status: result.health.ok ? 'healthy' : 'unavailable',
        detail: result.health.ok ? 'Responding' : 'Health check failed',
      },
      {
        id: 'mongo',
        label: 'Mongo',
        // No dedicated Mongo health check exists on /admin/health today —
        // reported as Unknown rather than fabricating a status.
        status: 'unknown',
        detail: 'No dedicated check — see System',
        group: 'system',
        item: 'health',
      },
      {
        id: 'cache',
        label: 'Cache',
        status: cacheStatus === 'healthy' ? 'healthy' : cacheStatus ? 'unavailable' : 'unknown',
        detail: cacheStatus ? `Runtime: ${cacheStatus}` : 'No data',
        group: 'operations',
        item: 'cache',
      },
      {
        id: 'epg',
        label: 'EPG',
        status: !result.epg.ok ? 'unavailable' : epgHasIssues ? 'warning' : 'healthy',
        detail:
          result.epg.value && typeof result.epg.value.currentCoveragePercent === 'number'
            ? `${result.epg.value.currentCoveragePercent}% coverage`
            : 'Overview unavailable',
        group: 'schedules',
        item: 'epg',
      },
      {
        id: 'football',
        label: 'Football',
        status:
          !result.football.ok
            ? 'unavailable'
            : providerState === 'healthy'
              ? 'healthy'
              : providerState === 'degraded'
                ? 'warning'
                : 'unknown',
        detail: providerState ? `Provider: ${providerState}` : 'No provider data',
        group: 'operations',
        item: 'football',
      },
      {
        id: 'ai',
        label: 'AI',
        // AdminAIAnalyticsService.getOverview() swallows HTTP errors into a
        // null value, so failure and "no data yet" are indistinguishable
        // here — reported as Unknown rather than guessing which one it was.
        status: result.ai.value ? 'healthy' : 'unknown',
        detail: result.ai.value ? 'Reachable' : 'No data',
        group: 'ai',
        item: 'dashboard',
      },
    ];
  }

  private buildAttentionItems(
    items: Array<{ id: string; severity: 'info' | 'warning' | 'critical'; subsystem: string; message: string }>
  ): AttentionItem[] {
    return items.map((raw) => {
      const target = SUBSYSTEM_TARGET[raw.subsystem] || { group: 'operations' as AdminGroupId, item: 'overview' };
      return { ...raw, group: target.group, item: target.item };
    });
  }
}
