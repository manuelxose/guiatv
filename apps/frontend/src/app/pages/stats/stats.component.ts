import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { TvReadItemDTO } from '../../api/models';
import { FaqItem, FaqSectionComponent } from '../../components/faq-section/faq-section.component';
import { PanelNavComponent } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PanelTileComponent } from '../../components/panel-tile/panel-tile.component';
import { QUE_VER_LINKS, QUE_VER_PATH } from '../../config/que-ver-nav';
import { APP_PATHS } from '../../config/route-map';
import { CatalogItem, CatalogService } from '../../services/catalog.service';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { TvDataFacade } from '../../state/tv-data.facade';
import { normalizeToCard } from '../../utils/tv-normalizers';
import { generateBreadcrumbSchema, generateItemListSchema, serializeJsonLd } from '../../utils/utils';

const BASE_URL = 'https://guiaprogramaciontv.com';
const TITLE = 'Tendencias: lo más popular hoy en TV y streaming | Guía TV';
const DESCRIPTION = 'Las películas y series más populares hoy en España: ranking del momento, tendencias en streaming y lo más visto esta noche en la TV en abierto.';
type State = { status: 'loading' | 'ready' | 'error'; items: CatalogItem[] };

/**
 * /tendencias: the popularity ranking of the catalogue, plus trending films and series in streaming
 * and tonight's free TV, inside the Qué ver section. Indexable only once the ranking has enough titles.
 */
@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [RouterModule, PanelShellComponent, PanelNavComponent, PanelTileComponent, FaqSectionComponent],
  templateUrl: './stats.component.html',
  styleUrls: ['../que-ver/que-ver.component.scss', './stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatsComponent {
  private readonly catalog = inject(CatalogService);
  private readonly facade = inject(TvDataFacade);
  private readonly meta = inject(MetaService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly chat = inject(ChatService);

  readonly appPaths = APP_PATHS;
  readonly sideLinks = QUE_VER_LINKS;
  readonly queVer = QUE_VER_PATH;
  readonly contextOpen = signal(false);
  readonly assistantAsks = ['¿Qué serie está de moda?', 'La película más vista esta semana', '¿Qué estreno merece la pena?'];

  private readonly state = toSignal(
    this.catalog.queryState({ sort: 'popular', limit: 10 }).pipe(
      map((result): State => {
        const items = (result.data?.items || []) as CatalogItem[];
        // The service answers a failed request with empty fallback data flagged `unavailable`.
        return { status: result.unavailable && !items.length ? 'error' : 'ready', items };
      }),
      catchError(() => of<State>({ status: 'error', items: [] }))
    ),
    { initialValue: { status: 'loading', items: [] } as State }
  );
  readonly status = computed(() => this.state().status);
  readonly ranking = computed(() =>
    this.state().items.map((item) => {
      const card = normalizeToCard(item);
      return { item, card, path: card.detailPath || QUE_VER_PATH, where: item.primaryPlatforms?.[0] || item.channel?.name || '', genre: item.genres?.[0] || '' };
    })
  );
  readonly top = computed(() => this.ranking()[0] || null);

  readonly movies = toSignal(
    this.facade.discoverContent({ types: ['movie'], sort: 'popular', limit: 24 }).pipe(map((r) => r.items.slice(0, 12)), catchError(() => of([]))),
    { initialValue: [] }
  );
  readonly series = toSignal(
    this.facade.discoverContent({ types: ['series'], sort: 'popular', limit: 24 }).pipe(map((r) => r.items.slice(0, 12)), catchError(() => of([]))),
    { initialValue: [] }
  );
  private readonly tonightRaw = toSignal(this.facade.getTonightPrograms({ group: 'tdt', limit: 48 }).pipe(catchError(() => of([]))), {
    initialValue: [] as TvReadItemDTO[],
  });
  /** Tonight on free TV, one per broadcast (the provider repeats feeds). */
  readonly tonight = computed(() => {
    const seen = new Set<string>();
    return this.tonightRaw()
      .filter((i) => {
        const key = `${i.program.title.trim().toLowerCase()}|${i.airing.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  });

  readonly faq = computed<FaqItem[]>(() => {
    const top3 = this.ranking().slice(0, 3).map((r) => `«${r.card.title}»${r.where ? ` (${r.where})` : ''}`);
    const series = this.series()[0] ? normalizeToCard(this.series()[0]) : null;
    return [
      {
        question: '¿Qué es lo más popular hoy en TV y streaming?',
        answer: top3.length ? `Ahora mismo encabezan el ranking ${top3.join(', ')}.` : 'El ranking de esta página se actualiza a diario con lo más popular del catálogo.',
      },
      {
        question: '¿Qué serie está de moda?',
        answer: series ? `«${series.title}»${series.platforms[0] ? `, en ${series.platforms[0]}` : ''}, es la serie más popular en streaming esta semana.` : 'En «Series en tendencia» tienes las más populares de la semana.',
      },
      {
        question: '¿Cómo se calcula el ranking?',
        answer: 'Combinamos la popularidad de cada título en las plataformas de streaming en España con su valoración y la actividad en Guía TV.',
      },
      {
        question: '¿Dónde veo estos títulos?',
        answer: 'Cada título enlaza a su ficha con las plataformas y canales donde verlo. En «Qué ver hoy» puedes filtrar por tu plataforma.',
      },
    ];
  });

  readonly structuredData = computed<SafeHtml>(() => {
    const schemas: object[] = [
      generateBreadcrumbSchema(
        [
          { name: 'Inicio', url: '/' },
          { name: 'Qué ver hoy', url: QUE_VER_PATH },
          { name: 'Tendencias', url: APP_PATHS.stats },
        ],
        BASE_URL
      ),
    ];
    if (this.ranking().length) schemas.push(generateItemListSchema(this.ranking().map((r) => r.card), 'Tendencias de TV y streaming', BASE_URL));
    return this.sanitizer.bypassSecurityTrustHtml(schemas.map((s) => `<script type="application/ld+json">${serializeJsonLd(s)}</script>`).join(''));
  });

  constructor() {
    effect(() => {
      // Indexable only with a real list: never while loading, on error or with a handful of titles.
      const indexable = this.status() === 'ready' && this.ranking().length >= 5;
      this.meta.setMetaTags({ title: TITLE, description: DESCRIPTION, canonicalUrl: APP_PATHS.stats, robots: indexable ? 'index, follow' : 'noindex, follow' });
    });
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }
}
