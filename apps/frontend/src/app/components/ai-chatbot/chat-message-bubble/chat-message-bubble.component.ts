import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatbotRecommendation, ChatMessage } from '../../../interfaces/chatbot.interface';
import { ChatRecommendationListComponent } from '../chat-recommendation-list/chat-recommendation-list.component';
import { ChatSuggestionChipsComponent } from '../chat-suggestion-chips/chat-suggestion-chips.component';
import { ChatCommunityChooserComponent } from '../chat-community-chooser/chat-community-chooser.component';
import { MarkdownPipe } from '../../../pipes/markdown.pipe';
import { AffiliateCTAComponent } from '../../affiliate-cta/affiliate-cta.component';
import { AffiliateDisclosureComponent } from '../../affiliate-disclosure/affiliate-disclosure.component';

@Component({
  selector: 'app-chat-message-bubble',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ChatRecommendationListComponent,
    ChatSuggestionChipsComponent,
    ChatCommunityChooserComponent,
    MarkdownPipe,
    AffiliateCTAComponent,
    AffiliateDisclosureComponent,
  ],
  template: `
    <div class="msg" [class.msg--user]="message.role === 'user'" [class.msg--wide]="!!message.recommendations?.length || !!message.matches?.length">
      @if (message.role !== 'user') {<span class="msg__mark" aria-hidden="true">✦</span>}
      <div class="msg__body">
        @if ((message.isLoading && !message.isStreaming) || message.isThinking) {
        <div class="msg__thinking" role="status">
          <span class="msg__dots" aria-hidden="true"><i></i><i></i><i></i></span>
          {{ message.isThinking ? 'Buscando en la parrilla y en tus plataformas…' : 'Pensando…' }}
        </div>
        } @else {
          @if (message.role === 'user') {
          <p class="msg__bubble">{{ message.content }}</p>
          } @else {
          <div class="chat-prose" [innerHTML]="displayContent | markdown"></div>
          @if (message.isStreaming) {<span class="msg__cursor" aria-hidden="true"></span>}
          }

          <!-- Recommendations -->
          <app-chat-recommendation-list
            *ngIf="!message.isStreaming && message.recommendations?.length"
            [recommendations]="message.recommendations!"
            [moreRecommendations]="message.moreRecommendations || []"
            [queryContext]="message.queryContext"
            [resultSummary]="resultSummary"
            (openDetail)="openDetail.emit($event)"
            (save)="save.emit($event)"
            (followUp)="followUp.emit($event)"
            (ignore)="ignore.emit($event)"
            (ratePositive)="ratePositive.emit($event)"
            (rateNegative)="rateNegative.emit($event)"
            (remind)="remind.emit($event)"
          />

          <!-- Football matches -->
          @if (!message.isStreaming && message.matches?.length) {
          <div class="msg__matches" aria-label="Partidos de fútbol">
            @for (match of message.matches; track match.detailPath) {
            <div class="match">
              <a [href]="match.detailPath" class="match__link">
                <span class="match__meta"><span>{{ match.competition }}</span><time [attr.datetime]="match.kickoffAt">{{ match.kickoffAt | date: 'EEE d · HH:mm' }}</time></span>
                <span class="match__team"><span>{{ match.homeTeam }}</span><b>{{ match.homeScore ?? '' }}</b></span>
                <span class="match__team"><span>{{ match.awayTeam }}</span><b>{{ match.awayScore ?? '' }}</b></span>
                <span class="match__tv">{{ match.broadcasters.length ? match.broadcasters[0].name : 'Emisión por confirmar' }}</span>
              </a>
              @if (match.broadcasters[0]?.affiliateActions?.[0]; as offer) {
              <div class="match__offer">
                <app-affiliate-cta [cta]="{ label: offer.label, sponsored: offer.sponsored }" [href]="offer.outboundPath" variant="secondary"></app-affiliate-cta>
              </div>
              }
            </div>
            }
            <app-affiliate-disclosure *ngIf="hasFootballAffiliateOffer" [compact]="true"></app-affiliate-disclosure>
          </div>
          }

          <!-- Autonomic community chooser -->
          <app-chat-community-chooser
            *ngIf="!message.isStreaming && showAutonomicPrompt"
            [savedCommunity]="savedCommunity"
            [promptText]="autonomicPromptText"
            [communities]="autonomousCommunities"
            (useSaved)="useSavedCommunity.emit()"
            (communitySelected)="communitySelected.emit($event)"
            (declined)="autonomicsDeclined.emit()"
          />

          <!-- Follow-up suggestions -->
          <app-chat-suggestion-chips
            *ngIf="!message.isStreaming && message.id !== 'welcome'"
            [suggestions]="filteredSuggestions"
            (selected)="suggestionSelected.emit($event)"
          />

          <!-- Actions: copy and feedback (assistant answers only) -->
          @if (!message.isStreaming && message.role === 'assistant' && message.id !== 'welcome' && !message.isLoading) {
          <div class="msg__actions">
            <button type="button" (click)="copy()" [attr.aria-label]="copied ? 'Copiado' : 'Copiar respuesta'" [title]="copied ? 'Copiado' : 'Copiar'">
              @if (copied) {<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>} @else {<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>}
            </button>
            <button type="button" (click)="feedbackPositive.emit(message)" [class.on]="message.feedback?.rating === 'positive'" [disabled]="!!message.feedback" aria-label="Buena respuesta" title="Buena respuesta">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3Zm0 0 4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7" /></svg>
            </button>
            <button type="button" (click)="feedbackNegative.emit(message)" [class.on-neg]="message.feedback?.rating === 'negative'" [disabled]="!!message.feedback" aria-label="Mala respuesta" title="Mala respuesta">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 13V4h3v9h-3Zm0 0-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 4H17" /></svg>
            </button>
            @if (message.feedback) {<span class="msg__thanks">Gracias, lo tendré en cuenta</span>}
            @if (relativeTime) {<span class="msg__time">{{ relativeTime }}</span>}
          </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .msg { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
    .msg--user { justify-content: flex-end; }
    .msg__mark { display: grid; flex: none; place-items: center; width: 28px; height: 28px; margin-top: 2px; border-radius: 9px; background: var(--section-accent); color: var(--section-accent-ink); font-size: .85rem; font-weight: 800; }
    .msg__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0; max-width: 100%; flex: 1; }
    .msg__body > * { min-width: 0; }
    /* Cards and matches use the full panel width, under the assistant mark too (38px = mark + gap). */
    .msg--wide app-chat-recommendation-list, .msg--wide .msg__matches, .msg--wide app-chat-community-chooser, .msg--wide app-chat-suggestion-chips { margin-left: -38px; }
    .msg--user .msg__body { flex: 0 1 auto; max-width: 85%; justify-items: end; }
    .msg__bubble { margin: 0; padding: 10px 14px; border-radius: 18px 18px 6px 18px; background: var(--section-accent); color: var(--section-accent-ink); font-size: var(--sv2-fs-sm); line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }

    .msg__thinking { display: inline-flex; align-items: center; gap: 10px; color: var(--sv2-text-muted); font-size: var(--sv2-fs-sm); }
    .msg__dots { display: inline-flex; gap: 4px; }
    .msg__dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--section-accent); animation: msg-dot 1.2s ease-in-out infinite; }
    .msg__dots i:nth-child(2) { animation-delay: .15s; }
    .msg__dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes msg-dot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    .msg__cursor { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: var(--section-accent); animation: msg-blink .8s step-end infinite; }
    @keyframes msg-blink { 50% { opacity: 0; } }

    .msg__actions { display: flex; align-items: center; gap: 2px; }
    .msg__actions button { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--sv2-text-faint); cursor: pointer; }
    .msg__actions button:hover:not(:disabled) { background: var(--sv2-surface-2); color: var(--sv2-text); }
    .msg__actions button:disabled { cursor: default; }
    .msg__actions button.on { color: var(--section-accent-text); }
    .msg__actions button.on-neg { color: var(--sv2-live); }
    .msg__actions button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 1px; }
    .msg__actions svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .msg__thanks, .msg__time { margin-left: 6px; color: var(--sv2-text-faint); font-size: var(--sv2-fs-xs); }
    .msg__time { margin-left: auto; }

    .msg__matches { display: grid; gap: 8px; }
    .match { overflow: hidden; border: 1px solid var(--sv2-border); border-radius: 12px; background: var(--sv2-bg); }
    .match:hover { border-color: var(--section-accent); }
    .match__link { display: grid; gap: 4px; padding: 10px 12px; color: inherit; text-decoration: none; }
    .match__meta { display: flex; justify-content: space-between; color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); text-transform: capitalize; }
    .match__team { display: flex; justify-content: space-between; font-size: var(--sv2-fs-sm); font-weight: 700; }
    .match__tv { justify-self: start; margin-top: 2px; padding: 2px 8px; border-radius: 999px; background: #12151a; color: #f1f3f6; font-size: .6875rem; font-weight: 700; }
    .match__offer { display: flex; justify-content: flex-end; padding: 8px 12px; border-top: 1px solid var(--sv2-border); }

    @media (prefers-reduced-motion: reduce) { .msg__dots i, .msg__cursor { animation: none; opacity: .7; } }

    /* Markdown of assistant answers */
    :host ::ng-deep .chat-prose {
      color: var(--sv2-text); font-size: var(--sv2-fs-md); line-height: 1.6; overflow-wrap: break-word;
      p { margin: 0 0 .6em; }
      p:last-child { margin-bottom: 0; }
      strong, b { font-weight: 700; }
      h1, h2, h3, h4 { margin: .8em 0 .3em; font-size: 1em; font-weight: 800; }
      ul, ol { margin: .3em 0 .6em; padding-left: 1.2em; }
      ul { list-style: disc; }
      ol { list-style: decimal; }
      li { margin-bottom: .2em; }
      li::marker { color: var(--section-accent-text); }
      a { color: var(--section-accent-text); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
      code { padding: .1em .35em; border-radius: 6px; background: var(--sv2-surface-2); font-size: .85em; }
      pre { overflow-x: auto; padding: .75em 1em; border-radius: 10px; background: var(--sv2-bg); code { padding: 0; background: none; } }
      blockquote { margin: .5em 0; padding: .5em .75em; border-left: 3px solid var(--section-accent); color: var(--sv2-text-muted); }
    }
  `],

})
export class ChatMessageBubbleComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) message!: ChatMessage;
  @Input() resultSummary = '';
  @Input() filteredSuggestions: string[] = [];
  @Input() showAutonomicPrompt = false;
  @Input() savedCommunity: string | null = null;
  @Input() autonomicPromptText = '';
  @Input() autonomousCommunities: string[] = [];

  @Output() openDetail = new EventEmitter<ChatbotRecommendation>();
  @Output() save = new EventEmitter<ChatbotRecommendation>();
  @Output() followUp = new EventEmitter<ChatbotRecommendation>();
  @Output() ignore = new EventEmitter<ChatbotRecommendation>();
  @Output() ratePositive = new EventEmitter<ChatbotRecommendation>();
  @Output() rateNegative = new EventEmitter<ChatbotRecommendation>();
  @Output() suggestionSelected = new EventEmitter<string>();
  @Output() useSavedCommunity = new EventEmitter<void>();
  @Output() communitySelected = new EventEmitter<string>();
  @Output() autonomicsDeclined = new EventEmitter<void>();
  @Output() revealComplete = new EventEmitter<void>();
  @Output() feedbackPositive = new EventEmitter<ChatMessage>();
  @Output() feedbackNegative = new EventEmitter<ChatMessage>();
  @Output() remind = new EventEmitter<ChatbotRecommendation>();

  displayContent = '';
  copied = false;

  /** Copies the answer as plain text (markdown markers stripped). */
  copy(): void {
    const text = String(this.message.content || '').replace(/[*_`#>]/g, '');
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied = true;
      this.cdr.markForCheck();
      setTimeout(() => {
        this.copied = false;
        this.cdr.markForCheck();
      }, 2000);
    });
  }
  relativeTime = '';

  get hasFootballAffiliateOffer(): boolean {
    return (this.message.matches || []).some((match) => match.broadcasters[0]?.affiliateActions?.[0]?.sponsored);
  }


  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['message']) {
      this.updateContent();
      this.updateRelativeTime();
      this.startTimestampTimer();
    }
  }

  ngOnDestroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  private updateContent(): void {
    const msg = this.message;
    if (!msg || (msg.isLoading && !msg.isStreaming)) {
      this.displayContent = '';
      return;
    }
    this.displayContent = msg.content;
  }

  private startTimestampTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.timerInterval = setInterval(() => this.updateRelativeTime(), 30_000);
  }

  private updateRelativeTime(): void {
    if (!this.message?.timestamp) {
      this.relativeTime = '';
      return;
    }

    const now = Date.now();
    const then = new Date(this.message.timestamp).getTime();
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 10) {
      this.relativeTime = 'ahora';
    } else if (diffSec < 60) {
      this.relativeTime = `hace ${diffSec}s`;
    } else if (diffSec < 3600) {
      const minutes = Math.floor(diffSec / 60);
      this.relativeTime = `hace ${minutes} min`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      this.relativeTime = `hace ${hours}h`;
    } else {
      const date = new Date(this.message.timestamp);
      this.relativeTime = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    }
  }
}
