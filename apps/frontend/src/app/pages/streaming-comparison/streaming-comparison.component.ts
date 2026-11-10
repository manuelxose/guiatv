import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, RouterModule } from '@angular/router';
import { FaqItem, FaqSectionComponent } from '../../components/faq-section/faq-section.component';
import { PanelNavComponent } from '../../components/panel-nav/panel-nav.component';
import { PanelShellComponent } from '../../components/panel-shell/panel-shell.component';
import { PLATAFORMAS_LINKS, STREAMING_PLATFORMS } from '../../config/plataformas-nav';
import { ChatService } from '../../services/chat.service';
import { MetaService } from '../../services/meta.service';
import { UnifiedAsyncStateComponent } from '../../components/unified-async-state/unified-async-state.component';
import { UnifiedSkeletonBlockComponent } from '../../components/unified-skeleton-block/unified-skeleton-block.component';
import { APP_PATHS } from '../../config/route-map';
import { getCatalogPlatformByKey } from '../../data/catalog-platforms.data';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';
import { AnalyticsService } from '../../services/analytics.service';
import { outboundRel } from '../../services/affiliate.service';
import {
  MonetizationFeature,
  MonetizationIntent,
  MonetizationOffer,
  MonetizationPlacement,
  MonetizationService,
  MonetizationSort,
} from '../../services/monetization.service';

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

@Component({
  selector: 'app-streaming-comparison',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    UnifiedAsyncStateComponent,
    UnifiedSkeletonBlockComponent,
    PanelShellComponent,
    PanelNavComponent,
    FaqSectionComponent,
  ],
  templateUrl: './streaming-comparison.component.html',
  styleUrls: ['../que-ver/que-ver.component.scss', './streaming-comparison.component.scss'],
})
export class StreamingComparisonComponent implements OnInit {
  readonly appPaths = APP_PATHS;
  readonly sideLinks = PLATAFORMAS_LINKS;
  contextOpen = false;
  readonly assistantAsks = ['¿Qué plataforma me conviene?', '¿Cuál es la más barata con fútbol?', '¿Netflix o HBO Max?'];
  readonly faq: FaqItem[] = [
    { question: '¿Cuál es la plataforma de streaming más barata?', answer: 'Ordena por «Precio: menor primero» para verlas de la más barata a la más cara. RTVE Play y Pluto TV son gratis.' },
    { question: '¿Qué plataforma tiene fútbol?', answer: 'Elige la prioridad «Fútbol» o la prestación «Fútbol» y verás solo las ofertas que lo incluyen.' },
    { question: '¿Los precios están actualizados?', answer: 'Cada oferta indica cuándo se verificó por última vez en la web oficial del servicio. Promociones y paquetes con operadoras pueden cambiar el precio final.' },
    { question: '¿Guía TV cobra por estas ofertas?', answer: 'Algunos enlaces son de afiliado y van marcados como patrocinados. El orden de las ofertas nunca depende de la comisión.' },
    { question: '¿Puedo ver qué tiene cada plataforma antes de contratar?', answer: 'Sí: en Plataformas tienes lo más visto y las novedades del catálogo de cada servicio, con la ficha de cada título.' },
  ];
  readonly intentOptions: FilterOption<MonetizationIntent>[] = [
    { value: 'cheapest', label: 'Más barato' },
    { value: 'football', label: 'Fútbol' },
    { value: 'movies', label: 'Cine' },
    { value: 'family', label: 'Familia' },
    { value: 'no-contract', label: 'Sin permanencia' },
    { value: 'premium', label: 'Premium' },
  ];
  readonly featureOptions: FilterOption<MonetizationFeature>[] = [
    { value: 'downloads', label: 'Descargas' },
    { value: 'live', label: 'Directo' },
    { value: 'sports', label: 'Deporte' },
    { value: 'football', label: 'Fútbol' },
    { value: 'family', label: 'Familiar' },
    { value: '4k', label: '4K' },
  ];
  readonly sortOptions: FilterOption<MonetizationSort>[] = [
    { value: 'recommended', label: 'Recomendadas' },
    { value: 'price-asc', label: 'Precio: menor primero' },
    { value: 'price-desc', label: 'Precio: mayor primero' },
    { value: 'provider', label: 'Proveedor' },
  ];

