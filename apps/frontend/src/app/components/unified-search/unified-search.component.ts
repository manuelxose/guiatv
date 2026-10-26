import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  HostListener,
  Inject,
  Input,
  OnChanges,
  OnInit,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, distinctUntilChanged, forkJoin, map, of, startWith, switchMap, timer } from 'rxjs';
import { DiscoveryService } from '../../services/discovery.service';
import { normalizeToCard } from '../../utils/tv-normalizers';
import { CatalogItem } from '../../services/catalog.service';
import { StorageService } from '../../services/storage.service';
import { FootballFacade } from '../../features/football/football.facade';
import { FootballSearchDTO } from '../../features/football/football.models';

const SEARCH_HISTORY_KEY = 'gtv.unified-search.history';

/**
 * App-wide suggestion grouping normalizes the catalogue and football APIs
 * into one keyboard-navigation model. Catalogue results retain their native
 * program/movie/series taxonomy; football contributes teams, competitions,
 * matches, and verified news.
 */
type SuggestionGroupKey = 'program' | 'catalog' | 'football';

interface UnifiedSearchSuggestion {
  id: string;
  title: string;
  meta: string;
  detailPath: string;
  group: SuggestionGroupKey;
}

interface SuggestionGroupItem {
  item: UnifiedSearchSuggestion;
  /** Index into the grouped/flattened `suggestions` array — keyboard nav's source of truth. */
  index: number;
}

interface SuggestionGroup {
  key: SuggestionGroupKey;
  label: string;
  /** Matches the shared card-accent tokens (--accent-live / --accent-streaming) — no new colors. */
  accent: 'live' | 'streaming' | 'sports';
  items: SuggestionGroupItem[];
}

