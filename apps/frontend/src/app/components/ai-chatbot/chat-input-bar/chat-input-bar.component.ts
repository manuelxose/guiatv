import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  ChatbotRequestState,
  ChatbotSessionState,
  isChatbotBusyState,
} from '../../../interfaces/chatbot.interface';

@Component({
  selector: 'app-chat-input-bar',
  standalone: true,
  imports: [FormsModule, CommonModule],
  template: `
    <div class="chat-composer">
      <div
        class="chat-composer__surface"
        [class.chat-composer__surface--search]="isSearchMode"
        [class.chat-composer__surface--busy]="isBusy"
      >
        <textarea
          #chatInput
          id="assistant-message"
          name="assistant-message"
          aria-label="Mensaje para el asistente"
          autocomplete="off"
          maxlength="2000"
          [(ngModel)]="draft"
          rows="1"
          (keydown)="onKeydown($event)"
          (input)="autoResize()"
          [disabled]="inputDisabled"
          class="chat-composer__input"
          [placeholder]="isSearchMode ? 'Busca un título, canal o equipo…' : 'Pregunta qué ver ahora, esta noche o en tus plataformas…'"
        ></textarea>

        <button
          *ngIf="!isBusy; else stopButton"
          type="button"
          (click)="send()"
          [disabled]="sendDisabled"
          class="chat-composer__submit"
          aria-label="Enviar mensaje"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 5l7 7-7 7"></path>
          </svg>
        </button>
        <ng-template #stopButton>
          <button
            type="button"
            (click)="stopGeneration.emit()"
            class="chat-composer__submit chat-composer__submit--stop"
            aria-label="Detener respuesta"
          >
            <span aria-hidden="true"></span>
          </button>
        </ng-template>
      </div>

      <div *ngIf="showQuickActions" class="chat-composer__quick-actions" aria-label="Consultas rápidas">
        <button
          *ngFor="let action of quickActions"
          type="button"
          (click)="onQuickAction(action)"
          [disabled]="inputDisabled"
          class="chat-composer__quick-action"
        >
          {{ action.label }}
        </button>
      </div>

      <div class="chat-composer__meta" [class.chat-composer__meta--empty]="!statusLabel && !canRetry">
        <p
          *ngIf="statusLabel"
          class="chat-composer__status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ statusLabel }}
        </p>
        <span *ngIf="!statusLabel" class="chat-composer__shortcut">Enter para enviar · Shift+Enter para nueva línea</span>
        <button
          *ngIf="canRetry && !isBusy"
          type="button"
          class="chat-composer__retry"
          (click)="retryRequested.emit()"
          aria-label="Reintentar última consulta"
        >
          Reintentar
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .chat-composer { display: grid; gap: .55rem; min-width: 0; }
    .chat-composer__surface {
      display: flex; align-items: center; gap: .5rem; min-width: 0;
      border: 1px solid var(--sv2-border-strong); border-radius: 1.4rem;
      background: var(--sv2-bg); padding: .35rem .35rem .35rem .5rem;
      box-shadow: var(--shadow-sm); transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    .chat-composer__surface:focus-within { border-color: var(--guide-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--guide-accent) 18%, transparent); }
    .chat-composer__surface--search { border-color: var(--accent-discover); }
    .chat-composer__surface--busy { border-color: color-mix(in srgb, var(--guide-accent) 55%, var(--portal-border)); }
    .chat-composer__input {
      min-width: 0; min-height: 44px; max-height: 144px; flex: 1; resize: none;
      border: 0; outline: 0; background: transparent; color: var(--portal-text);
      padding: .65rem .5rem; font: inherit; font-size: var(--sv2-fs-md); line-height: 1.45;
    }
    .chat-composer__input::placeholder { color: var(--portal-text-muted); }
    .chat-composer__submit {
      display: inline-flex; width: 44px; height: 44px; flex: 0 0 44px; align-items: center; justify-content: center;
      border: 0; border-radius: 999px; background: var(--section-accent); color: var(--section-accent-ink);
      cursor: pointer; transition: transform 150ms ease, opacity 150ms ease, background-color 150ms ease;
      touch-action: manipulation;
    }
    .chat-composer__submit:hover:not(:disabled) { transform: translateY(-1px); }
    .chat-composer__submit:active:not(:disabled) { transform: translateY(0); }
    .chat-composer__submit:focus-visible,
    .chat-composer__quick-action:focus-visible,
    .chat-composer__retry:focus-visible { outline: 3px solid color-mix(in srgb, var(--guide-accent) 45%, transparent); outline-offset: 2px; }
    .chat-composer__submit:disabled { cursor: not-allowed; opacity: .42; }
    .chat-composer__submit svg { width: 1.2rem; height: 1.2rem; }
    .chat-composer__submit--stop { background: var(--portal-text); }
    .chat-composer__submit--stop span { width: .75rem; height: .75rem; border-radius: .18rem; background: var(--portal-bg-elevated); }
    .chat-composer__quick-actions {
      display: flex; min-width: 0; gap: .4rem; overflow-x: auto; padding: .1rem .15rem .25rem;
      overscroll-behavior-inline: contain; scrollbar-width: none;
    }
    .chat-composer__quick-actions::-webkit-scrollbar { display: none; }
    .chat-composer__quick-action {
      display: inline-flex; min-height: 44px; max-width: 12rem; flex: 0 0 auto; align-items: center; justify-content: center;
      border: 1px solid var(--assistant-chip-border); border-radius: 999px;
      background: var(--assistant-chip-bg); color: var(--assistant-chip-text); padding: .45rem .78rem;
      font-size: .72rem; font-weight: 650; cursor: pointer; touch-action: manipulation;
      transition: color 150ms ease, border-color 150ms ease, background-color 150ms ease;
      overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap;
    }
    .chat-composer__quick-action:hover:not(:disabled), .chat-composer__quick-action:active:not(:disabled) { color: var(--portal-text); border-color: var(--assistant-chip-hover-border); background: var(--assistant-chip-hover-bg); }
    .chat-composer__quick-action:disabled { opacity: .45; cursor: not-allowed; }
    .chat-composer__meta { display: flex; min-height: 1rem; align-items: center; justify-content: space-between; gap: .75rem; padding: 0 .35rem; }
    .chat-composer__status, .chat-composer__shortcut { margin: 0; color: var(--portal-text-muted); font-size: .68rem; line-height: 1.3; }
    .chat-composer__retry { border: 0; background: transparent; color: var(--guide-accent); font-size: .72rem; font-weight: 750; cursor: pointer; }
    @media (max-width: 767px) { .chat-composer__shortcut, .chat-composer__meta--empty { display: none; } }
    @media (prefers-reduced-motion: reduce) { .chat-composer__surface, .chat-composer__submit, .chat-composer__quick-action { transition: none; } }
  `],
})
export class ChatInputBarComponent implements AfterViewInit {
  /** Off on the start screen, which shows its own shortcuts. */
  @Input() showQuickActions = true;
  @Input() sessionState: ChatbotSessionState = 'unknown';
  @Input() chatState: ChatbotRequestState = 'idle';
  @Input() canRetry = false;
  @Output() messageSent = new EventEmitter<string>();
  @Output() stopGeneration = new EventEmitter<void>();
  @Output() retryRequested = new EventEmitter<void>();

