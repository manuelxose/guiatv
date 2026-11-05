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
  AdminAnalyticsDiagnostics,
  AdminGa4Demographics,
  AdminAnalyticsExclusions,
  describeAnalyticsError,
} from '../../../../services/admin-analytics.service';
import {
  AdminRetentionCohort,
  AdminUsersService,
} from '../../../../services/admin-users.service';
import { InfoTipComponent } from '../../../../components/info-tip/info-tip.component';
import { WORLD_MAP } from './world-map';
import { countryMarker } from './map-marker';
import { LiveMapComponent, LiveMapMarker } from './live-map.component';
import { barWidth, countryFlag, countryName, geoSourceLabel, geoStatusLabel, locationLabel, locationPrecision, providerLabel, regionLabel, share } from './geo-format';

const TODAY = 0;
const YESTERDAY = -1;

/** One row of a GA-style location table. */
export interface GeoRow {
  key: string;
  flag: string;
  label: string;
  detail: string;
  count: number;
  unknown: boolean;
}

@Component({
  selector: 'app-admin-analytics-section',
  standalone: true,
  imports: [CommonModule, LiveMapComponent, InfoTipComponent],
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

  /** Selected range: TODAY / YESTERDAY (calendar days, UTC like the stored daily counters) or a rolling number of hours. */
  public rangeHours = 168;
  // Retention is ANALYTICS_TTL_DAYS=14, so nothing longer than 14 days is offered.
  public readonly ranges = [
    { label: 'Hoy', value: TODAY },
    { label: 'Ayer', value: YESTERDAY },
    { label: 'Últimos 7 días', value: 168 },
    { label: 'Últimos 14 días', value: 336 },
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
  public geographySort: 'label' | 'country' | 'region' | 'count' = 'count';
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
    this.subs.add(interval(60000).subscribe(() => this.loadOverview(true)));
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
    if (this.activeItem === 'diagnostics') this.loadDiagnostics();
    if (this.activeItem === 'exclusions') this.loadExclusions();
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
    if (this.activeItem === 'geography') for (const row of this.geoRows) rows.push([`ubicación (${this.geoView})`, row.detail ? `${row.label} (${row.detail})` : row.label, String(row.count)]);
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/^[\s]*[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guiatv-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  get filteredPages(): AdminRealtimePages['pages'] {
    const search = this.pageSearch.toLocaleLowerCase();
    return (this.realtimePages?.pages || []).filter((page) => page.path.toLocaleLowerCase().includes(search))
      .sort((a, b) => (this.pageAscending ? 1 : -1) * (this.pageSort === 'path' ? a.path.localeCompare(b.path) : a[this.pageSort] - b[this.pageSort]));
  }

  sortPages(column: 'path' | 'users' | 'views'): void {
    this.pageAscending = this.pageSort === column ? !this.pageAscending : column === 'path';
    this.pageSort = column;
    this.pageNumber = 0;
  }

  /** Formatting helpers for the template (names, flags, precision, shares). */
  readonly fmt = { countryName, countryFlag, locationLabel, locationPrecision, providerLabel, geoSourceLabel, geoStatusLabel, share, barWidth };
  public geoView: 'country' | 'region' | 'city' = 'country';

  /** True when the backend sent the country/region/city breakdown (city view needs it). */
  get hasGeoDetail(): boolean {
    return Array.isArray(this.overview?.geographyDetail);
  }

  /** Location rows for the selected level, sorted (sessions by default), unknown locations kept as their own row. */
  get geoRows(): GeoRow[] {
    const level = this.geoView === 'city' && !this.hasGeoDetail ? 'region' : this.geoView;
    const source = this.hasGeoDetail
      ? this.overview!.geographyDetail!
      : (this.overview?.geography || []).map((g) => ({ country: g.country === 'Desconocido' ? undefined : g.country, region: g.region === 'Desconocido' ? undefined : g.region, count: g.count } as { country?: string; region?: string; regionName?: string; city?: string; count: number }));
    const rows = new Map<string, GeoRow>();
    for (const bucket of source) {
      const country = bucket.country;
      const region = regionLabel(bucket.region, bucket.regionName);
      const parts = level === 'country' ? [country] : level === 'region' ? [country, bucket.region] : [country, bucket.region, bucket.city];
      const unknown = !country || (level === 'region' && !region) || (level === 'city' && !bucket.city);
      const key = unknown ? `unknown:${level === 'country' ? '' : country || ''}` : parts.join('|');
      const label = level === 'country'
        ? (country ? countryName(country) : 'Ubicación desconocida')
        : level === 'region'
          ? (region || (country ? 'Región desconocida' : 'Ubicación desconocida'))
          : (bucket.city || (country ? 'Ciudad desconocida' : 'Ubicación desconocida'));
      const detail = level === 'country' ? '' : [level === 'city' ? region : '', country ? countryName(country) : ''].filter(Boolean).join(', ');
      const row = rows.get(key) || { key, flag: countryFlag(country), label, detail, count: 0, unknown };
      row.count += bucket.count;
      rows.set(key, row);
    }
    const direction = this.geographyAscending ? 1 : -1;
    return [...rows.values()].sort((a, b) => {
      if (this.geographySort === 'count') return direction * (a.count - b.count) || a.label.localeCompare(b.label, 'es');
      return direction * a.label.localeCompare(b.label, 'es');
    });
  }

  get geoTotal(): number {
    return this.geoRows.reduce((sum, row) => sum + row.count, 0);
  }

  get geoMax(): number {
    return Math.max(0, ...this.geoRows.map((row) => row.count));
  }

  /** Located / country-only / unknown… totals for the period, with labels. */
  get geoStatusRows(): Array<{ status: string; label: string; count: number }> {
    return (this.overview?.geographyStatus || []).map((row) => ({ ...row, label: geoStatusLabel(row.status) }));
  }

  selectGeoView(view: 'country' | 'region' | 'city'): void {
    this.geoView = view;
  }

  /** Live sessions by country, most sessions first, with names and flags. */
  get liveCountryRows(): Array<{ code: string; flag: string; name: string; count: number }> {
    return Object.entries(this.liveCountries)
      .map(([code, count]) => ({ code, flag: countryFlag(code), name: countryName(code), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es'));
  }

  /** Top countries of the period for the overview card. */
  get overviewCountries(): Array<{ code: string; flag: string; name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const place of this.overview?.geography || []) counts.set(place.country, (counts.get(place.country) || 0) + place.count);
    return [...counts].map(([code, count]) => ({ code, flag: countryFlag(code), name: countryName(code), count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }

  get overviewPageMax(): number {
    return Math.max(0, ...(this.overview?.topPages || []).map((page) => page.count));
  }

  get overviewReferrerMax(): number {
    return Math.max(0, ...(this.overview?.topReferrers || []).map((ref) => ref.count));
  }

  get livePageCounts(): Array<{ label: string; count: number }> {
    return this.countLiveSessions((session) => session.lastPathLabel || session.lastPath || 'Desconocida');
  }

  get filteredLiveSessions(): AdminAnalyticsLiveSession[] {
    const query = this.sessionSearch.trim().toLocaleLowerCase();
    return this.liveSessions.filter((session) => {
      const crawler = Boolean(this.getCrawlerName(session.userAgent));
      if (this.sessionKind === 'crawler' && !crawler || this.sessionKind === 'other' && crawler) return false;
      return !query || [session.sessionId, session.lastPath, session.lastPathLabel, session.country, countryName(session.country), session.region, session.geo?.regionName, session.city, session.geo?.asOrg, this.getBrowserSummary(session.userAgent), this.getOsSummary(session.userAgent), this.getCrawlerName(session.userAgent)]
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

  sortGeography(column: 'label' | 'country' | 'region' | 'count'): void {
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

  get minuteMax(): number {
    return Math.max(1, ...(this.realtimePages?.minutes.map((minute) => minute.users) || []));
  }

  /** Column height in the 0-100 viewBox of the per-minute chart. */
  getMinuteBarHeight(count: number): number {
    return count ? Math.max(2, Math.round(count / this.minuteMax * 100)) : 0;
  }

  getDeviceSummary(session: AdminAnalyticsLiveSession): string {
    const device = session.metadata?.device;
    const rawType = device?.type || (session.metadata?.uaData?.mobile ? 'mobile' : '');
    const type = ({ mobile: 'Móvil', desktop: 'Ordenador', tablet: 'Tableta' } as Record<string, string>)[rawType] || rawType || 'Dispositivo desconocido';
    const orientation = ({ landscape: 'horizontal', portrait: 'vertical' } as Record<string, string>)[device?.orientation] || device?.orientation;
    return [type, orientation, device?.isTouchDevice || device?.touch ? 'táctil' : ''].filter(Boolean).join(' · ');
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
    if (this.activeItem === 'diagnostics') this.loadDiagnostics();
    if (this.activeItem === 'exclusions') this.loadExclusions();
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
        const described = describeAnalyticsError(error);
        this.realtimePagesError = described.kind === 'storage_unavailable' ? `El almacenamiento activo no está disponible para este informe. ${described.message}` : described.message;
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
    this.analyticsService.getJourneys(Math.max(1, Math.ceil(this.rangeSpan().hours / 24))).subscribe({
      next: (result) => {
        this.journeys = result.journeys;
        this.journeysSessionsAnalyzed = result.sessionsAnalyzed;
        this.journeysLoaded = true;
      },
      error: (error) => {
        this.journeys = [];
        this.journeysLoaded = true;
        this.error = `No se han podido cargar los recorridos: ${describeAnalyticsError(error).message}`;
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

  /** Hours back from now to the start of the range, and how long ago it ended (0 = now). */
  private rangeSpan(): { hours: number; endedHoursAgo: number } {
    if (this.rangeHours > 0) return { hours: this.rangeHours, endedHoursAgo: 0 };
    const now = new Date();
    const sinceMidnight = (now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 3600000;
    if (this.rangeHours === TODAY) return { hours: Math.max(sinceMidnight, 1 / 60), endedHoursAgo: 0 };
    // Yesterday ends 1 ms before today's midnight so the daily bucket of today is not included.
    return { hours: sinceMidnight + 24, endedHoursAgo: sinceMidnight + 1 / 3600000 };
  }

  private loadOverview(background = false): void {
    this.overviewRequest?.unsubscribe();
    // A background refresh keeps the report on screen; showing the loading state would tear it down every minute.
    this.overviewLoading = !background || !this.overview;
    this.overviewError = false;
    const { hours, endedHoursAgo } = this.rangeSpan();
    const request = endedHoursAgo ? this.analyticsService.getOverview(hours, endedHoursAgo) : this.analyticsService.getOverview(hours);
    this.overviewRequest = request.subscribe({
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
      error: (error) => {
        this.overviewLoading = false;
        this.overviewError = true;
        this.error = `No se ha podido cargar el resumen de Analytics: ${describeAnalyticsError(error).message}`;
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
          const label = hasCoordinates ? locationLabel(session) : countryName(country);
          const key = JSON.stringify([precision, label, lat, lng]);
          const marker: LiveMapMarker = grouped.get(key) || { key, label, lat, lng, count: 0, precision, radiusKm: session.geo?.accuracyRadiusKm };
          if (marker.radiusKm !== session.geo?.accuracyRadiusKm) marker.radiusKm = undefined; // mixed radii: say nothing
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
      error: (error) => {
        this.liveLoading = false;
        this.liveError = true;
        this.error = `No se han podido cargar las sesiones en tiempo real: ${describeAnalyticsError(error).message}`;
      },
    });
  }

  private loadEvents(): void {
    this.eventsRequest?.unsubscribe();
    this.eventsRequest = this.analyticsService.getRecentEvents(40, this.eventFilter, this.eventSessionId, this.rangeSpan().hours).subscribe({
      next: (events) => {
        this.recentEvents = events;
        this.eventsLoading = false;
        this.eventsError = false;
        this.error = null;
        this.touchUpdated();
      },
      error: (error) => {
        this.eventsLoading = false;
        this.eventsError = true;
        this.error = `No se han podido cargar los eventos recientes: ${describeAnalyticsError(error).message}`;
      },
    });
  }

  public diagnostics: AdminAnalyticsDiagnostics | null = null;
  public diagnosticsError: string | null = null;
  public ga4Demographics: AdminGa4Demographics | null = null;
  public ga4Error: string | null = null;
  public readonly ga4DimensionLabels: Record<string, string> = { userAgeBracket: 'Edad', userGender: 'Sexo', brandingInterest: 'Intereses' };

  /** Diagnostics and GA4 aggregates: measured values or an explicit unavailable state, never placeholders. */
  loadDiagnostics(): void {
    this.diagnosticsError = null;
    this.analyticsService.getDiagnostics().subscribe({
      next: (diagnostics) => { this.diagnostics = diagnostics; this.touchUpdated(); },
      error: (error) => { this.diagnostics = null; this.diagnosticsError = describeAnalyticsError(error).message; },
    });
    this.ga4Error = null;
    this.analyticsService.getGa4Demographics(28).subscribe({
      next: (result) => { this.ga4Demographics = result; },
      error: (error) => { this.ga4Demographics = null; this.ga4Error = describeAnalyticsError(error).message; },
    });
  }

  ga4Share(row: { activeUsers: number }, total: number): number {
    return total > 0 ? Math.round((row.activeUsers / total) * 1000) / 10 : 0;
  }

  public exclusions: AdminAnalyticsExclusions | null = null;
  public exclusionsError: string | null = null;
  public exclusionFormError: string | null = null;
  public exclusionBusy = false;
  public readonly exclusionSourceLabels: Record<string, string> = { manual: 'Añadida en el panel', env: 'Configuración del servidor (ANALYTICS_EXCLUDED_IPS)', server: 'Automática: dirección del propio servidor', loopback: 'Automática: este servidor (loopback)' };

  get manualExclusions() {
    return (this.exclusions?.entries || []).filter((entry) => entry.source === 'manual');
  }

  get automaticExclusions() {
    return (this.exclusions?.entries || []).filter((entry) => entry.source !== 'manual');
  }

  loadExclusions(): void {
    this.exclusionsError = null;
    this.analyticsService.getExclusions().subscribe({
      next: (result) => { this.exclusions = result; this.touchUpdated(); },
      error: (error) => { this.exclusions = null; this.exclusionsError = describeAnalyticsError(error).message; },
    });
  }

  addExclusion(value: string, label: string, mine = false): void {
    if (this.exclusionBusy) return;
    if (!mine && !value.trim()) { this.exclusionFormError = 'Escribe una dirección IP o un rango CIDR.'; return; }
    this.exclusionBusy = true;
    this.exclusionFormError = null;
    this.analyticsService.addExclusion(mine ? { mine: true, label: label.trim() || undefined } : { value: value.trim(), label: label.trim() || undefined }).subscribe({
      next: () => { this.exclusionBusy = false; this.loadExclusions(); },
      error: (error) => { this.exclusionBusy = false; this.exclusionFormError = error?.status === 400 && error?.error?.message ? error.error.message : describeAnalyticsError(error).message; },
    });
  }

  removeExclusion(id: string | undefined, value: string): void {
    if (!id || this.exclusionBusy) return;
    if (typeof window !== 'undefined' && !window.confirm(`¿Volver a contar el tráfico de ${value}?`)) return;
    this.exclusionBusy = true;
    this.analyticsService.removeExclusion(id).subscribe({
      next: () => { this.exclusionBusy = false; this.loadExclusions(); },
      error: (error) => { this.exclusionBusy = false; this.exclusionFormError = describeAnalyticsError(error).message; },
    });
  }

  private touchUpdated(): void {
    this.lastUpdated = new Date();
    this.lastUpdatedChange.emit(this.lastUpdated);
  }
}
