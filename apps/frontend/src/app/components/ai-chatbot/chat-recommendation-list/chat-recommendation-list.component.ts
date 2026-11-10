import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChatbotQueryContext,
  ChatbotRecommendation,
} from '../../../interfaces/chatbot.interface';
import { ChatContextBadgeComponent } from '../chat-context-badge/chat-context-badge.component';
import { ChatRecommendationCardComponent } from '../chat-recommendation-card/chat-recommendation-card.component';

interface RecommendationGroup {
  label: string;
  items: ChatbotRecommendation[];
}

type ExpandState = 'compact' | 'partial' | 'full';

@Component({
  selector: 'app-chat-recommendation-list',
  standalone: true,
  imports: [CommonModule, ChatContextBadgeComponent, ChatRecommendationCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; min-width: 0; }
    .rl { display: grid; gap: 8px; min-width: 0; }
    .rl__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .rl__summary { color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); }
    .rl__group { margin: 6px 0 0; color: var(--sv2-text-faint); font-size: 0.6875rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .rl__group:first-of-type { margin-top: 0; }
    .rl__more { display: flex; justify-content: center; }
    .rl__more button { width: 100%; min-height: 38px; border: 1px dashed var(--sv2-border-strong); border-radius: 12px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-sm); font-weight: 700; cursor: pointer; }
    .rl__more button:hover { border-color: var(--section-accent); border-style: solid; }
    .rl__more button.less { width: auto; border: 0; color: var(--sv2-text-muted); }
    .rl__more button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
  `],
  template: `
    <section class="rl" aria-label="Recomendaciones">
      <div class="rl__head">
        <app-chat-context-badge [queryContext]="queryContext" />
        @if (dynamicSummary) {<span class="rl__summary">{{ dynamicSummary }}</span>}
      </div>

      @for (group of groups; track group.label) {
        @if (groups.length > 1) {<p class="rl__group">{{ group.label }}</p>}
        @for (rec of group.items; track trackByRec($index, rec)) {
        <app-chat-recommendation-card
          [recommendation]="rec"
          (openDetail)="openDetail.emit($event)"
          (save)="save.emit($event)"
          (followUp)="followUp.emit($event)"
          (ignore)="ignore.emit($event)"
          (ratePositive)="ratePositive.emit($event)"
          (rateNegative)="rateNegative.emit($event)"
          (remind)="remind.emit($event)"
        />
        }
      }

      @if (hasMoreBeyondLoaded) {
      <div class="rl__more"><button type="button" (click)="showMore()">Ver {{ remainingCount }} {{ remainingCount === 1 ? 'opción' : 'opciones' }} más</button></div>
      } @else if (expandState !== 'compact') {
      <div class="rl__more"><button type="button" class="less" (click)="expandState = 'compact'">Mostrar menos</button></div>
      }
    </section>
  `,
})
export class ChatRecommendationListComponent {
  @Input() recommendations: ChatbotRecommendation[] = [];
  @Input() moreRecommendations: ChatbotRecommendation[] = [];
  @Input() queryContext?: ChatbotQueryContext;
  @Input() resultSummary = '';

  @Output() openDetail = new EventEmitter<ChatbotRecommendation>();
  @Output() save = new EventEmitter<ChatbotRecommendation>();
  @Output() followUp = new EventEmitter<ChatbotRecommendation>();
  @Output() ignore = new EventEmitter<ChatbotRecommendation>();
  @Output() ratePositive = new EventEmitter<ChatbotRecommendation>();
  @Output() rateNegative = new EventEmitter<ChatbotRecommendation>();
  @Output() remind = new EventEmitter<ChatbotRecommendation>();

  expandState: ExpandState = 'compact';

  /** Dynamic summary reflecting how many items are currently visible vs total from queryContext. */
  get dynamicSummary(): string {
    const total = this.queryContext?.primaryMatches || this.queryContext?.totalMatches || 0;
    const shown = this.visibleItems.length;
    const windowLabel = this.queryContext?.answerWindowLabel || '';
    if (!total && !this.resultSummary) return '';
    if (!total) return this.resultSummary;
    return `${shown} de ${total} resultados${windowLabel ? ' · ' + windowLabel : ''}`;
  }

  get allRecommendations(): ChatbotRecommendation[] {
    return [...this.recommendations, ...this.moreRecommendations];
  }

  /** Total results reported by the backend context (may exceed loaded items). */
  get totalFromContext(): number {
    return this.queryContext?.primaryMatches || this.queryContext?.totalMatches || this.allRecommendations.length;
  }

  /** True when there are loaded items beyond what's currently visible (partial state). */
  get hasMoreBeyondLoaded(): boolean {
    return this.allRecommendations.length > this.visibleItems.length;
  }

  /** Items currently visible based on expand state. */
  get visibleItems(): ChatbotRecommendation[] {
    if (this.expandState === 'compact') return this.allRecommendations.slice(0, 5);
    if (this.expandState === 'partial') {
      return this.allRecommendations.slice(0, 12);
    }
    return this.allRecommendations;
  }

  get remainingCount(): number {
    return Math.max(0, this.allRecommendations.length - this.visibleItems.length);
  }

  showMore(): void {
    this.expandState = this.expandState === 'compact' && this.allRecommendations.length > 12
      ? 'partial'
      : 'full';
  }

  get groups(): RecommendationGroup[] {
    const all = this.visibleItems;

    if (all.length <= 3) return [{ label: '', items: all }];

    const liveItems = all.filter((r) => r.liveNow);
    const tvItems = all.filter((r) => !r.liveNow && r.type === 'program');
    const vodItems = all.filter((r) => !r.liveNow && r.type !== 'program');

    const groups: RecommendationGroup[] = [];
    if (liveItems.length) groups.push({ label: 'En directo ahora', items: liveItems });
    if (tvItems.length) groups.push({ label: 'Televisión', items: tvItems });
    if (vodItems.length) groups.push({ label: 'Streaming / VOD', items: vodItems });

    if (groups.length <= 1) return [{ label: '', items: all }];
    return groups;
  }

  trackByRec(_index: number, rec: ChatbotRecommendation): string {
    return [
      rec.catalogId || rec.detailPath || '',
      rec.title,
      rec.channelOrPlatform || rec.channel || rec.platform || '',
      rec.startTime || rec.time || '',
    ]
      .filter(Boolean)
      .join('::');
  }

  trackByGroup(_index: number, group: RecommendationGroup): string {
    return group.label;
  }
}
