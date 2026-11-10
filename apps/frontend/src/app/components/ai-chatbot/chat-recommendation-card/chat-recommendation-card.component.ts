import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatbotRecommendation } from '../../../interfaces/chatbot.interface';
import { resolvePlatformLogoUrl } from '../../../utils/platform-logos';
import { AffiliateCTAComponent } from '../../affiliate-cta/affiliate-cta.component';
import { AffiliateDisclosureComponent } from '../../affiliate-disclosure/affiliate-disclosure.component';
import { AffiliateImpressionDirective } from '../../../directives/affiliate-impression.directive';
import { AffiliateResolvedOffer } from '../../../interfaces/affiliate.interface';

@Component({
  selector: 'app-chat-recommendation-card',
  standalone: true,
  imports: [
    CommonModule,
    AffiliateCTAComponent,
    AffiliateDisclosureComponent,
    AffiliateImpressionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; min-width: 0; }
    .rc { position: relative; display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; padding: 10px; border: 1px solid var(--sv2-border); border-radius: 14px; background: var(--sv2-bg); transition: border-color var(--sv2-dur) var(--sv2-ease); }
    .rc:hover { border-color: var(--sv2-border-strong); }
    .rc--live { border-color: color-mix(in srgb, var(--sv2-live) 45%, var(--sv2-border)); }

    .rc__poster { position: relative; display: grid; place-items: center; width: 64px; height: 96px; padding: 0; overflow: hidden; border: 0; border-radius: 10px; background: var(--sv2-surface-2); color: var(--sv2-text-faint); font-size: 0.6875rem; font-weight: 800; cursor: pointer; }
    .rc__poster img { width: 100%; height: 100%; object-fit: cover; }
    .rc__poster:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
    /* Fixed scrims: these sit on unpredictable poster artwork, not on a themed surface. */
    .rc__rating { position: absolute; top: 4px; right: 4px; padding: 1px 5px; border-radius: 6px; background: rgba(0, 0, 0, .75); color: #f6c453; font-size: 0.625rem; font-weight: 800; }
    .rc__livetag { position: absolute; top: 4px; left: 4px; padding: 1px 5px; border-radius: 6px; background: #e53935; color: #fff; font-size: 0.5625rem; font-weight: 800; letter-spacing: .04em; }
    .rc__progress { position: absolute; right: 0; bottom: 0; left: 0; height: 4px; background: rgba(0, 0, 0, .5); }
    .rc__progress span { display: block; height: 100%; background: #e53935; }

    .rc__body { display: grid; align-content: start; gap: 4px; min-width: 0; }
    .rc__top { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
    .rc__title { flex: 1; min-width: 0; margin: 0; overflow: hidden; color: var(--sv2-text); font-size: var(--sv2-fs-sm); font-weight: 700; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .rc__title button { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .rc__title button:hover { text-decoration: underline; }
    .rc__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 0; color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); }
    .rc__meta .live { color: var(--sv2-live); font-weight: 800; }
    .rc__meta .sep { color: var(--sv2-text-faint); }
    .rc__meta .plat { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .rc__meta img { width: 16px; height: 16px; border-radius: 4px; background: #12151a; object-fit: contain; vertical-align: -3px; }
    .rc__reason { display: -webkit-box; margin: 2px 0 0; overflow: hidden; color: var(--sv2-text); font-size: var(--sv2-fs-xs); line-height: 1.4; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .rc__reason::before { content: '✦ '; color: var(--section-accent-text); font-weight: 800; }
    .rc__synopsis { margin: 4px 0 0; color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); line-height: 1.45; }

    .rc__actions { display: flex; align-items: center; gap: 0; margin-top: 2px; margin-left: -6px; }
    .rc__icon { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--sv2-text-muted); cursor: pointer; }
    .rc__icon:hover { background: var(--sv2-surface-2); color: var(--sv2-text); }
    .rc__icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .rc__icon circle { fill: currentColor; stroke: none; }
    .rc__cta { display: inline-flex; align-items: center; gap: 2px; min-height: 32px; margin-left: auto; padding: 0 12px; border: 0; border-radius: 999px; background: var(--section-accent); color: var(--section-accent-ink); font-size: var(--sv2-fs-xs); font-weight: 800; cursor: pointer; white-space: nowrap; }
    .rc__icon:focus-visible, .rc__cta:focus-visible, .rc__title button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
    .rc__offer { grid-column: 1 / -1; display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--sv2-border); min-width: 0; }

    .rc__menu { position: absolute; top: 40px; right: 8px; z-index: var(--z-dropdown, 30); display: grid; min-width: 200px; padding: 4px; border: 1px solid var(--sv2-border-strong); border-radius: 12px; background: var(--sv2-surface-1); box-shadow: var(--sv2-shadow); }
    .rc__menu button { padding: 9px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); text-align: left; cursor: pointer; }
    .rc__menu button:hover { background: var(--sv2-surface-2); }
  `],
  template: `
    <article class="rc" [class.rc--live]="isLiveNow">
      <button type="button" class="rc__poster" (click)="openDetail.emit(recommendation)" [attr.aria-label]="'Ver ficha de ' + recommendation.title">
        @if (recommendation.image) {<img [src]="recommendation.image" alt="" width="64" height="96" loading="lazy" />} @else { {{ recommendation.type === 'program' ? 'TV' : 'VOD' }} }
        @if (recommendation.rating && !isLiveNow) {<span class="rc__rating">★ {{ recommendation.rating | number: '1.1-1' }}</span>}
        @if (isLiveNow) {<span class="rc__livetag">EN VIVO</span>}
        @if (isLiveNow && liveProgress > 0) {<span class="rc__progress"><span [style.width.%]="liveProgress"></span></span>}
      </button>

      <div class="rc__body">
        <div class="rc__top">
          <h4 class="rc__title"><button type="button" (click)="openDetail.emit(recommendation)">{{ recommendation.title }}</button></h4>
          <button type="button" class="rc__icon" (click)="menuOpen = !menuOpen" aria-label="Más opciones" aria-haspopup="menu" [attr.aria-expanded]="menuOpen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></svg>
          </button>
        </div>

        <p class="rc__meta">
          @if (isLiveNow) {<span class="live">● {{ liveElapsedLabel || 'En emisión' }}</span>} @else if (timeLabel) {<span>{{ timeLabel }}</span>}
          @if (platformName) {<span class="sep" aria-hidden="true">·</span><span class="plat">@if (logo(); as src) {<img [src]="src" alt="" />}{{ platformName }}</span>}
          @if (recommendation.durationMinutes) {<span class="sep" aria-hidden="true">·</span><span>{{ recommendation.durationMinutes }} min</span>}
          @for (badge of displayBadges.slice(0, 1); track badge) {<span class="sep" aria-hidden="true">·</span><span>{{ badge }}</span>}
        </p>

        @if (recommendation.reason) {<p class="rc__reason">{{ recommendation.reason }}</p>}
        @if (synopsisOpen && recommendation.synopsis) {<p class="rc__synopsis">{{ recommendation.synopsis }}</p>}

        <div class="rc__actions">
          <button type="button" class="rc__icon" (click)="ratePositive.emit(recommendation)" [attr.aria-label]="'Me gusta ' + recommendation.title" title="Me gusta">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3Zm0 0 4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7" /></svg>
          </button>
          <button type="button" class="rc__icon" (click)="rateNegative.emit(recommendation)" [attr.aria-label]="'No me gusta ' + recommendation.title" title="No me gusta">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 13V4h3v9h-3Zm0 0-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 4H17" /></svg>
          </button>
          <button type="button" class="rc__icon" (click)="save.emit(recommendation)" [attr.aria-label]="'Guardar ' + recommendation.title + ' en mi lista'" title="Guardar en mi lista">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v13.19a.75.75 0 0 1-1.2.6L12 15.75l-5.55 4.04a.75.75 0 0 1-1.2-.6V6a1.5 1.5 0 0 1 1.5-1.5Z" /></svg>
          </button>
          @if (recommendation.startTime && !recommendation.liveNow) {
          <button type="button" class="rc__icon" (click)="remind.emit(recommendation)" [attr.aria-label]="'Recordarme ' + recommendation.title" title="Recordármelo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.86 17.08a24 24 0 0 0 5.4-1.3A9 9 0 0 1 18 9.82V9A6 6 0 1 0 6 9v.82a9 9 0 0 1-2.26 5.96c1.73.64 3.54 1.08 5.4 1.3m5.72 0a3 3 0 1 1-5.72 0" /></svg>
          </button>
          }
          <button type="button" class="rc__cta" (click)="openDetail.emit(recommendation)">Ver ficha ›</button>
        </div>
      </div>

      <!-- Affiliate offer: resolved server-side, never invented by the model; its own row so it never widens the card. -->
      @if (primaryAffiliateAction; as offer) {
      <div class="rc__offer" [appAffiliateImpression]="impressionOffer" [appAffiliateImpressionContext]="impressionContext" appAffiliateImpressionPage="chatbot">
        <app-affiliate-cta [cta]="{ label: offer.label, sponsored: offer.sponsored }" [href]="offer.outboundPath" variant="secondary"></app-affiliate-cta>
        <app-affiliate-disclosure [text]="offer.disclosure" [sponsored]="offer.sponsored" [compact]="true"></app-affiliate-disclosure>
      </div>
      }

      @if (menuOpen) {
      <div class="rc__menu" role="menu" aria-label="Acciones de la recomendación">
        <button type="button" role="menuitem" (click)="menuOpen = false; save.emit(recommendation)">Guardar en mi lista</button>
        <button type="button" role="menuitem" (click)="menuOpen = false; followUp.emit(recommendation)">Seguir hablando de este título</button>
        @if (recommendation.synopsis) {<button type="button" role="menuitem" (click)="menuOpen = false; synopsisOpen = !synopsisOpen">{{ synopsisOpen ? 'Ocultar sinopsis' : 'Ver sinopsis' }}</button>}
        @if (recommendation.startTime && !recommendation.liveNow) {<button type="button" role="menuitem" (click)="menuOpen = false; remind.emit(recommendation)">Recordármelo</button>}
        <button type="button" role="menuitem" (click)="menuOpen = false; ignore.emit(recommendation)">No me interesa</button>
      </div>
      }
    </article>
  `,
})
export class ChatRecommendationCardComponent {
  @Input({ required: true }) recommendation!: ChatbotRecommendation;
  @Output() openDetail = new EventEmitter<ChatbotRecommendation>();
  @Output() save = new EventEmitter<ChatbotRecommendation>();
  @Output() followUp = new EventEmitter<ChatbotRecommendation>();
  @Output() ignore = new EventEmitter<ChatbotRecommendation>();
  @Output() ratePositive = new EventEmitter<ChatbotRecommendation>();
  @Output() rateNegative = new EventEmitter<ChatbotRecommendation>();
  @Output() remind = new EventEmitter<ChatbotRecommendation>();

  menuOpen = false;
  synopsisOpen = false;

  /** Brand mark of the platform (channels have none: the name is enough). */
  logo(): string {
    return this.recommendation.platformLogo || (this.recommendation.platform ? resolvePlatformLogoUrl(this.recommendation.platform) : '');
  }

  private readonly elementRef = inject(ElementRef<HTMLElement>);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen) return;
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.menuOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuOpen = false;
  }

  get isLiveNow(): boolean {
    if (this.recommendation.liveNow) return true;
    const scheduledTime = this.recommendation.startTime || this.recommendation.time;
    if (!scheduledTime) return false;
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
    const now = new Date();
    const candidate = new Date();
    candidate.setHours(hours, minutes, 0, 0);
    return Math.abs(candidate.getTime() - now.getTime()) <= 2 * 60 * 60 * 1000 && candidate <= now;
  }

  get timeLabel(): string {
    if (this.isLiveNow) return 'En emisión';
    const t = this.recommendation.startTime || this.recommendation.time;
    if (!t) return this.recommendation.channel ? 'TV' : '';
    return t;
  }

  get liveElapsedLabel(): string {
    const start = this.recommendation.startTime || this.recommendation.time;
    if (!start) return '';
    const [h, m] = start.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return '';
    const now = new Date();
    const s = new Date();
    s.setHours(h, m, 0, 0);
    if (s > now) return '';
    const elapsedMin = Math.floor((now.getTime() - s.getTime()) / 60000);
    if (elapsedMin < 1) return `Empezó a las ${start}`;
    let elapsed: string;
    if (elapsedMin < 60) {
      elapsed = `${elapsedMin} min`;
    } else {
      const hrs = Math.floor(elapsedMin / 60);
      const mins = elapsedMin % 60;
      elapsed = mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
    }
    return `Empezó a las ${start} · lleva ${elapsed}`;
  }

  get liveProgress(): number {
    if (!this.recommendation.liveNow) return 0;
    const start = this.recommendation.startTime || this.recommendation.time;
    const end = this.recommendation.endTime;
    if (!start || !end) return 0;

    const now = new Date();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some(Number.isNaN)) return 0;

    const s = new Date();
    s.setHours(sh, sm, 0, 0);
    const e = new Date();
    e.setHours(eh, em, 0, 0);
    if (e <= s) e.setDate(e.getDate() + 1);

    const total = e.getTime() - s.getTime();
    const elapsed = now.getTime() - s.getTime();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }

  get primaryAffiliateAction() {
    return this.recommendation.affiliateActions?.[0] ?? null;
  }

  /** Minimal `AffiliateResolvedOffer`-shaped value — the impression directive only reads `offerId`. */
  get impressionOffer(): AffiliateResolvedOffer | null {
    const action = this.primaryAffiliateAction;
    return action ? ({ offerId: action.offerId } as AffiliateResolvedOffer) : null;
  }

  get impressionContext() {
    return {
      market: 'ES' as const,
      placement: 'chatbot-answer',
      contentType: this.recommendation.type,
      contentId: this.recommendation.catalogId,
    };
  }

  get platformName(): string {
    return (
      this.recommendation.channelOrPlatform ||
      this.recommendation.channel ||
      this.recommendation.platform ||
      ''
    );
  }

  get displayBadges(): string[] {
    const norm = (v: string) =>
      String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const exclude = new Set([norm(this.timeLabel), norm(this.platformName)]);
    return (this.recommendation.badges || [])
      .filter((b) => !exclude.has(norm(b)))
      .slice(0, 3);
  }

  trackByText(_index: number, value: string): string {
    return value;
  }
}