@Component({
  selector: 'app-unified-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './unified-search.component.html',
  styleUrl: './unified-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedSearchComponent implements OnInit, OnChanges {
  private readonly destroyRef = inject(DestroyRef);

  @Input() query = '';
  @Input() expanded = false;

  @Output() searchChange = new EventEmitter<string>();
  @Output() searchSubmit = new EventEmitter<string>();
  @Output() suggestionOpen = new EventEmitter<void>();

  readonly control = new FormControl('', { nonNullable: true });
  suggestions: UnifiedSearchSuggestion[] = [];
  suggestionGroups: SuggestionGroup[] = [];
  history: string[] = [];
  showMenu = false;
  isLoading = false;
  focusedIndex = -1;
  @ViewChild('searchInput') private readonly searchInput?: { nativeElement: HTMLInputElement };

  private readonly isBrowser: boolean;

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly footballFacade: FootballFacade,
    private readonly router: Router,
    private readonly storage: StorageService,
    private readonly changeDetector: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    this.control.setValue(this.query || '', { emitEvent: false });
    this.history = this.readHistory();
    // Suggestions only exist in the browser. On the server, startWith + debounceTime armed a 300 ms timer that
    // Angular SSR waited for on every page (this search sits in the top nav), idle time on each render.
    if (!this.isBrowser) return;

    this.control.valueChanges
      .pipe(
        startWith(this.query || ''),
        distinctUntilChanged(),
        switchMap((value) => {
          const q = String(value || '').trim();
          this.searchChange.emit(q);
          const input = this.searchInput?.nativeElement;
          if (input && input.ownerDocument.activeElement === input) this.showMenu = true;
          this.suggestions = [];
          this.suggestionGroups = [];
          this.focusedIndex = -1;
          if (!q) {
            this.isLoading = false;
            return of([]);
          }
          this.isLoading = true;
          this.changeDetector.markForCheck();
          return timer(300).pipe(switchMap(() => forkJoin({
            catalog: this.discoveryService.search({ q, limit: 5 }).pipe(
              map((response) => response.items || []),
              catchError(() => of([] as CatalogItem[]))
            ),
            football: this.footballFacade.search(q),
          })), map(({ catalog, football }) => [
            ...catalog.filter((item) => item.detailPath || item.source === 'program').map((item) => this.catalogSuggestion(item)),
            ...this.footballSuggestions(football),
          ]));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((items) => {
        const groups = this.groupSuggestions(items);
        this.suggestionGroups = groups;
        // Flatten back out in grouped (display) order — keyboard nav and
        // openSuggestion() index into this, so traversal always follows
        // what's on screen (group by group), not the raw API order.
        this.suggestions = groups.flatMap((group) => group.items.map((entry) => entry.item));
        this.isLoading = false;
        this.focusedIndex = -1;
        this.changeDetector.markForCheck();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ('query' in changes && this.control.value !== this.query) {
      this.control.setValue(this.query || '', { emitEvent: false });
    }
  }

  get placeholder(): string {
    return 'Buscar programas, películas, series y fútbol…';
  }

  get activeDescendantId(): string | null {
    return this.showMenu && this.focusedIndex >= 0 ? `unified-search-option-${this.focusedIndex}` : null;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showMenu = false;
  }

  onFocus(): void {
    this.showMenu = true;
    this.focusedIndex = -1;
  }

  onShellClick(event: Event): void {
    event.stopPropagation();
  }

  handleKeyboard(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      this.showMenu = false;
      this.focusedIndex = -1;
      return;
    }
    if (event.target && event.target !== this.searchInput?.nativeElement) return;
    if (event.key === 'Enter' && (!this.showMenu || this.focusedIndex < 0)) {
      event.preventDefault();
      this.submit();
      return;
    }
    if (!this.showMenu) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      this.showMenu = true;
    }

    const itemsCount = this.suggestions.length > 0 ? this.suggestions.length : (!this.control.value.trim() ? this.history.length : 0);
    if (itemsCount === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusedIndex = Math.min(this.focusedIndex + 1, itemsCount - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusedIndex = Math.max(this.focusedIndex - 1, -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.focusedIndex >= 0) {
        if (this.suggestions.length > 0) {
          this.openSuggestion(this.suggestions[this.focusedIndex]);
        } else {
          this.useHistory(this.history[this.focusedIndex]);
        }
      } else {
        this.submit();
      }
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.searchInput?.nativeElement.closest('.search-shell')
        ?.querySelector(`#${this.activeDescendantId}`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  clear(): void {
    this.control.setValue('');
    this.focusedIndex = -1;
    this.focusInput();
  }

  focusInput(): void {
    this.searchInput?.nativeElement.focus();
  }

  submit(): void {
    const value = String(this.control.value || '').trim();
    this.persistHistory(value);
    this.searchSubmit.emit(value);
    this.showMenu = false;
  }

  openSuggestion(item: UnifiedSearchSuggestion): void {
    this.persistHistory(item.title);
    this.showMenu = false;
    this.suggestionOpen.emit();
    void this.router.navigateByUrl(item.detailPath);
  }

  useHistory(entry: string): void {
    this.control.setValue(entry);
    this.submit();
  }

  /**
   * Buckets suggestions by content type, matching the taxonomy the real
   * `/v2/discovery/search` / `/v2/catalog/suggest` response supports:
   * 'program' (TV guide airings) vs. 'movie'/'series' (catalog titles).
   * Empty groups are dropped so a single-type result set (e.g. the 'live'
   * tab, which only ever returns programs) still renders as one group,
   * not an empty heading.
   */
  private groupSuggestions(items: UnifiedSearchSuggestion[]): SuggestionGroup[] {
    const programItems: UnifiedSearchSuggestion[] = [];
    const catalogItems: UnifiedSearchSuggestion[] = [];
    const footballItems: UnifiedSearchSuggestion[] = [];
    for (const item of items) {
      if (item.group === 'program') programItems.push(item);
      else if (item.group === 'football') footballItems.push(item);
      else catalogItems.push(item);
    }

    // Index is assigned over the grouped/flattened order (programs, then
    // catalog titles) — not the original API order — so it lines up with
    // `this.suggestions` (built via the same group order) for keyboard nav.
    let index = 0;
    const toEntries = (list: UnifiedSearchSuggestion[]): SuggestionGroupItem[] =>
      list.map((item) => ({ item, index: index++ }));

    const groups: SuggestionGroup[] = [
      { key: 'program', label: 'Programas', accent: 'live', items: toEntries(programItems) },
      { key: 'catalog', label: 'Películas y series', accent: 'streaming', items: toEntries(catalogItems) },
      { key: 'football', label: 'Fútbol', accent: 'sports', items: toEntries(footballItems) },
    ];

    return groups.filter((group) => group.items.length > 0);
  }

  private catalogSuggestion(item: CatalogItem): UnifiedSearchSuggestion {
    return {
      id: item.catalogId,
      title: item.title,
      meta: item.channel?.name || item.primaryPlatforms?.slice(0, 2).join(' · ') || item.contentType,
      detailPath: item.detailPath || normalizeToCard(item).detailPath,
      group: item.contentType === 'program' ? 'program' : 'catalog',
    };
  }

  private footballSuggestions(result: FootballSearchDTO): UnifiedSearchSuggestion[] {
    return [
      ...result.teams.slice(0, 2).map((team) => ({
        id: `football-team:${team.id}`,
        title: team.name,
        meta: 'Equipo',
        detailPath: `/deportes/futbol/equipos/${team.slug}`,
        group: 'football' as const,
      })),
      ...result.competitions.slice(0, 2).map((competition) => ({
        id: `football-competition:${competition.id}`,
        title: competition.name,
        meta: competition.country ? `Competición · ${competition.country}` : 'Competición',
        detailPath: `/deportes/futbol/competiciones/${competition.slug}`,
        group: 'football' as const,
      })),
      ...result.matches.slice(0, 2).map((match) => ({
        id: `football-match:${match.id}`,
        title: `${match.homeTeam.name} – ${match.awayTeam.name}`,
        meta: match.competition.name,
        detailPath: `/deportes/futbol/partido/${match.slug}`,
        group: 'football' as const,
      })),
      ...result.news.slice(0, 1).map((article) => ({
        id: `football-news:${article.id}`,
        title: article.title,
        meta: 'Noticia de fútbol',
        detailPath: `/guias/${article.slug}`,
        group: 'football' as const,
      })),
    ];
  }

  private persistHistory(value: string): void {
    if (!this.isBrowser || !value) {
      return;
    }
    const next = [value, ...this.readHistory().filter((entry) => entry !== value)].slice(0, 5);
    this.storage.writeJson(SEARCH_HISTORY_KEY, next);
    this.history = next;
  }

  private readHistory(): string[] {
    if (!this.isBrowser) {
      return [];
    }
    const parsed = this.storage.readJson<unknown[]>(SEARCH_HISTORY_KEY, []);
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
  }
}
