import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  Component,
  EventEmitter,
  Inject,
  Input,
  OnDestroy,
  OnInit,
  OnChanges,
  SimpleChanges,
  Output,
  PLATFORM_ID,
} from '@angular/core';
import { Subscription, interval } from 'rxjs';
import {
  AdminAnalyticsEvent,
  AdminAnalyticsJourney,
  AdminAnalyticsLiveSession,
  AdminAnalyticsOverview,
  AdminAnalyticsService,
  AdminRealtimePages,
} from '../../../../services/admin-analytics.service';
import {
  AdminRetentionCohort,
  AdminUsersService,
} from '../../../../services/admin-users.service';
import { WORLD_MAP } from './world-map';
import { countryMarker } from './map-marker';
import { LiveMapComponent, LiveMapMarker } from './live-map.component';

@Component({
  selector: 'app-admin-analytics-section',
  standalone: true,
  imports: [CommonModule, LiveMapComponent],
  templateUrl: './admin-analytics-section.component.html',
  styleUrls: ['./admin-analytics-section.component.scss'],
})
export class AdminAnalyticsSectionComponent implements OnInit, OnChanges, OnDestroy {
  @Input() activeItem = 'overview';
  @Output() lastUpdatedChange = new EventEmitter<Date>();
  @Output() activeItemChange = new EventEmitter<string>();

  public overview: AdminAnalyticsOverview | null = null;
  public liveSessions: AdminAnalyticsLiveSession[] = [];
  public recentEvents: AdminAnalyticsEvent[] = [];
  public activeNow: number | null = null;
  public error: string | null = null;
  public lastUpdated: Date | null = null;
  public expandedSessionId: string | null = null;
  public sessionEvents: Record<string, AdminAnalyticsEvent[] | null> = {};
  public sessionEventErrors: Record<string, boolean> = {};
  public eventSessionId: string | undefined;
  public eventsLoading = true;
  public eventsError = false;

  public rangeHours = 24;
  public readonly ranges = [
    { label: '24h', value: 24 },
    { label: '7d', value: 168 },
    { label: '30d', value: 720 },
  ];

  public eventFilter: string | undefined = undefined;
  public readonly eventFilters = [
    { id: 'all', label: 'Todos', type: undefined },
    { id: 'page_view', label: 'Páginas vistas', type: 'page_view' },
    { id: 'click', label: 'Clicks', type: 'click' },
    { id: 'scroll_depth', label: 'Scroll', type: 'scroll_depth' },
    { id: 'visibility', label: 'Visibilidad', type: 'visibility' },
    { id: 'session', label: 'Sesiones', type: 'session_start' },
  ];

  public journeys: AdminAnalyticsJourney[] = [];
  public journeysSessionsAnalyzed = 0;
  public journeysLoaded = false;
  public retentionCohorts: AdminRetentionCohort[] = [];
  public retentionLoaded = false;
  public pageSearch = '';
  public pageNumber = 0;
  public pageSort: 'users' | 'views' | 'path' = 'users';
  public pageAscending = false;
  public realtimePages: AdminRealtimePages | null = null;
  public realtimePagesLoading = false;
  public realtimePagesError: string | null = null;
  public fallbackEvents: AdminAnalyticsEvent[] | null = null;
  public fallbackEventsError = false;
  public readonly worldMap = WORLD_MAP;
  public geographyCounts: Record<string, number> = {};
  public geographyMax = 0;
  public geographySort: 'country' | 'region' | 'count' = 'count';
  public geographyAscending = false;
  public overviewLoading = false;
  public overviewError = false;
  public liveLoading = true;
  public liveError = false;
  public liveUpdatedAt: Date | null = null;
  public liveIdleCountUncertain = false;
  public sessionSearch = '';
  public sessionKind: 'all' | 'crawler' | 'other' = 'all';
  public sessionPage = 0;
  public liveCountries: Record<string, number> = {};
  public liveMarkers: LiveMapMarker[] = [];
  public liveUnmapped = 0;
  private readonly countryMarkers = new Map(WORLD_MAP.map((country) => [country.code, countryMarker(country.path)]));

  private subs = new Subscription();
  private overviewRequest?: Subscription;
  private realtimePagesRequest?: Subscription;
  private fallbackEventsRequest?: Subscription;
  private eventsRequest?: Subscription;
  private liveRequest?: Subscription;
  private sessionEventsRequests = new Map<string, Subscription>();
  private lastRealtimePagesAttempt = 0;
  private readonly isBrowser: boolean;