  @ViewChild('chatInput') chatInput?: ElementRef<HTMLTextAreaElement>;

  draft = '';

  readonly quickActions = [
    { label: 'En TV ahora', prompt: '¿Qué puedo ver ahora mismo en televisión?' },
    { label: 'Fútbol hoy', prompt: '¿Qué partidos de fútbol hay hoy y dónde puedo verlos?' },
    { label: 'Esta noche', prompt: '¿Qué merece la pena ver esta noche?' },
    { label: 'Mis plataformas', prompt: '¿Qué puedo ver en mis plataformas?' },
    { label: 'Películas', prompt: '¿Qué películas puedo ver hoy?' },
    { label: 'Series', prompt: 'Recomiéndame una serie para ver ahora.' },
  ];

  get isBusy(): boolean { return isChatbotBusyState(this.chatState); }
  get inputDisabled(): boolean { return this.sessionState !== 'authenticated' || this.isBusy; }
  get sendDisabled(): boolean { return this.inputDisabled || !this.draft.trim(); }
  get isSearchMode(): boolean { return this.draft.trimStart().toLowerCase().startsWith('/buscar '); }

  get statusLabel(): string {
    switch (this.chatState) {
      case 'connecting': return 'Conectando con GuíaTV…';
      case 'retrieving': return 'Consultando la programación y el catálogo…';
      case 'composing': return 'Preparando una respuesta…';
      case 'streaming': return 'Respondiendo…';
      case 'recovering': return 'Recuperando la respuesta…';
      case 'cancelled': return 'Generación detenida. Puedes reintentar.';
      case 'rate_limited': return 'Hay muchas consultas. Reintenta en unos segundos.';
      case 'offline': return 'Sin conexión. Tu conversación sigue aquí.';
      case 'unavailable': return 'El asistente no está disponible. Puedes reintentar.';
      default: return '';
    }
  }

  ngAfterViewInit(): void { this.autoResize(); }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || this.sendDisabled) return;
    this.draft = '';
    this.resetTextareaHeight();
    if (text.toLowerCase().startsWith('/buscar ')) {
      const query = text.slice(8).trim();
      if (query) this.messageSent.emit(`Busca contenido: ${query}`);
      return;
    }
    this.messageSent.emit(text);
  }

  onQuickAction(action: { label: string; prompt: string }): void {
    if (action.prompt.startsWith('/')) {
      this.setDraft(action.prompt);
      return;
    }
    this.messageSent.emit(action.prompt);
  }

  setDraft(text: string): void {
    this.draft = text;
    queueMicrotask(() => {
      this.chatInput?.nativeElement.focus();
      this.autoResize();
    });
  }

  focus(): void { queueMicrotask(() => this.chatInput?.nativeElement.focus()); }

  autoResize(): void {
    const element = this.chatInput?.nativeElement;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(element.scrollHeight, 144) + 'px';
  }

  private resetTextareaHeight(): void {
    const element = this.chatInput?.nativeElement;
    if (element) element.style.height = 'auto';
  }
}
