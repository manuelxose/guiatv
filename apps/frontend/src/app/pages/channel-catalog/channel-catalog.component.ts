import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import {
  TvReadChannelSummaryDTO,
  TvReadChannelsResponseDTO,
} from '../../api/models';
import { TvApiService } from '../../api/tv-api.service';
import { ChannelCardComponent } from '../../components/channel-card/channel-card.component';
import { UnifiedAsyncStateComponent } from '../../components/unified-async-state/unified-async-state.component';
import { MetaService } from '../../services/meta.service';

type DirectoryState =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: TvReadChannelsResponseDTO }
  | { status: 'error'; data: null };

export type ChannelAccessFilter = 'all' | 'free' | 'pay';

@Component({
  selector: 'app-channel-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ChannelCardComponent, UnifiedAsyncStateComponent],
  templateUrl: './channel-catalog.component.html',
  styleUrl: './channel-catalog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelCatalogComponent {
  private readonly api = inject(TvApiService);
  private readonly metaService = inject(MetaService);
  readonly groups = [
    { id: 'all', label: 'Todos' },
    { id: 'tdt', label: 'TDT' },
    { id: 'cable', label: 'Cable' },
    { id: 'movistar', label: 'Movistar+' },
    { id: 'online', label: 'Online' },
    { id: 'deporte', label: 'Deportes' },
    { id: 'autonomico', label: 'Autonómicos' },
  ] as const;
  readonly query = signal('');
  readonly selectedGroup = signal('all');
  readonly selectedAccess = signal<ChannelAccessFilter>('all');
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
    this.metaService.setMetaTags({
      title: 'Canales de televisión en España: TDT, cable y online | Guía TV',
      description:
        'Directorio de canales de TV en España con su emisión actual: TDT, cable, Movistar+, deportes, autonómicos y online. Abre la programación completa de cada canal.',
      canonicalUrl: '/canales',
    });
  });
  readonly channels = computed(() => filterChannelDirectory(
    this.state().data?.channels || [],
    this.query(),
    this.selectedAccess()
  ));
  readonly resultLabel = computed(() => {
    const count = this.channels().length;
    return `${count} ${count === 1 ? 'canal' : 'canales'}`;
  });

  selectGroup(group: string): void {
    this.selectedGroup.set(group);
  }

  selectAccess(access: ChannelAccessFilter): void {
    this.selectedAccess.set(access);
  }

  retry(): void {
    this.refreshVersion.update((value) => value + 1);
  }

  clearFilters(): void {
    this.query.set('');
    this.selectedGroup.set('all');
    this.selectedAccess.set('all');
  }

  trackByChannel(_index: number, entry: TvReadChannelSummaryDTO): string {
    return entry.channel.id;
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
    if (isRawFeedName(channel.name) && !SITEMAP_CHANNEL_GROUPS.has(String(channel.group))) return false;
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
