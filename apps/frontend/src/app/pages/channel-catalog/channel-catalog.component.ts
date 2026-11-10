import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, RouterModule } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import {
  TvReadChannelSummaryDTO,
  TvReadChannelsResponseDTO,
} from '../../api/models';
import { TvApiService } from '../../api/tv-api.service';
import { PanelNavComponent, PanelNavGroup } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { UnifiedAsyncStateComponent } from '../../components/unified-async-state/unified-async-state.component';
import { APP_PATHS, channelCanonicalPath } from '../../config/route-map';
import { TV_SECTION_LINKS } from '../../config/tv-section-nav';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { normalizeToCard, UnifiedCardData } from '../../utils/tv-normalizers';

/** One channel card: the channel and what it airs now and next. */
interface ChannelTile {
  id: string;
  name: string;
  path: string;
  icon: string;
  meta: string;
  now: UnifiedCardData | null;
  next: UnifiedCardData | null;
}

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

type DirectoryState =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: TvReadChannelsResponseDTO }
  | { status: 'error'; data: null };

export type ChannelAccessFilter = 'all' | 'free' | 'pay';

@Component({
  selector: 'app-channel-catalog',
  standalone: true,
  imports: [RouterModule, PanelShellComponent, PanelNavComponent, UnifiedAsyncStateComponent],
  templateUrl: './channel-catalog.component.html',
  styleUrl: './channel-catalog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelCatalogComponent {
  private readonly api = inject(TvApiService);
  private readonly metaService = inject(MetaService);
  private readonly chat = inject(ChatService);
  private readonly route = inject(ActivatedRoute);
  readonly appPaths = APP_PATHS;
  readonly sideLinks = TV_SECTION_LINKS;
  readonly groups = [
    { id: 'all', label: 'Todos' },
    { id: 'tdt', label: 'TDT' },
    { id: 'autonomico', label: 'Autonómicos' },
    { id: 'cable', label: 'Cable' },
    { id: 'movistar', label: 'Movistar+' },
    { id: 'deporte', label: 'Deportes' },
    { id: 'online', label: 'Online' },
  ] as const;
  readonly accessOptions: ReadonlyArray<{ id: ChannelAccessFilter; label: string }> = [
    { id: 'all', label: 'Cualquier acceso' },
    { id: 'free', label: 'En abierto' },
    { id: 'pay', label: 'De pago' },
  ];

  // Filters live in the URL (?grupo=, ?acceso=) so every option is a crawlable link. Search is the header's.
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly selectedGroup = computed(() => {
    const g = this.params().get('grupo') || 'all';
    return this.groups.some((x) => x.id === g) ? g : 'all';
  });
  readonly selectedAccess = computed<ChannelAccessFilter>(() => {
    const a = this.params().get('acceso');
    return a === 'free' || a === 'pay' ? a : 'all';
  });
  readonly contextOpen = signal(false);
  private readonly refreshVersion = signal(0);
  private readonly request = computed(() => ({
    group: this.selectedGroup(),
    refresh: this.refreshVersion(),
  }));
  private readonly state = toSignal(
    toObservable(this.request).pipe(
      switchMap(({ group }) =>
        this.api.getTvReadChannels('today', group === 'all' ? undefined : group).pipe(
          map((response): DirectoryState => response.data
            ? { status: 'ready', data: response.data }
            : { status: 'error', data: null }),
          catchError(() => of<DirectoryState>({ status: 'error', data: null })),
          startWith<DirectoryState>({ status: 'loading', data: null })
        )
      )
    ),
    { initialValue: { status: 'loading', data: null } as DirectoryState }
  );

  readonly status = computed(() => this.state().status);
  private readonly seo = effect(() => {
    const status = this.status();
    if (status === 'loading') return;
    if (status === 'error') {
      this.metaService.markUnavailable('Canales de televisión | Guía TV');
      return;
    }
    const group = this.groups.find((g) => g.id === this.selectedGroup());
    const named = group && group.id !== 'all' ? group : null;
    this.metaService.setMetaTags({
      title: `Guía de canales de TV${named ? ` ${named.label}` : ''}: qué echan hoy | Guía TV`,
      description:
        'Directorio de canales de TV en España con lo que emiten ahora y a continuación: TDT, autonómicos, cable, Movistar+, deportes y online. Abre la programación completa de cada canal.',
      // Each group is indexable on its own URL; access and the search box only refine it.
      canonicalUrl: named ? `/canales?grupo=${named.id}` : '/canales',
    });
  });
  readonly channels = computed(() => filterChannelDirectory(
    this.state().data?.channels || [],
    '',
    this.selectedAccess()
  ));
  readonly tiles = computed<ChannelTile[]>(() =>
    this.channels().map(({ channel, current, next }) => ({
      id: channel.id,
      name: channel.name,
      path: channelCanonicalPath(channel, channel.id),
      icon: channel.icon || '',
      meta: [channel.access === 'free' ? 'En abierto' : channel.access === 'pay' ? 'De pago' : '', channel.operator === 'unknown' ? '' : channel.operator]
        .filter(Boolean)
        .join(' · '),
      now: current ? normalizeToCard(current) : null,
      next: next ? normalizeToCard(next) : null,
    }))
  );
  /** Right panel: what starts next across the directory, soonest first. */
  readonly upNext = computed(() =>
    this.tiles()
      .filter((t) => t.next?.startTime)
      .sort((a, b) => a.next!.startTime.localeCompare(b.next!.startTime))
      .slice(0, 14)
  );
  readonly resultLabel = computed(() => {
    const count = this.channels().length;
    return `${count} ${count === 1 ? 'canal' : 'canales'}`;
  });
  readonly sideGroups = computed<PanelNavGroup[]>(() => [
    {
      title: 'Grupo de canal',
      links: this.groups.map((g) => ({ label: g.label, path: APP_PATHS.channels, queryParams: this.paramsFor({ grupo: g.id }), active: this.selectedGroup() === g.id })),
    },
    {
      title: 'Acceso',
      links: this.accessOptions.map((a) => ({ label: a.label, path: APP_PATHS.channels, queryParams: this.paramsFor({ acceso: a.id }), active: this.selectedAccess() === a.id })),
    },
  ]);
  readonly assistantAsks = ['¿Qué echan ahora en abierto?', '¿Dónde veo un canal online?', 'Canales con fútbol hoy'];

  /** Query params for a filter link: keeps the other filter and drops defaults so URLs stay clean. */
  paramsFor(change: { grupo?: string; acceso?: string }): Params {
    const grupo = change.grupo ?? this.selectedGroup();
    const acceso = change.acceso ?? this.selectedAccess();
    return { grupo: grupo === 'all' ? null : grupo, acceso: acceso === 'all' ? null : acceso };
  }

  hhmm(iso?: string): string {
    return iso ? timeFmt.format(new Date(iso)) : '';
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  retry(): void {
    this.refreshVersion.update((value) => value + 1);
  }
}

export function filterChannelDirectory(
  entries: TvReadChannelSummaryDTO[],
  query: string,
  access: ChannelAccessFilter
): TvReadChannelSummaryDTO[] {
  const normalizedQuery = normalizeSearch(query);
  return entries.filter((entry) => {
    const channel = entry.channel;
    if (
      isRawFeedName(channel.name)
      && !SITEMAP_CHANNEL_GROUPS.has(String(channel.group))
      && !REVIEWED_FEED_CHANNELS.has(channel.id)
    ) return false;
    if (access !== 'all' && channel.access !== access) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      channel.name,
      channel.operator,
      ...(channel.providers || []),
      ...(channel.aliases || []),
    ].map(normalizeSearch).join(' ');
    return haystack.includes(normalizedQuery);
  });
}

/**
 * M10-D: the groups `sitemap-channels.xml` publishes (SitemapController.buildChannelsSitemap: every `tdt` or
 * `autonomico` channel of the day that is not a verified feed alias). The directory is the only internal path to a
 * channel page, so hiding one of those would leave an indexable sitemap URL orphaned. Feed aliases never reach this
 * filter: the API drops them from the directory and their page answers 301.
 */
const SITEMAP_CHANNEL_GROUPS = new Set(['tdt', 'autonomico']);

/**
 * M10-F: raw-named feeds reviewed one by one on the production schedule of 2026-11-03 and listed by id, never by
 * name. `la8cyl_tv` (La 8 Castilla y León) shares at most 2 of its 25 airings with any other channel, so it is a
 * channel of its own and its page is the only path to some programme pages. Deliberately absent: `la2_cat_tv`
 * (its airings are LA 2's) and `aljq_tv` (8 of 8 airings are Al Jazeera English's). docs/roadmap/M10F-DELIVERY.md
 */
const REVIEWED_FEED_CHANNELS = new Set(['la8cyl_tv']);

// Names like "Xarxa_TVMataro.TV" or "ETB1.TV" are raw ids from a secondary EPG feed. Outside the sitemap groups they
// are mostly duplicates of a properly named channel and stay hidden; inside them the channel is published, so the
// ugly name is shown rather than the page left unreachable. Proper fix: name them in the channel import.
function isRawFeedName(name?: string): boolean {
  return /_|\.TV$/.test(String(name || ''));
}

function normalizeSearch(value?: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
