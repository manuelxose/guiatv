import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, input } from '@angular/core';
import { AffiliateService, outboundRel } from '../../services/affiliate.service';
import { AffiliateCTA, AffiliateResolvedOffer } from '../../interfaces/affiliate.interface';
import { resolvePlatformLogoUrl } from '../../utils/platform-logos';

/**
 * The one reusable affiliate call-to-action for every surface (cards,
 * details, EPG, search, chatbot, football, blog, comparison). Renders
 * either from a resolved offer (the common case — supplies href, label, and
 * sponsored state) or from an explicit `cta`/`href` pair for a non-offer
 * secondary link (e.g. "Ver más ofertas"). Never contains a
 * provider-specific branch: it only reads `offer.cta`/`offer.merchant`,
 * which are already generic by the time they reach the client.
 *
 * States: primary/secondary variant, sponsored badge, loading (disabled
 * spinner button), disabled/no-offer (disabled button, no dead link), and
 * the resolved external `<a>` with correct `rel`, `target`, and a
 * screen-reader-only suffix naming the merchant and the new-tab behavior.
 */
@Component({
  selector: 'app-affiliate-cta',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './affiliate-cta.component.html',
  styleUrl: './affiliate-cta.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AffiliateCTAComponent {
  /** A fully resolved offer — supplies href, label, and sponsored state unless overridden below. */
  readonly offer = input<AffiliateResolvedOffer | null>(null);
  /** Overrides the CTA presentation without a resolved offer. Pair with `href`. */
  readonly cta = input<AffiliateCTA | null>(null);
  /** Explicit destination; required when `cta` is set without `offer`. */
  readonly href = input<string | null>(null);
  readonly variant = input<'primary' | 'secondary'>('primary');
  /** Overrides both `cta.label` and `offer.cta.label`. */
  readonly label = input<string | null>(null);
  readonly loading = input(false);
  readonly disabled = input(false);
  /** Shown instead of a dead link when there is no offer/cta and nothing is loading. */
  readonly fallbackLabel = input('No disponible');
  /** Whether this CTA navigates off-app: new tab, `rel` hardening, and a screen-reader notice. True for every affiliate outbound link. */
  readonly external = input(true);

  @Output() readonly activated = new EventEmitter<AffiliateResolvedOffer | null>();

  private readonly affiliateService = inject(AffiliateService);

  readonly resolvedCta = computed<AffiliateCTA | null>(() => this.cta() ?? this.offer()?.cta ?? null);

  readonly resolvedHref = computed<string | null>(() => {
    const explicit = this.href();
    if (explicit) return explicit;
    const offer = this.offer();
    return offer ? this.affiliateService.buildOutboundUrl(offer) : null;
  });

  readonly resolvedLabel = computed(() => this.label() ?? this.resolvedCta()?.label ?? this.fallbackLabel());

  /** merchant.logo (when the catalog record has one) with a keyword-matched
   * fallback so the button still shows a real provider icon even when the
   * merchant record itself has no logo populated. */
  readonly resolvedLogoUrl = computed(() => {
    const merchant = this.offer()?.merchant;
    if (!merchant) return '';
    return resolvePlatformLogoUrl(merchant.name, merchant.logo);
  });

  readonly sponsored = computed(() => this.resolvedCta()?.sponsored ?? false);

  readonly isBlocked = computed(
    () => this.disabled() || this.resolvedCta()?.disabled === true || !this.resolvedHref()
  );

  readonly rel = computed(() => {
    if (!this.external()) return '';
    return outboundRel(this.resolvedHref(), this.sponsored());
  });

  readonly screenReaderSuffix = computed(() => {
    const name = this.offer()?.merchant?.name;
    // Resolved labels already name the merchant ("Ir a Max"); repeating it read "Ir a Max de Max".
    const merchant = name && !this.resolvedLabel().toLowerCase().includes(name.toLowerCase()) ? name : '';
    const opensNewTab = this.external() ? 'abre una pestaña nueva' : '';
    if (merchant && opensNewTab) return `de ${merchant}; ${opensNewTab}`;
    return merchant || opensNewTab;
  });

  onActivate(): void {
    this.activated.emit(this.offer());
  }
}
