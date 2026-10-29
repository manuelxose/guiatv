import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  Component,
  EventEmitter,
  Inject,
  Input,
  OnDestroy,
  OnInit,
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
} from '../../../../services/admin-analytics.service';
import {
  AdminRetentionCohort,
  AdminUsersService,
} from '../../../../services/admin-users.service';
import { environment } from '../../../../../environments/environment';

const VIEW_STORAGE_KEY = 'gtv_admin_analytics_view';

@Component({
  selector: 'app-admin-analytics-section',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-analytics-section.component.html',
  styleUrls: ['./admin-analytics-section.component.scss'],
})
export class AdminAnalyticsSectionComponent implements OnInit, OnDestroy {
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

  public rangeHours = 24;
  public readonly ranges = [
    { label: '24h', value: 24 },
    { label: '7d', value: 168 },
    { label: '30d', value: 720 },
  ];

  public eventFilter: string | undefined = undefined;
  public readonly eventFilters = [
    { id: 'all', label: 'All', type: undefined },
    { id: 'page_view', label: 'Page Views', type: 'page_view' },
    { id: 'click', label: 'Clicks', type: 'click' },
    { id: 'scroll_depth', label: 'Scroll', type: 'scroll_depth' },
    { id: 'visibility', label: 'Visibility', type: 'visibility' },
    { id: 'session', label: 'Sessions', type: 'session_start' },
  ];

  public readonly analyticsTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'pages', label: 'Pages' },
    { id: 'live', label: 'Realtime' },
    { id: 'events', label: 'Events' },
    { id: 'journeys', label: 'Journeys' },
    { id: 'retention', label: 'Retention' },
  ];

  public journeys: AdminAnalyticsJourney[] = [];
  public journeysSessionsAnalyzed = 0;
  public journeysLoaded = false;
  public retentionCohorts: AdminRetentionCohort[] = [];
  public retentionLoaded = false;
  public showAllTopPages = false;
  public viewSavedMessage: string | null = null;

  private subs = new Subscription();
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
    const savedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (savedView && savedView !== this.activeItem
      && this.analyticsTabs.some((tab) => tab.id === savedView)) {
      this.activeItemChange.emit(savedView);
    }
    this.loadAnalytics();

    this.subs.add(interval(10000).subscribe(() => this.loadLive()));
    this.subs.add(interval(30000).subscribe(() => this.loadEvents()));
    this.subs.add(interval(60000).subscribe(() => this.loadOverview()));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  toggleSession(sessionId: string): void {
    const isOpening = this.expandedSessionId !== sessionId;
    this.expandedSessionId = isOpening ? sessionId : null;

    if (isOpening && this.sessionEvents[sessionId] === undefined) {
      this.sessionEvents[sessionId] = null;
      this.analyticsService.getRecentEvents(20, undefined, sessionId).subscribe({
        next: (events) => {
          this.sessionEvents[sessionId] = events;
        },
        error: () => {
          this.sessionEvents[sessionId] = [];
        },
      });
    }
  }

  isExpanded(sessionId: string): boolean {
    return this.expandedSessionId === sessionId;
  }

  selectRange(hours: number): void {
    this.rangeHours = hours;
    this.loadOverview();
  }

  selectTab(tabId: string): void {
    if (this.activeItem === tabId) return;
    this.activeItemChange.emit(tabId);
    if (tabId === 'journeys' && !this.journeysLoaded) this.loadJourneys();
    if (tabId === 'retention' && !this.retentionLoaded) this.loadRetention();
  }

  saveView(): void {
    if (!this.isBrowser) return;
    window.localStorage.setItem(VIEW_STORAGE_KEY, this.activeItem);
    this.viewSavedMessage = `Vista "${this.activeItem}" guardada como predeterminada.`;
    setTimeout(() => (this.viewSavedMessage = null), 3000);
  }

  exportCsv(): void {
    if (!this.isBrowser) return;
    const rows: string[][] = [['section', 'key', 'value']];
    if (this.overview) {
      rows.push(['overview', 'totalPageViews', String(this.overview.totalPageViews ?? 0)]);
      for (const page of this.overview.topPages || []) {
        rows.push(['top_page', page.path, String(page.count)]);
      }
      for (const day of this.overview.sessionsByDay || []) {
        rows.push(['sessions_by_day', day.date, String(day.count)]);
      }
    }
    for (const journey of this.journeys) {
      rows.push(['journey', journey.steps.join(' > '), String(journey.count)]);
    }
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guiatv-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  toggleShowAllTopPages(): void {
    this.showAllTopPages = !this.showAllTopPages;
  }

  openPagePath(path: string): void {
    if (!this.isBrowser) return;
    window.open(`${environment.SITE_URL}${path}`, '_blank', 'noopener');
  }

  selectEventFilter(type?: string): void {
    this.eventFilter = type;
    this.loadEvents();
  }

  trackBySession(_index: number, item: AdminAnalyticsLiveSession): string {
    return item.sessionId;
  }

  trackByEvent(_index: number, item: AdminAnalyticsEvent): string {
    return item.eventId;
  }

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
    const pct = Math.max(6, Math.round((count / max) * 100));
    return `${pct}%`;
  }

  getDeviceSummary(session: AdminAnalyticsLiveSession): string {
    const device = session.metadata?.device;
    const type = device?.type || (session.metadata?.uaData?.mobile ? 'mobile' : 'desktop');
    const orientation = device?.orientation;
    const touch = device?.isTouchDevice ? 'touch' : '';
    return [type, orientation, touch].filter(Boolean).join(' | ') || 'device';
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
    if (activity.isIdle) return `Idle ${activity.idleSec}s`;
    return '';
  }

  private loadAnalytics(): void {
    this.loadOverview();
    this.loadLive();
    this.loadEvents();
    if (this.activeItem === 'journeys') this.loadJourneys();
    if (this.activeItem === 'retention') this.loadRetention();
  }

  private loadJourneys(): void {
    this.analyticsService.getJourneys(7).subscribe({
      next: (result) => {
        this.journeys = result.journeys;
        this.journeysSessionsAnalyzed = result.sessionsAnalyzed;
        this.journeysLoaded = true;
      },
      error: () => {
        this.journeys = [];
        this.journeysLoaded = true;
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
      },
    });
  }

  private loadOverview(): void {
    this.analyticsService.getOverview(this.rangeHours).subscribe({
      next: (overview) => {
        this.overview = overview;
        this.error = null;
        this.touchUpdated();
      },
      error: () => {
        this.error = 'Failed to load analytics overview.';
      },
    });
  }

  private loadLive(): void {
    this.analyticsService.getLive().subscribe({
      next: (snapshot) => {
        this.activeNow = snapshot.activeCount;
        this.liveSessions = snapshot.sessions;
        this.error = null;
        this.touchUpdated();
      },
      error: () => {
        this.error = 'Failed to load live sessions.';
      },
    });
  }

  private loadEvents(): void {
    this.analyticsService.getRecentEvents(40, this.eventFilter).subscribe({
      next: (events) => {
        this.recentEvents = events;
        this.error = null;
        this.touchUpdated();
      },
      error: () => {
        this.error = 'Failed to load recent events.';
      },
    });
  }

  private touchUpdated(): void {
    this.lastUpdated = new Date();
    this.lastUpdatedChange.emit(this.lastUpdated);
  }
}
