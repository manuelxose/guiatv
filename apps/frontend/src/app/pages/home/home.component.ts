import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { catchError, of } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { FaqItem, FaqSectionComponent } from '../../components/faq-section/faq-section.component';
import { PanelNavComponent, PanelNavGroup, PanelNavLink } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { PlatformBadgeComponent } from '../../components/platform-badge/platform-badge.component';
import { UnifiedAsyncStateComponent } from '../../components/unified-async-state/unified-async-state.component';
import { UnifiedSkeletonBlockComponent } from '../../components/unified-skeleton-block/unified-skeleton-block.component';
import { PORTAL_ICON_PATHS } from '../../config/portal-navigation.config';
import { APP_PATHS, channelCanonicalPath } from '../../config/route-map';
import { FootballMatchDTO } from '../../features/football/football.models';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { PortalHomeFacade } from '../../state/portal-home.facade';
import { normalizeToCard, UnifiedCardData } from '../../utils/tv-normalizers';
import {
  generateItemListSchema,
  generateOrganizationSchema,
  generateWebApplicationSchema,
  serializeJsonLd,
} from '../../utils/utils';

const BASE_URL = 'https://guiaprogramaciontv.com';
const MADRID = 'Europe/Madrid';
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: MADRID });
const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: MADRID });
const hhmm = (iso?: string): string => (iso ? timeFmt.format(new Date(iso)) : '');

/** One row of the right panel: a channel with what it airs now and next. */
export interface ChannelNowRow {
  name: string;
  path: string;
  icon: string;
  now: UnifiedCardData | null;
  next: UnifiedCardData | null;
}

