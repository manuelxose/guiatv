import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

/** Assistant header: identity and how well it knows you, history, new chat, a menu for the rest, close. */
@Component({
  selector: 'app-chat-header',
  standalone: true,
  template: `
    <header class="ch">
      <div class="ch__id">
        <span class="ch__mark" aria-hidden="true">✦</span>
        <div class="ch__text">
          <h2>Asistente</h2>
          @if (isAuthenticated && knowledge !== null) {
          <button type="button" class="ch__status" (click)="openAiProfile.emit()" [attr.aria-label]="'Te conoce al ' + knowledge + ' %. Personalizar'">
            <span class="ch__meter" aria-hidden="true"><span [style.width.%]="knowledge"></span></span>
            Perfil {{ knowledge }}%
          </button>
          } @else {
          <small>TV, plataformas y fútbol</small>
          }
        </div>
      </div>

      <div class="ch__actions">
        @if (isAuthenticated) {
        <button type="button" class="ch__btn" (click)="toggleSidebar.emit()" aria-label="Tus conversaciones" title="Tus conversaciones">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" /></svg>
        </button>
        <button type="button" class="ch__btn" (click)="newConversation.emit()" aria-label="Nueva conversación" title="Nueva conversación">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        }
        <div class="ch__more">
          <button #moreButton type="button" class="ch__btn" (click)="toggleMore()" aria-label="Más opciones" aria-haspopup="menu" [attr.aria-expanded]="moreOpen">
            @if (profileIncomplete) {<span class="ch__dot" aria-hidden="true"></span>}
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>
          </button>
          @if (moreOpen) {
          <div #moreMenu class="ch__menu" role="menu" aria-label="Opciones del asistente" (keydown.escape)="closeMenuFromEvent($event)">
            @if (isAuthenticated) {
            <button type="button" role="menuitem" (click)="choose('aiProfile')"><strong>Mi perfil IA</strong><small>Lo que sabe de ti y cómo te recomienda</small></button>
            <button type="button" role="menuitem" (click)="choose('profile')"><strong>Preguntas rápidas</strong><small>Completa tus gustos en un minuto</small>@if (profileIncomplete) {<em>Pendiente</em>}</button>
            }
            <button type="button" role="menuitem" (click)="choose('social')"><strong>Chat con personas</strong><small>Tus conversaciones con otros usuarios</small></button>
          </div>
          }
        </div>
        <button type="button" class="ch__btn" (click)="closePanel.emit()" aria-label="Cerrar asistente" title="Cerrar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </header>
  `,
  styles: [`
    :host { display: block; position: relative; z-index: var(--z-header, 20); flex: 0 0 auto; }
    .ch { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 64px; padding: max(8px, var(--safe-top, 0px)) 10px 8px 14px; border-bottom: 1px solid var(--sv2-border); background: var(--sv2-surface-1); }
    .ch__id { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; overflow: hidden; }
    .ch__mark { display: grid; flex: none; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--section-accent); color: var(--section-accent-ink); font-size: 1.05rem; font-weight: 800; }
    .ch__text { display: grid; gap: 2px; min-width: 0; }
    h2 { margin: 0; color: var(--sv2-text); font-size: var(--sv2-fs-md); font-weight: 800; line-height: 1.1; }
    small { color: var(--sv2-text-muted); font-size: var(--sv2-fs-xs); }
    .ch__status { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: var(--sv2-text-muted); font: inherit; font-size: var(--sv2-fs-xs); cursor: pointer; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .ch__status:hover { color: var(--sv2-text); }
    .ch__meter { flex: none; width: 28px; height: 4px; border-radius: 999px; background: var(--sv2-surface-3); overflow: hidden; }
    .ch__meter span { display: block; height: 100%; border-radius: inherit; background: var(--section-accent); }
    .ch__actions { display: flex; flex: none; align-items: center; gap: 2px; }
    .ch__btn { position: relative; display: inline-grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 10px; background: transparent; color: var(--sv2-text-muted); cursor: pointer; }
    .ch__btn:hover { background: var(--sv2-surface-2); color: var(--sv2-text); }
    .ch__btn:focus-visible, .ch__status:focus-visible, .ch__menu button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
    .ch__btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .ch__btn circle { fill: currentColor; stroke: none; }
    .ch__dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border: 2px solid var(--sv2-surface-1); border-radius: 50%; background: var(--section-accent); }
    .ch__more { position: relative; }
    .ch__menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 5; display: grid; width: min(17rem, calc(100vw - 1.5rem)); padding: 6px; border: 1px solid var(--sv2-border-strong); border-radius: 14px; background: var(--sv2-surface-1); box-shadow: var(--sv2-shadow); }
    .ch__menu button { display: grid; gap: 2px; padding: 10px 12px; border: 0; border-radius: 10px; background: transparent; color: var(--sv2-text); text-align: left; cursor: pointer; position: relative; }
    .ch__menu button:hover { background: var(--sv2-surface-2); }
    .ch__menu strong { font-size: var(--sv2-fs-sm); }
    .ch__menu em { position: absolute; top: 10px; right: 10px; padding: 1px 8px; border-radius: 999px; background: var(--section-accent); color: var(--section-accent-ink); font-size: 0.6875rem; font-style: normal; font-weight: 800; }
    @media (max-width: 359px) { .ch__status { display: none; } }
  `],
})
export class ChatHeaderComponent {
  @Input() isAuthenticated = false;
  @Input() profileIncomplete = false;
  /** How well the assistant knows the user, 0–100; null hides the meter. */
  @Input() knowledge: number | null = null;
  @Output() newConversation = new EventEmitter<void>();
  @Output() closePanel = new EventEmitter<void>();
  @Output() openProfile = new EventEmitter<void>();
  @Output() openAiProfile = new EventEmitter<void>();
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() openSocial = new EventEmitter<void>();

  @ViewChild('moreButton') private moreButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('moreMenu') private moreMenu?: ElementRef<HTMLElement>;
  moreOpen = false;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  toggleMore(): void {
    this.moreOpen = !this.moreOpen;
    if (this.moreOpen) setTimeout(() => this.moreMenu?.nativeElement.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
  }

  choose(action: 'aiProfile' | 'profile' | 'social'): void {
    this.moreOpen = false;
    if (action === 'aiProfile') this.openAiProfile.emit();
    if (action === 'profile') this.openProfile.emit();
    if (action === 'social') this.openSocial.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.moreOpen && !this.host.nativeElement.contains(event.target as Node)) this.moreOpen = false;
  }

  closeMenuFromEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.moreOpen = false;
    setTimeout(() => this.moreButton?.nativeElement.focus());
  }
}