  offers: MonetizationOffer[] = [];
  selectedOfferIds = new Set<string>();
  selectedIntent?: MonetizationIntent;
  selectedFeatures = new Set<MonetizationFeature>();
  selectedSort: MonetizationSort = 'recommended';
  disclosure = '';
  generatedAt = '';
  loading = true;
  errorMessage = '';
  selectionMessage = '';
  private openedTracked = false;
  /** Provider ids whose logo URL failed: the card falls back to initials. */
  private readonly failedLogos = new Set<string>();
  private readonly monetizationService = inject(MonetizationService);
  private readonly analytics = inject(AnalyticsService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly meta = inject(MetaService);
  private readonly chat = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.meta.setMetaTags({
      title: 'Comparador de plataformas de streaming: precios y planes | Guía TV',
      description: 'Compara Netflix, Prime Video, Disney+, HBO Max, Movistar Plus+ y más: precio, pantallas, calidad, anuncios y permanencia de cada plan en España.',
      canonicalUrl: APP_PATHS.streamingComparison,
      type: 'website',
    });
    // The filters live in the URL (?prioridad=, ?prestaciones=, ?orden=): every view is a shareable link.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const intent = params.get('prioridad') || '';
      const sort = params.get('orden') || '';
      this.selectedIntent = this.isIntent(intent) ? intent : undefined;
      this.selectedFeatures = new Set(
        (params.get('prestaciones') || '').split(',').filter((f): f is MonetizationFeature => this.featureOptions.some((o) => o.value === f))
      );
      this.selectedSort = this.sortOptions.some((o) => o.value === sort) ? (sort as MonetizationSort) : 'recommended';
      this.loadOffers();
    });
  }

  get selectedFeatureList(): MonetizationFeature[] {
    return [...this.selectedFeatures];
  }

  /** Link to one filter change; a feature toggles, defaults are dropped. */
  linkFor(change: { intent?: MonetizationIntent | null; feature?: MonetizationFeature; sort?: MonetizationSort }): Params {
    const intent = change.intent === undefined ? this.selectedIntent : change.intent;
    const features = new Set(this.selectedFeatures);
    if (change.feature) {
      if (features.has(change.feature)) features.delete(change.feature);
      else features.add(change.feature);
    }
    const sort = change.sort ?? (change.intent !== undefined ? 'recommended' : this.selectedSort);
    return {
      prioridad: intent || null,
      prestaciones: features.size ? [...features].join(',') : null,
      orden: sort === 'recommended' ? null : sort,
    };
  }

  intentLabel(value: MonetizationIntent): string {
    return this.intentOptions.find((o) => o.value === value)?.label || value;
  }

  featureName(value: MonetizationFeature): string {
    return this.featureOptions.find((o) => o.value === value)?.label || value;
  }

  sortLabel(value: MonetizationSort): string {
    return this.sortOptions.find((o) => o.value === value)?.label || value;
  }

  /** Catalogue filter name for an offer's provider (the offers API says "Max", the catalogue "HBO Max"). */
  platformName(offer: MonetizationOffer): string | null {
    return STREAMING_PLATFORMS.find((p) => p.key === offer.provider.id)?.name || null;
  }

  openAssistant(): void {
    this.chat.requestToggleAssistant();
  }

  get selectedOffers(): MonetizationOffer[] {
    return this.offers.filter((offer) => this.selectedOfferIds.has(offer.id));
  }

  get hasActiveFilters(): boolean {
    return !!this.selectedIntent || this.selectedFeatures.size > 0 || this.selectedSort !== 'recommended';
  }

  loadOffers(): void {
    this.loading = true;
    this.errorMessage = '';
    this.selectionMessage = '';
    this.monetizationService.getOffers({
      intent: this.selectedIntent,
      features: [...this.selectedFeatures],
      sort: this.selectedSort,
    }).subscribe({
      next: (response) => {
        this.offers = response.items;
        this.disclosure = response.meta.disclosure;
        this.generatedAt = response.meta.generatedAt;
        this.reconcileSelection();
        this.loading = false;
        if (!this.openedTracked) {
          this.openedTracked = true;
          this.analytics.trackEvent('comparator_open', { offerCount: response.meta.total }, 'comparator_open');
        }
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.offers = [];
        this.selectedOfferIds.clear();
        this.loading = false;
        this.errorMessage = 'No hemos podido cargar las ofertas del comparador. Reinténtalo en unos segundos.';
        this.changeDetector.markForCheck();
      },
    });
  }

  changeIntent(value: string): void {
    this.selectedIntent = this.isIntent(value) ? value : undefined;
    this.selectedSort = 'recommended';
    this.analytics.trackEvent('comparator_filter', { intent: this.selectedIntent || 'all' }, 'comparator_filter');
    this.loadOffers();
  }

  changeSort(value: string): void {
    if (!this.sortOptions.some((option) => option.value === value)) return;
    this.selectedSort = value as MonetizationSort;
    this.analytics.trackEvent('comparator_filter', { sort: value }, 'comparator_filter');
    this.loadOffers();
  }

  toggleFeature(feature: MonetizationFeature): void {
    if (this.selectedFeatures.has(feature)) this.selectedFeatures.delete(feature);
    else this.selectedFeatures.add(feature);
    this.selectedFeatures = new Set(this.selectedFeatures);
    this.analytics.trackEvent('comparator_filter', { features: [...this.selectedFeatures] }, 'comparator_filter');
    this.loadOffers();
  }

  clearFilters(): void {
    this.selectedIntent = undefined;
    this.selectedFeatures.clear();
    this.selectedFeatures = new Set();
    this.selectedSort = 'recommended';
    this.loadOffers();
  }

  toggleOffer(offerId: string): void {
    if (this.selectedOfferIds.has(offerId)) {
      this.selectedOfferIds.delete(offerId);
      this.selectedOfferIds = new Set(this.selectedOfferIds);
      this.selectionMessage = 'Oferta retirada de la comparación.';
      return;
    }
    if (this.selectedOfferIds.size >= 3) {
      this.selectionMessage = 'Puedes comparar un máximo de 3 ofertas. Quita una para añadir otra.';
      return;
    }
    this.selectedOfferIds.add(offerId);
    this.selectedOfferIds = new Set(this.selectedOfferIds);
    this.selectionMessage = 'Oferta añadida a la comparación.';
    this.analytics.trackEvent('compare_offer', { offerId }, 'compare_offer');
  }

  isSelected(offerId: string): boolean {
    return this.selectedOfferIds.has(offerId);
  }

  outboundUrl(offer: MonetizationOffer, placement: MonetizationPlacement): string {
    return this.monetizationService.buildOutboundUrl(offer.outbound.path, placement);
  }

  outboundRel(offer: MonetizationOffer): string {
    return outboundRel(offer.outbound.path, offer.outbound.isSponsored);
  }

  trackOutbound(offer: MonetizationOffer, placement: MonetizationPlacement): void {
    this.analytics.trackEvent('compare_offer', {
      offerId: offer.id,
      providerId: offer.provider.id,
      placement,
      relationship: offer.outbound.relationship,
    }, 'compare_offer');
  }

  platformLogo(offer: MonetizationOffer): string {
    if (this.failedLogos.has(offer.provider.id)) return '';
    return resolvePlatformLogoUrl(offer.provider.name, getCatalogPlatformByKey(offer.provider.id)?.logoUrl);
  }

  onLogoError(offer: MonetizationOffer): void {
    this.failedLogos.add(offer.provider.id);
  }

  initials(name: string): string {
    return name.replace('+', ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase()).join('');
  }

  featureLabel(value: boolean | null, yes = 'Sí', no = 'No'): string {
    if (value === null) return 'Según plan';
    return value ? yes : no;
  }

  verificationLabel(offer: MonetizationOffer): string {
    if (offer.verification.status === 'current') return 'Verificada';
    if (offer.verification.status === 'needs_review') return 'Precio por confirmar';
    return 'Revisión pendiente';
  }

  hasDifference(field: 'price' | 'streams' | 'resolution' | 'downloads' | 'ads' | 'live' | 'commitment'): boolean {
    const values = this.selectedOffers.map((offer) => {
      if (field === 'price') return offer.pricing.monthlyAmount;
      if (field === 'streams') return offer.features.simultaneousStreams;
      if (field === 'resolution') return offer.features.maxResolution;
      if (field === 'downloads') return offer.features.downloads;
      if (field === 'ads') return offer.features.ads;
      if (field === 'live') return offer.features.liveContent;
      return offer.requirements.commitmentMonths;
    });
    return new Set(values).size > 1;
  }

  trackOffer(_index: number, offer: MonetizationOffer): string {
    return offer.id;
  }

  private reconcileSelection(): void {
    const available = new Set(this.offers.map((offer) => offer.id));
    this.selectedOfferIds = new Set([...this.selectedOfferIds].filter((id) => available.has(id)));
    for (const offer of this.offers) {
      if (this.selectedOfferIds.size >= 3) break;
      this.selectedOfferIds.add(offer.id);
    }
  }

  private isIntent(value: string): value is MonetizationIntent {
    return this.intentOptions.some((option) => option.value === value);
  }
}
