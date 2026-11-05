import { Component, HostListener, Input } from '@angular/core';

let nextId = 0;

/** Small "?" that explains a figure or table on hover, keyboard focus or tap, instead of permanent helper text. */
@Component({
  selector: 'app-info-tip',
  standalone: true,
  template: `
    <span class="tip" [class.tip--open]="open">
      <button type="button" class="tip__button" [attr.aria-label]="'Qué significa: ' + label" [attr.aria-describedby]="id" [attr.aria-expanded]="open" (click)="open = !open">?</button>
      <span class="tip__bubble" role="tooltip" [id]="id">{{ text }}</span>
    </span>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .tip { position: relative; display: inline-flex; }
    .tip__button { position: relative; width: 1.1rem; height: 1.1rem; padding: 0; border: 1px solid var(--portal-border-strong, currentColor); border-radius: 50%; background: transparent; color: var(--portal-text-soft); font-size: .7rem; font-weight: 700; line-height: 1; cursor: help; }
    /* 44x44 touch target without enlarging the icon. */
    .tip__button::after { content: ''; position: absolute; inset: -.85rem; }
    .tip__button:hover, .tip__button:focus-visible { color: var(--portal-text); border-color: var(--portal-text); }
    .tip__button:focus-visible { outline: 2px solid var(--accent-streaming); outline-offset: 2px; }
    /* Hoverable (the pointer can move onto the bubble) and dismissible with Esc, per WCAG 1.4.13. */
    .tip__bubble { position: absolute; z-index: 20; left: 50%; top: calc(100% + .4rem); width: max-content; max-width: min(18rem, calc(100vw - 2rem)); transform: translateX(-50%); padding: .5rem .65rem; border: 1px solid var(--portal-border-strong, var(--portal-border)); border-radius: .5rem; background: var(--portal-surface-strong, #222); color: var(--portal-text); font-size: .75rem; font-weight: 400; line-height: 1.4; text-align: left; white-space: normal; box-shadow: 0 6px 20px rgb(0 0 0 / .35); visibility: hidden; opacity: 0; transition: opacity .12s; }
    .tip:hover .tip__bubble, .tip:focus-within .tip__bubble, .tip--open .tip__bubble { visibility: visible; opacity: 1; }
    @media (max-width: 600px) { .tip { position: static; } .tip__bubble { left: 1rem; right: 1rem; top: auto; transform: none; width: auto; max-width: none; margin-top: .4rem; } }
    @media (prefers-reduced-motion: reduce) { .tip__bubble { transition: none; } }
  `],
})
export class InfoTipComponent {
  @Input({ required: true }) text = '';
  /** Short name of what is explained, for screen readers. */
  @Input() label = 'esta métrica';
  readonly id = `info-tip-${nextId++}`;
  open = false;

  @HostListener('keydown.escape') close(): void {
    this.open = false;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  @HostListener('document:click', ['$event']) outside(event: Event): void {
    if (this.open && !(event.target as HTMLElement | null)?.closest?.(`[aria-describedby="${this.id}"]`)) this.open = false;
  }
}
