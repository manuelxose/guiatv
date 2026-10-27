import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserProfile } from '../../interfaces/user.interface';
import { UserService } from '../../services/user.service';
import { AdminGroupId, AdminNavGroup } from './admin.types';
import { AdminHeaderComponent } from './components/admin-header/admin-header.component';
import { AdminSidebarComponent } from './components/admin-sidebar/admin-sidebar.component';
import { AdminAnalyticsSectionComponent } from './sections/analytics/admin-analytics-section.component';
import { AdminBlogSectionComponent } from './sections/blog/admin-blog-section.component';
import { AdminContentSectionComponent } from './sections/content/admin-content-section.component';
import { AdminOperationsSectionComponent } from './sections/operations/admin-operations-section.component';
import { AdminSchedulesSectionComponent } from './sections/schedules/admin-schedules-section.component';
import { AdminSystemSectionComponent } from './sections/system/admin-system-section.component';
import { AdminUsersSectionComponent } from './sections/users/admin-users-section.component';
import { AdminCommunitySectionComponent } from './sections/community/admin-community-section.component';
import { AdminOverviewSectionComponent } from './sections/overview/admin-overview-section.component';
import { AdminAISectionComponent } from './sections/ai/admin-ai-section.component';
import { AdminAffiliateSectionComponent } from './sections/affiliate/admin-affiliate-section.component';
import { AdminEditorialSectionComponent } from './sections/editorial/admin-editorial-section.component';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [
    CommonModule,
    AdminSidebarComponent,
    AdminHeaderComponent,
    AdminOverviewSectionComponent,
    AdminAnalyticsSectionComponent,
    AdminBlogSectionComponent,
    AdminContentSectionComponent,
    AdminSchedulesSectionComponent,
    AdminOperationsSectionComponent,
    AdminUsersSectionComponent,
    AdminCommunitySectionComponent,
    AdminSystemSectionComponent,
    AdminAISectionComponent,
    AdminAffiliateSectionComponent,
    AdminEditorialSectionComponent,
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent implements OnInit {
  private readonly isBrowser: boolean;
  private static readonly DESKTOP_COLLAPSE_STORAGE_KEY = 'gtv_admin_sidebar_collapsed';

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    private readonly userService: UserService
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.desktopSidebarCollapsed =
        window.localStorage.getItem(AdminComponent.DESKTOP_COLLAPSE_STORAGE_KEY) === '1';
    }
    this.adminProfile = this.userService.getProfile();
  }

  public readonly navGroups: AdminNavGroup[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: 'M3 12h4l2-7 4 14 2-7h6',
      items: [
        { id: 'overview', label: 'Attention & health', description: 'What needs attention right now' },
      ],
    },
    {
      id: 'analytics',
      label: 'Analytics',
      icon: 'M4 19h16 M8 19V9 M13 19V5 M18 19v-7',
      items: [
        { id: 'overview', label: 'Traffic overview', description: 'Traffic, behaviour and active sessions' },
        { id: 'pages', label: 'Content performance', description: 'Top pages and engagement' },
        { id: 'live', label: 'Live activity', description: 'Current sessions' },
        { id: 'events', label: 'Event stream', description: 'Recent behaviour signals' },
      ],
    },
    {
      id: 'ai',
      label: 'AI Assistant',
      icon: 'M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
      items: [
        { id: 'dashboard', label: 'Usage & quality', description: 'Conversations, feedback and activity' },
        { id: 'editorial', label: 'Operaciones IA', description: 'Pipeline editorial, evidencia y parada de emergencia' },
      ],
    },
    {
      id: 'content',
      label: 'Content',
      icon: 'M12 3 3 8l9 5 9-5-9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5',
      items: [
        {
          id: 'blog',
          label: 'Blog Studio',
          description: 'Posts, SEO, editorial',
        },
        { id: 'channels', label: 'Channels', description: 'Catalog control' },
        { id: 'programs', label: 'Programs', description: 'Metadata audit' },
        { id: 'categories', label: 'Taxonomy', description: 'Genre and metadata coverage' },
      ],
    },
    {
      id: 'monetization',
      label: 'Monetización',
      icon: 'M3 12V4h8l9 9-8 8-9-9Z M7 7h.01',
      items: [
        { id: 'merchants', label: 'Merchants', description: 'Marcas comerciales y alias' },
        { id: 'programs', label: 'Programs', description: 'Relaciones comerciales por red y mercado' },
        { id: 'offers', label: 'Offers', description: 'Planes, precios y vigencia' },
        { id: 'networks', label: 'Networks', description: 'Redes de afiliación' },
        { id: 'placements', label: 'Placements', description: 'Ubicaciones habilitadas' },
        { id: 'verification', label: 'Verification', description: 'Revisión de datos comerciales' },
        { id: 'analytics', label: 'Analytics', description: 'Clicks, impresiones y CTR' },
      ],
    },
    {
      id: 'schedules',
      label: 'TV / EPG',
      icon: 'M3 4h18v12H3z M8 20h8 M12 16v4',
      items: [
        { id: 'epg', label: 'EPG operations', description: 'Coverage, sync and recovery' },
      ],
    },
    {
      id: 'operations',
      label: 'Operations',
      icon: 'M4 6h10 M4 12h16 M4 18h7 M17 5v2 M9 11v2 M14 17v2',
      items: [
        { id: 'overview', label: 'Attention overview', description: 'Operational health and active work' },
        { id: 'football', label: 'Football operations', description: 'Provider, fixtures and mappings' },
        { id: 'jobs', label: 'Background jobs', description: 'Queued, running and failed work' },
        { id: 'alerts', label: 'Alerts', description: 'Actionable operational conditions' },
        { id: 'events', label: 'Operational events', description: 'Structured, redacted activity' },
        { id: 'cache', label: 'Cache & runtime', description: 'Health and safe cache controls' },
      ],
    },
    {
      id: 'users',
      label: 'Users',
      icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M17 8a2.5 2.5 0 1 1 0 5 M17.5 13c2 .3 3.5 2 3.5 4',
      items: [
        { id: 'accounts', label: 'Accounts & roles', description: 'Account state and access' },
        { id: 'moderation', label: 'Reports', description: 'Moderation queue' },
      ],
    },
    {
      id: 'system',
      label: 'System',
      icon: 'M4 4h16v6H4z M4 14h16v6H4z M7 7h.01 M7 17h.01',
      items: [
        { id: 'health', label: 'System health', description: 'Service and build status' },
      ],
    },
  ];

  public activeGroup: AdminGroupId = 'overview';
  public activeItem = 'overview';
  /** Persistent icon-rail collapse — desktop only, remembered per browser. */
  public desktopSidebarCollapsed = false;
  /** Transient overlay drawer state — mobile/tablet only, never persisted. */
  public mobileSidebarOpen = false;
  public lastUpdated: Date | null = null;
  public adminProfile!: Observable<UserProfile>;

  public readonly environmentLabel = environment.production
    ? 'Production'
    : 'Development';

  ngOnInit(): void {
    this.userService.fetchProfile().subscribe();
  }

  toggleMobileSidebar(): void {
    this.mobileSidebarOpen = !this.mobileSidebarOpen;
  }

  closeMobileSidebar(): void {
    this.mobileSidebarOpen = false;
  }

  toggleDesktopSidebarCollapsed(): void {
    this.desktopSidebarCollapsed = !this.desktopSidebarCollapsed;
    if (this.isBrowser) {
      window.localStorage.setItem(
        AdminComponent.DESKTOP_COLLAPSE_STORAGE_KEY,
        this.desktopSidebarCollapsed ? '1' : '0'
      );
    }
  }

  selectSection(group: AdminGroupId, item: string): void {
    this.activeGroup = group;
    this.activeItem = item;
    this.mobileSidebarOpen = false;

    const keepsUpdated =
      group === 'overview' || group === 'analytics' || group === 'users' || group === 'content'
      || group === 'schedules' || group === 'operations' || group === 'system'
      || group === 'monetization';
    if (!keepsUpdated) {
      this.lastUpdated = null;
    }
  }

  onLastUpdated(date: Date): void {
    this.lastUpdated = date;
  }

  get activeGroupLabel(): string {
    return this.navGroups.find((group) => group.id === this.activeGroup)?.label || '';
  }

  get activeItemLabel(): string {
    const group = this.navGroups.find((item) => item.id === this.activeGroup);
    return group?.items.find((item) => item.id === this.activeItem)?.label || '';
  }

  get activeItemDescription(): string {
    const group = this.navGroups.find((item) => item.id === this.activeGroup);
    return group?.items.find((item) => item.id === this.activeItem)?.description || '';
  }
}
