import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TvReadItemDTO } from '../../api/models';
import { AffiliateImpressionDirective } from '../../directives/affiliate-impression.directive';
import { AffiliatePlacementKey, AffiliateResolvedOffer } from '../../interfaces/affiliate.interface';
import { AffiliateService } from '../../services/affiliate.service';
import { CatalogItem } from '../../services/catalog.service';
import { normalizeToCard } from '../../utils/tv-normalizers';
import { AffiliateCTAComponent } from '../affiliate-cta/affiliate-cta.component';

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const hhmm = (iso: string): string => (iso ? timeFmt.format(new Date(iso)) : '');
const TYPE_LABEL = { movie: 'Película', series: 'Serie', program: 'Programa' } as const;

/**
 * The card of the unified layout: image, status pill, title, one line of context and,
 * for live TV, how far the programme has gone. `tv` is 16:9 (linear TV), `poster` is 2:3
 * (streaming catalogue) and can show the affiliate "watch on…" button.
 * The whole card is one link to the detail page; the affiliate button sits outside it.
 */
@Component({
  selector: 'app-panel-tile',
  standalone: true,
  imports: [RouterLink, AffiliateCTAComponent, AffiliateImpressionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = card();
    <article class="tile" [class.tile--poster]="variant() === 'poster'" [class.tile--live]="c.liveNow">
      <a class="tile__link" [routerLink]="c.detailPath">
        <div class="tile__thumb" [class.tile__thumb--fit]="variant() === 'tv'">
          @if (imageUrl() && !imageFailed()) {
          @if (variant() === 'tv') {
          <img class="tile__thumb-bg" [src]="imageUrl()" alt="" loading="lazy" decoding="async" aria-hidden="true" />
          }
          <img class="tile__img" [src]="imageUrl()" alt="" loading="lazy" decoding="async" (error)="onImageError()" />
          }
          <span class="tile__pill" [class.tile__pill--live]="c.liveNow">{{ pill() }}</span>
        </div>
        <h3 class="tile__title">{{ c.title }}</h3>
        <p class="tile__meta">{{ meta() }}</p>
        @if (c.liveNow && c.progressPercent) {
        <span class="tile__bar" aria-hidden="true"><i [style.width.%]="c.progressPercent"></i></span>
        }
      </a>
      @if (offer(); as o) {
      <app-affiliate-cta class="tile__cta" [offer]="o" variant="primary" [appAffiliateImpression]="o" [appAffiliateImpressionContext]="impressionContext()"></app-affiliate-cta>
      }
    </article>
  `,
  styleUrl: './panel-tile.component.scss',
})
export class PanelTileComponent {
  readonly item = input.required<TvReadItemDTO | CatalogItem>();
  readonly variant = input<'tv' | 'poster'>('tv');
  /** Look up an affiliate offer for this card (only for a bounded set of cards). */
  readonly affiliate = input(false);
  readonly placement = input<AffiliatePlacementKey>('home');

  readonly card = computed(() => normalizeToCard(this.item()));
  readonly imageFailed = signal(false);
  /** Set when the API's rectangular backdrop 404s: the card falls back to the poster. */
  readonly wideFailed = signal(false);
  readonly offer = signal<AffiliateResolvedOffer | null>(null);

  readonly pill = computed(() => {
    const c = this.card();
    if (c.liveNow) return 'En directo';
    if (this.variant() === 'poster') return TYPE_LABEL[c.contentType] ?? 'Título';
    return c.startTime ? hhmm(c.startTime) : c.category || TYPE_LABEL[c.contentType];
  });

  readonly meta = computed(() => {
    const c = this.card();
    if (this.variant() === 'poster') return c.platforms.slice(0, 2).join(' · ') || c.category;
    const time = c.startTime ? `${hhmm(c.startTime)}–${hhmm(c.endTime)}` : '';
    return [c.channelName, time, c.liveNow ? '' : c.category].filter(Boolean).join(' · ');
  });

  /** Rectangular art for the 16:9 (TV) card when the API supplies it; the poster otherwise. */
  readonly imageUrl = computed(() => {
    const c = this.card();
    if (this.variant() !== 'tv') return c.image;
    return (!this.wideFailed() && c.imageWide) || c.image;
  });

  onImageError(): void {
    if (this.variant() === 'tv' && !this.wideFailed() && this.card().imageWide) {
      this.wideFailed.set(true);
      return;
    }
    this.imageFailed.set(true);
  }

  readonly impressionContext = computed(() => ({
    market: 'ES' as const,
    placement: this.placement(),
    contentType: this.card().contentType,
    contentId: this.card().id,
  }));

  private readonly affiliateService = inject(AffiliateService);

  constructor() {
    effect((onCleanup) => {
      this.offer.set(null);
      const c = this.card();
      if (!this.affiliate() || !c.id || !c.contentType) return;
      const sub = this.affiliateService
        .resolve({ market: 'ES', placement: this.placement(), contentType: c.contentType, contentId: c.id })
        .subscribe((offer) => this.offer.set(offer));
      onCleanup(() => sub.unsubscribe());
    });
  }
}
