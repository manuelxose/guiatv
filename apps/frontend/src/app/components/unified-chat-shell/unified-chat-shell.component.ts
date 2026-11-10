import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { AIChatbotComponent } from '../ai-chatbot/ai-chatbot.component';
import { SocialChatPanelComponent } from './social-chat-panel/social-chat-panel.component';
import { ChatService } from '../../services/chat.service';

export type ChatDestination = 'assistant' | 'social';

@Component({
  selector: 'app-unified-chat-shell',
  standalone: true,
  imports: [CommonModule, AIChatbotComponent, SocialChatPanelComponent],
  styleUrl: './chat-theme.scss',
  template: `
    <div class="unified-chat">
      <app-ai-chatbot
        *ngIf="activeDestination === 'assistant'"
        (close)="close.emit()"
        (openSocial)="openSocialChat()"
      />

      <section
        *ngIf="activeDestination === 'social'"
        class="unified-chat__social"
        aria-labelledby="social-chat-title"
      >
        <header class="unified-chat__social-header">
          <button
            type="button"
            class="unified-chat__icon-button"
            (click)="activeDestination = 'assistant'"
            aria-label="Volver al asistente"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"></path>
            </svg>
          </button>
          <div class="unified-chat__social-title">
            <h2 id="social-chat-title">Personas</h2>
            <span *ngIf="unreadSocialCount > 0" aria-label="Mensajes sin leer">
              {{ unreadSocialCount > 9 ? '9+' : unreadSocialCount }}
            </span>
          </div>
          <button
            type="button"
            class="unified-chat__icon-button unified-chat__dismiss"
            (click)="close.emit()"
            aria-label="Cerrar o minimizar chat"
          >
            <svg class="unified-chat__dismiss-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"></path>
            </svg>
            <svg class="unified-chat__dismiss-minimize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m5 9 7 7 7-7"></path>
            </svg>
          </button>
        </header>
        <div class="unified-chat__social-body">
          <app-social-chat-panel [targetUser]="socialTargetUser" />
        </div>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; min-width: 0; height: 100%; }
    .unified-chat { width: 100%; min-width: 0; height: 100%; overflow: hidden; background: var(--portal-bg); }
    app-ai-chatbot { display: block; width: 100%; height: 100%; }
    .unified-chat__social { display: flex; min-width: 0; height: 100%; flex-direction: column; }
    .unified-chat__social-header {
      display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center;
      gap: .5rem; min-height: 64px; border-bottom: 1px solid var(--portal-border);
      background: var(--portal-surface-strong); padding: max(.35rem, var(--safe-top)) .75rem .35rem;
    }
    .unified-chat__social-title { display: flex; min-width: 0; align-items: center; justify-content: center; gap: .45rem; }
    .unified-chat__social-title h2 { margin: 0; color: var(--portal-text); font-size: var(--text-base); font-weight: 800; text-wrap: balance; }
    .unified-chat__social-title span { display: inline-flex; min-width: 1.2rem; height: 1.2rem; align-items: center; justify-content: center; border-radius: var(--radius-pill); background: var(--section-accent); color: var(--section-accent-ink); padding: 0 .3rem; font-size: .65rem; font-weight: 800; }
    .unified-chat__icon-button { display: inline-flex; width: 44px; height: 44px; align-items: center; justify-content: center; border: 0; border-radius: .8rem; background: transparent; color: var(--portal-text-muted); cursor: pointer; touch-action: manipulation; }
    .unified-chat__icon-button:hover { background: var(--portal-bg-elevated); color: var(--portal-text); }
    .unified-chat__icon-button:focus-visible { outline: 3px solid color-mix(in srgb, var(--guide-accent) 45%, transparent); outline-offset: 2px; }
    .unified-chat__icon-button svg { width: 1.15rem; height: 1.15rem; }
    .unified-chat__dismiss-minimize { display: none; }
    .unified-chat__social-body { min-height: 0; flex: 1; overflow: hidden; }
    @media (max-width: 767px) { .unified-chat__social-header { padding-top: .35rem; } .unified-chat__dismiss-close { display: none; } .unified-chat__dismiss-minimize { display: block; } }
  `],
})
export class UnifiedChatShellComponent implements OnChanges {
  @Output() close = new EventEmitter<void>();
  @Input() unreadSocialCount = 0;
  /** When set, the shell switches to social chat and opens a conversation. */
  @Input() socialTargetUser: { userId: string; nonce: number } | null = null;

  activeDestination: ChatDestination = 'assistant';

  constructor(private readonly chatService: ChatService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['socialTargetUser']?.currentValue) {
      this.activeDestination = 'social';
    }
  }

  openSocialChat(): void {
    this.chatService.activateChat();
    this.activeDestination = 'social';
  }
}