  constructor(
    private analyticsService: AdminAnalyticsService,
    private usersService: AdminUsersService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadAnalytics();
    this.subs.add(interval(10000).subscribe(() => this.loadLive()));
    this.subs.add(interval(10000).subscribe(() => { if (this.activeItem === 'pages') this.loadRealtimePages(); }));
    this.subs.add(interval(30000).subscribe(() => this.loadEvents()));
    this.subs.add(interval(60000).subscribe(() => this.loadOverview()));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.overviewRequest?.unsubscribe();
    this.realtimePagesRequest?.unsubscribe();
    this.fallbackEventsRequest?.unsubscribe();
    this.eventsRequest?.unsubscribe();
    this.liveRequest?.unsubscribe();
    for (const request of this.sessionEventsRequests.values()) request.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['activeItem'] || !this.isBrowser) return;
    if (this.activeItem === 'pages') this.loadRealtimePages();
    if (this.activeItem === 'journeys' && !this.journeysLoaded) this.loadJourneys();
    if (this.activeItem === 'retention' && !this.retentionLoaded) this.loadRetention();
  }

  toggleSession(sessionId: string): void {
    const isOpening = this.expandedSessionId !== sessionId;
    this.expandedSessionId = isOpening ? sessionId : null;

    if (isOpening) this.loadSessionEvents(sessionId);
  }

  loadSessionEvents(sessionId: string): void {
    this.sessionEventsRequests.get(sessionId)?.unsubscribe();
    this.sessionEvents[sessionId] = null;
    this.sessionEventErrors[sessionId] = false;
    const request = this.analyticsService.getRecentEvents(20, undefined, sessionId).subscribe({
      next: (events) => { this.sessionEvents[sessionId] = events; },
      error: () => { this.sessionEvents[sessionId] = []; this.sessionEventErrors[sessionId] = true; },
    });
    this.sessionEventsRequests.set(sessionId, request);
  }

  openSessionEvents(sessionId: string): void {
    this.eventSessionId = sessionId;
    this.eventFilter = undefined;
    this.eventsLoading = true;
    this.loadEvents();
    this.selectTab('events');
  }

  clearSessionEventsFilter(): void {
    this.eventSessionId = undefined;
    this.eventsLoading = true;
    this.loadEvents();
  }

  isExpanded(sessionId: string): boolean {
    return this.expandedSessionId === sessionId;
  }

  selectRange(hours: number): void {
    this.rangeHours = hours;
    this.pageNumber = 0;
    this.loadOverview();
    this.loadEvents();
    if (this.activeItem === 'journeys') this.loadJourneys();
  }

  selectTab(tabId: string): void {
    if (this.activeItem === tabId) return;
    this.activeItemChange.emit(tabId);
  }

  exportCsv(): void {
    if (!this.isBrowser) return;
    const rows: string[][] = this.activeItem === 'pages' ? [['ruta', 'usuarios_activos', 'vistas']] : [['sección', 'clave', 'valor']];
    if (this.activeItem === 'pages') for (const page of this.filteredPages) rows.push([page.path, String(page.users), String(page.views)]);
    if (this.overview && this.activeItem === 'overview') {
      rows.push(['overview', 'totalPageViews', String(this.overview.totalPageViews ?? 0)]);
      for (const page of this.overview.topPages || []) {
        rows.push(['top_page', page.path, String(page.count)]);
      }
      for (const day of this.activeItem === 'overview' ? this.overview.sessionsByDay || [] : []) {
        rows.push(['sessions_by_day', day.date, String(day.count)]);
      }
    }
    for (const journey of this.activeItem === 'journeys' ? this.journeys : []) {
      rows.push(['journey', journey.steps.join(' > '), String(journey.count)]);
    }
    if (this.activeItem === 'events') for (const event of this.recentEvents) rows.push(['evento', event.type, event.path || event.name || '']);
    if (this.activeItem === 'live') for (const session of this.liveSessions) rows.push(['sesión', session.sessionId, session.lastPath || '']);
    if (this.activeItem === 'retention') for (const cohort of this.retentionCohorts) rows.push(['cohorte', JSON.stringify(cohort), '']);
    if (this.activeItem === 'geography') for (const place of this.overview?.geography || []) rows.push([place.country, place.region, String(place.count)]);
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/^[\s]*[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guiatv-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  get filteredPages(): Array<{ path: string; users: number; views: number }> {
    const search = this.pageSearch.toLocaleLowerCase();
    return (this.realtimePages?.pages || []).filter((page) => page.path.toLocaleLowerCase().includes(search))
      .sort((a, b) => (this.pageAscending ? 1 : -1) * (this.pageSort === 'path' ? a.path.localeCompare(b.path) : a[this.pageSort] - b[this.pageSort]));
  }

  sortPages(column: 'path' | 'users' | 'views'): void {
    this.pageAscending = this.pageSort === column ? !this.pageAscending : column === 'path';
    this.pageSort = column;
    this.pageNumber = 0;
  }

  get sortedGeography(): Array<{ country: string; region: string; count: number }> {
    const sort = this.geographySort;
    const direction = this.geographyAscending ? 1 : -1;
    return [...(this.overview?.geography || [])].sort((a, b) => direction *
      (sort === 'count' ? a.count - b.count : a[sort].localeCompare(b[sort], 'es')));
  }

  get livePageCounts(): Array<{ label: string; count: number }> {
    return this.countLiveSessions((session) => session.lastPath || 'Desconocida');
  }

  get filteredLiveSessions(): AdminAnalyticsLiveSession[] {
    const query = this.sessionSearch.trim().toLocaleLowerCase();
    return this.liveSessions.filter((session) => {
      const crawler = Boolean(this.getCrawlerName(session.userAgent));
      if (this.sessionKind === 'crawler' && !crawler || this.sessionKind === 'other' && crawler) return false;
      return !query || [session.sessionId, session.lastPath, session.country, session.region, session.city, this.getBrowserSummary(session.userAgent), this.getOsSummary(session.userAgent), this.getCrawlerName(session.userAgent)]
        .some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }

  filterLiveSessions(query: string, kind: string): void {
    this.sessionSearch = query;
    this.sessionKind = kind === 'crawler' || kind === 'other' ? kind : 'all';
    this.sessionPage = 0;
  }

  get liveSourceCounts(): Array<{ label: string; count: number }> {
    return this.countLiveSessions((session) => session.referrer || 'Directo o desconocido');
  }

  private countLiveSessions(label: (session: AdminAnalyticsLiveSession) => string): Array<{ label: string; count: number }> {
    const counts = new Map<string, number>();
    for (const session of this.liveSessions) {
      const key = label(session);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ label: name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }

  sortGeography(column: 'country' | 'region' | 'count'): void {
    this.geographyAscending = this.geographySort === column ? !this.geographyAscending : column !== 'count';
    this.geographySort = column;
  }

  geographySortDirection(column: string): string | null {
    return this.geographySort === column ? (this.geographyAscending ? 'ascending' : 'descending') : null;
  }

  searchPages(value: string): void {
    this.pageSearch = value;
    this.pageNumber = 0;
  }

  selectEventFilter(type?: string): void {
    this.eventFilter = type;
    this.eventsLoading = true;
    this.loadEvents();
  }

  trackBySession(_index: number, item: AdminAnalyticsLiveSession): string {
    return item.sessionId;
  }

  trackByEvent(_index: number, item: AdminAnalyticsEvent): string {
    return item.eventId;
  }

  trackByMinute(index: number): number { return index; }

  trackByPage(_index: number, page: { path: string }): string { return page.path; }

  formatDuration(totalSeconds: number): string {
    if (!totalSeconds) return '0s';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  getDayBarWidth(count: number): string {
    const max = Math.max(
      1,
      ...(this.overview?.sessionsByDay.map((item) => item.count) || [1])
    );
    const pct = count > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
    return `${pct}%`;
  }

  getMinuteBarWidth(count: number): string {
    const max = Math.max(1, ...(this.realtimePages?.minutes.map((minute) => minute.users) || []));
    return `${count ? Math.max(2, Math.round(count / max * 100)) : 0}%`;
  }

  getDeviceSummary(session: AdminAnalyticsLiveSession): string {
    const device = session.metadata?.device;
    const rawType = device?.type || (session.metadata?.uaData?.mobile ? 'mobile' : '');
    const type = ({ mobile: 'Móvil', desktop: 'Ordenador', tablet: 'Tableta' } as Record<string, string>)[rawType] || rawType || 'Dispositivo desconocido';
    const orientation = ({ landscape: 'horizontal', portrait: 'vertical' } as Record<string, string>)[device?.orientation] || device?.orientation;
    return [type, orientation, device?.isTouchDevice ? 'táctil' : ''].filter(Boolean).join(' · ');
  }

  getSessionDuration(session: AdminAnalyticsLiveSession): string {
    const elapsed = (new Date(session.lastSeenAt).getTime() - new Date(session.startedAt).getTime()) / 1000;
    if (session.durationSec && session.durationSec > 0) return this.formatDuration(session.durationSec);
    return Number.isFinite(elapsed) && elapsed >= 0 ? this.formatDuration(Math.floor(elapsed)) : 'No disponible';
  }

  getCrawlerName(userAgent?: string): string | null {
    const match = userAgent?.match(/\b(Applebot|Googlebot|bingbot|Baiduspider|YandexBot|DuckDuckBot|GPTBot|OAI-SearchBot|ClaudeBot)\b/i);
    return match?.[1] || null;
  }

  getBrowserSummary(userAgent?: string): string {
    if (!userAgent) return '';
    if (userAgent.includes('Edg/')) return 'Edge';
    if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) return 'Chrome';
    if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'Safari';
    if (userAgent.includes('Firefox/')) return 'Firefox';
    return '';
  }

  getOsSummary(userAgent?: string): string {
    if (!userAgent) return '';
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac OS X') && !userAgent.includes('iPhone')) return 'macOS';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
    if (userAgent.includes('Linux')) return 'Linux';
    return '';
  }

  getConnectionSummary(session: AdminAnalyticsLiveSession): string {
    const connection = session.metadata?.connection;
    if (!connection?.effectiveType) return '';
    return `${connection.effectiveType}${connection.saveData ? ' (save-data)' : ''}`;
  }

  getIdleLabel(session: AdminAnalyticsLiveSession): string {
    const activity = session.metadata?.activity;
    if (!activity) return '';
    if (activity.isIdle && Number.isFinite(activity.idleSec)) return `Sin interacción desde hace ${this.formatDuration(Math.max(0, activity.idleSec))}`;
    return '';
  }

  private loadAnalytics(): void {
    this.loadOverview();
    this.loadLive();
    this.loadEvents();
    if (this.activeItem === 'journeys') this.loadJourneys();
    if (this.activeItem === 'retention') this.loadRetention();
    if (this.activeItem === 'pages') this.loadRealtimePages();
  }

  private loadRealtimePages(): void {
    if (this.realtimePagesRequest && !this.realtimePagesRequest.closed) return;
    if (this.realtimePagesError && Date.now() - this.lastRealtimePagesAttempt < 30000) return;
    this.lastRealtimePagesAttempt = Date.now();
    if (!this.realtimePages && !this.realtimePagesError) this.realtimePagesLoading = true;
    this.realtimePagesRequest = this.analyticsService.getRealtimePages().subscribe({
      next: (report) => {
        this.realtimePages = report;
        this.realtimePagesLoading = false;
        this.realtimePagesError = null;
        this.fallbackEvents = null;
        this.fallbackEventsError = false;
        this.pageNumber = Math.min(this.pageNumber, Math.max(0, Math.ceil(this.filteredPages.length / 10) - 1));
      },
      error: (error) => {
        this.realtimePagesLoading = false;
        this.realtimePagesError = error.status === 404 ? 'El servidor conectado no dispone de este informe. Actualiza o reinicia el backend con la versión actual.' : error.status === 401 || error.status === 403 ? 'Tu sesión no tiene acceso al informe. Vuelve a iniciar sesión con una cuenta de administración.' : error.status === 503 ? 'El almacenamiento activo no está disponible para este informe.' : 'No se ha podido actualizar el informe en tiempo real.';
        if (error.status === 404 && !this.realtimePages) this.loadFallbackEvents();
      },
    });
  }

  retryRealtimePages(): void {
    this.lastRealtimePagesAttempt = 0;
    this.loadRealtimePages();
  }

  private loadFallbackEvents(): void {
    this.fallbackEventsRequest?.unsubscribe();
    this.fallbackEventsError = false;
    this.fallbackEventsRequest = this.analyticsService.getRecentEvents(40, undefined, undefined, 0.5).subscribe({
      next: (events) => { this.fallbackEvents = events; },
      error: () => { this.fallbackEvents = null; this.fallbackEventsError = true; },
    });
  }

  private loadJourneys(): void {
    this.analyticsService.getJourneys(Math.ceil(this.rangeHours / 24)).subscribe({
      next: (result) => {
        this.journeys = result.journeys;
        this.journeysSessionsAnalyzed = result.sessionsAnalyzed;
        this.journeysLoaded = true;
      },
      error: () => {
        this.journeys = [];
        this.journeysLoaded = true;
        this.error = 'No se han podido cargar los recorridos.';
      },
    });
  }

  private loadRetention(): void {
    this.usersService.getRetention().subscribe({
      next: (cohorts) => {
        this.retentionCohorts = cohorts;
        this.retentionLoaded = true;
      },
      error: () => {
        this.retentionCohorts = [];
        this.retentionLoaded = true;
        this.error = 'No se han podido cargar las cohortes de retención.';
      },
    });
  }

  private loadOverview(): void {
    this.overviewRequest?.unsubscribe();
    this.overviewLoading = true;
    this.overviewError = false;
    this.overviewRequest = this.analyticsService.getOverview(this.rangeHours).subscribe({
      next: (overview) => {
        this.overview = overview;
        this.geographyCounts = {};
        for (const place of overview.geography || []) {
          this.geographyCounts[place.country] = (this.geographyCounts[place.country] || 0) + place.count;
        }
        this.geographyMax = Math.max(0, ...Object.entries(this.geographyCounts).filter(([country]) => country !== 'Desconocido').map(([, count]) => count));
        this.overviewLoading = false;
        this.error = null;
        this.touchUpdated();
      },
      error: () => {
        this.overviewLoading = false;
        this.overviewError = true;
        this.error = 'No se ha podido cargar el resumen de Analytics.';
      },
    });
  }

  private loadLive(): void {
    if (this.liveRequest && !this.liveRequest.closed) return;
    this.liveRequest = this.analyticsService.getLive().subscribe({
      next: (snapshot) => {
        this.liveLoading = false;
        this.liveError = false;
        this.liveUpdatedAt = new Date();
        const idleLimit = snapshot.idleTimeoutSec ?? 300;
        this.liveSessions = snapshot.sessions.filter((session) => {
          const idle = session.metadata?.activity?.idleSec;
          return typeof idle !== 'number' || !Number.isFinite(idle) || idle < idleLimit;
        });
        const removed = snapshot.sessions.length - this.liveSessions.length;
        this.liveIdleCountUncertain = snapshot.sessions.length < snapshot.activeCount && (!snapshot.idleTimeoutSec || removed > 0);
        this.activeNow = snapshot.activeCount - (snapshot.sessions.length === snapshot.activeCount ? removed : 0);
        this.sessionPage = Math.min(this.sessionPage, Math.max(0, Math.ceil(this.filteredLiveSessions.length / 10) - 1));
        this.liveCountries = {};
        for (const session of this.liveSessions) {
          const country = session.country || 'Desconocido';
          this.liveCountries[country] = (this.liveCountries[country] || 0) + 1;
        }
        const grouped = new Map<string, LiveMapMarker>();
        this.liveUnmapped = 0;
        for (const session of this.liveSessions) {
          const country = session.country;
          const hasCoordinates = typeof session.latitude === 'number' && Number.isFinite(session.latitude) && Math.abs(session.latitude) <= 90
            && typeof session.longitude === 'number' && Number.isFinite(session.longitude) && Math.abs(session.longitude) <= 180;
          const fallback = country ? this.countryMarkers.get(country) : null;
          if (!country || (!hasCoordinates && !fallback)) { this.liveUnmapped++; continue; }
          const lat = hasCoordinates ? session.latitude! : 90 - fallback!.y / 2;
          const lng = hasCoordinates ? session.longitude! : fallback!.x / 2 - 180;
          const precision = hasCoordinates ? 'ip' : 'country';
          const label = hasCoordinates ? [session.city, session.region, country].filter(Boolean).join(', ') : country;
          const key = JSON.stringify([precision, label, lat, lng]);
          const marker = grouped.get(key) || { key, label, lat, lng, count: 0, precision };
          marker.count++;
          grouped.set(key, marker);
        }
        const markers = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
        if (markers.length !== this.liveMarkers.length || markers.some((marker, index) => marker.key !== this.liveMarkers[index].key || marker.count !== this.liveMarkers[index].count)) {
          this.liveMarkers = markers;
        }
        this.error = null;
        this.touchUpdated();
      },
      error: () => {
        this.liveLoading = false;
        this.liveError = true;
        this.error = 'No se han podido cargar las sesiones en tiempo real.';
      },
    });
  }

  private loadEvents(): void {
    this.eventsRequest?.unsubscribe();
    this.eventsRequest = this.analyticsService.getRecentEvents(40, this.eventFilter, this.eventSessionId, this.rangeHours).subscribe({
      next: (events) => {
        this.recentEvents = events;
        this.eventsLoading = false;
        this.eventsError = false;
        this.error = null;
        this.touchUpdated();
      },
      error: () => {
        this.eventsLoading = false;
        this.eventsError = true;
        this.error = 'No se han podido cargar los eventos recientes.';
      },
    });
  }

  private touchUpdated(): void {
    this.lastUpdated = new Date();
    this.lastUpdatedChange.emit(this.lastUpdated);
  }
}