export type HomeContextTab = 'now' | 'tonight' | 'football';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PanelShellComponent,
    PanelNavComponent,
    PanelTileComponent,
    PlatformBadgeComponent,
    UnifiedSkeletonBlockComponent,
    UnifiedAsyncStateComponent,
    FaqSectionComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  readonly appPaths = APP_PATHS;
  readonly hhmm = hhmm;
  readonly error = signal<string | null>(null);
  readonly homeState = toSignal(
    this.portalHomeFacade.getHomeState().pipe(
      catchError(() => {
        this.error.set('No se pudo cargar la portada ahora mismo.');
        return of(null);
      })
    ),
    { initialValue: null }
  );
  readonly loading = computed(() => !this.error() && !this.homeState());

  readonly liveNow = computed(() => this.homeState()?.liveNow || []);
  readonly tonight = computed(() => this.homeState()?.tonight || []);
  readonly featuredPlatforms = computed(() => this.homeState()?.featuredPlatforms || []);
  readonly featuredChannels = computed(() => this.homeState()?.featuredChannels || []);
  readonly trendingItems = computed(() => this.homeState()?.trendingItems.slice(0, 8) || []);
  readonly movieHighlights = computed(() => this.homeState()?.movieHighlights.slice(0, 8) || []);
  readonly seriesHighlights = computed(() => this.homeState()?.seriesHighlights.slice(0, 8) || []);
  readonly footballHighlights = computed(() => this.homeState()?.footballHighlights || []);
  /** Guides and rankings in one block (deduplicated), the editorial entry points with most search demand. */
  readonly guidePosts = computed(() => {
    const state = this.homeState();
    const seen = new Set<string>();
    return [...(state?.editorialHub.guidePosts || []), ...(state?.rankingHighlights || [])]
      .filter((post) => post.canonicalPath && !seen.has(post.id) && seen.add(post.id))
      .slice(0, 6);
  });

  /** Films on linear TV today (global tonight feed + each featured channel's tonight), deduplicated, by start time. */
  readonly tvMovies = computed<TvReadItemDTO[]>(() => {
    const seen = new Set<string>();
    return [...this.tonight(), ...this.featuredChannels().flatMap((c) => c.tonight || [])]
      .filter((item) => normalizeToCard(item).contentType === 'movie')
      .filter((item) => {
        const key = `${item.channel.id}-${item.airing.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.airing.start.localeCompare(b.airing.start))
      .slice(0, 8);
  });

  /** "lunes, 9 de noviembre": the day the page is about (freshness for people and crawlers). */
  readonly today = dayFmt.format(new Date());

  // ── Left panel ──
  readonly sideLinks: PanelNavLink[] = [
    { label: 'Inicio', path: APP_PATHS.home, iconPath: PORTAL_ICON_PATHS.home, exact: true },
    { label: 'Qué echan ahora', path: APP_PATHS.guide, queryParams: { liveView: 'now' }, iconPath: PORTAL_ICON_PATHS.liveDot },
    { label: 'Esta noche', path: APP_PATHS.guide, queryParams: { liveView: 'night' }, iconPath: PORTAL_ICON_PATHS.clock },
    { label: 'Parrilla completa', path: APP_PATHS.guide, queryParams: { liveView: 'now' }, iconPath: PORTAL_ICON_PATHS.calendar },
    { label: 'Películas en TV', path: APP_PATHS.movies, iconPath: PORTAL_ICON_PATHS.play },
    { label: 'Series en TV', path: APP_PATHS.series, iconPath: PORTAL_ICON_PATHS.channels },
    { label: 'Fútbol hoy', path: APP_PATHS.sports, iconPath: PORTAL_ICON_PATHS.sports },
    { label: 'Mi lista', path: APP_PATHS.profile, iconPath: PORTAL_ICON_PATHS.bookmark },
  ];
  readonly sideGroups = computed<PanelNavGroup[]>(() => [
    {
      title: 'Canales',
      links: this.channelRows().map((row) => ({ label: row.name, path: row.path, logoUrl: row.icon })),
      empty: 'Cargando canales…',
    },
    {
      title: 'Guías',
      links: [
        { label: 'Precios del streaming', path: `${APP_PATHS.blog}/precios-plataformas-streaming-espana` },
        { label: 'Qué plataforma elegir', path: `${APP_PATHS.blog}/netflix-hbo-max-disney-prime-video-que-plan-elegir` },
      ],
    },
  ]);

  // ── Right panel: a remote control for right now ──
  readonly contextOpen = signal(false);
  readonly contextTab = signal<HomeContextTab>('now');
  readonly channelRows = computed<ChannelNowRow[]>(() =>
    this.featuredChannels().map(({ channel, current, next }) => ({
      name: channel.name,
      path: channelCanonicalPath(channel, channel.id),
      icon: channel.icon || '',
      now: current ? normalizeToCard(current) : null,
      next: next ? normalizeToCard(next) : null,
    }))
  );
  readonly tonightCards = computed(() =>
    [...this.tonight()].sort((a, b) => a.airing.start.localeCompare(b.airing.start)).map((item) => normalizeToCard(item))
  );
  readonly todaysMatches = computed(() =>
    [...this.footballHighlights()].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)).slice(0, 8)
  );

  // ── Assistant (opens over the right panel, see app.component) ──
  readonly assistantAsks = ['¿Qué veo esta noche?', 'Una película para hoy', '¿Dónde veo el fútbol?'];

  openAssistant(): void {
    this.chatService.requestOpenChat('portal-assistant');
  }

  // ── SEO ──
  /** Questions people search for, answered from today's data so the text is fresh every day. */
  readonly faq = computed<FaqItem[]>(() => {
    const now = this.channelRows().filter((r) => r.now).slice(0, 4);
    const night = this.tonightCards().slice(0, 4);
    const films = this.tvMovies().slice(0, 3).map((m) => normalizeToCard(m));
    const match = this.todaysMatches()[0];
    const items: FaqItem[] = [];
    if (now.length) {
      items.push({
        question: '¿Qué echan ahora en la tele?',
        answer: `Ahora mismo ${now.map((r) => `${r.name} emite «${r.now!.title}»`).join(', ')}. En TV en directo tienes todos los canales.`,
      });
    }
    if (night.length) {
      items.push({
        question: '¿Qué ponen esta noche en televisión?',
        answer: `Esta noche: ${night.map((c) => `«${c.title}» en ${c.channelName} a las ${hhmm(c.startTime)}`).join(', ')}.`,
      });
    }
    if (films.length) {
      items.push({
        question: '¿Qué películas echan hoy en la tele?',
        answer: `Hoy en TV: ${films.map((f) => `«${f.title}» (${f.channelName}, ${hhmm(f.startTime)})`).join(', ')}.`,
      });
    }
    items.push({
      question: '¿Dónde ver el fútbol hoy?',
      answer: match
        ? `${match.homeTeam.name} – ${match.awayTeam.name} (${match.competition.name}) se juega a las ${hhmm(match.kickoffAt)}${match.broadcasts.length ? ` y lo emite ${match.broadcasts.map((b) => b.channelName).join(', ')}` : ''}. En la sección de fútbol están todos los partidos y sus canales.`
        : 'En la sección de fútbol tienes los partidos de hoy con su hora y el canal que los emite.',
    });
    items.push({
      question: '¿Cómo consultar la programación de mañana?',
      answer: 'En la parrilla de TV puedes cambiar de día y ver la programación completa de los canales de TDT, autonómicos y de pago.',
    });
    return items;
  });

  readonly structuredData = computed<SafeHtml>(() => {
    const live = this.liveNow().map((item) => normalizeToCard(item));
    const schemas: object[] = [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Guía Programación TV', url: BASE_URL },
      generateOrganizationSchema(BASE_URL),
      generateWebApplicationSchema(BASE_URL),
    ];
    if (live.length) schemas.push(generateItemListSchema(live, 'Qué echan ahora en la tele', BASE_URL));
    return this.sanitizer.bypassSecurityTrustHtml(
      schemas.map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`).join('')
    );
  });

  constructor(
    private readonly portalHomeFacade: PortalHomeFacade,
    private readonly metaService: MetaService,
    private readonly sanitizer: DomSanitizer,
    private readonly chatService: ChatService
  ) {
    this.metaService.setMetaTags({
      title: 'Programación TV hoy: qué echan ahora y esta noche en la tele | Guía TV',
      description:
        'Programación de TV de hoy en España: qué echan ahora y esta noche en La 1, Antena 3, Telecinco, laSexta y todos los canales, con películas, series y fútbol y dónde verlos.',
      canonicalUrl: '/',
      type: 'website',
    });
  }

  matchPath(match: FootballMatchDTO): string {
    return `${APP_PATHS.football}/partido/${match.slug || match.id}`;
  }

  trackByPlatform(_index: number, platform: { name: string }): string {
    return platform.name;
  }
}
