import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Follow-up questions under an answer, written as the user would ask them. */
@Component({
  selector: 'app-chat-suggestion-chips',
  standalone: true,
  template: `
    @if (suggestions.length) {
    <div class="sg" aria-label="Sigue preguntando">
      @for (suggestion of suggestions; track suggestion) {
      <button type="button" (click)="selected.emit(suggestion)">{{ suggestion }}</button>
      }
    </div>
    }
  `,
  styles: [`
    .sg { display: flex; flex-wrap: wrap; gap: 6px; }
    button { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border: 1px solid var(--sv2-border-strong); border-radius: 999px; background: transparent; color: var(--sv2-text); font: inherit; font-size: var(--sv2-fs-xs); font-weight: 600; text-align: left; cursor: pointer; transition: border-color var(--sv2-dur) var(--sv2-ease), background var(--sv2-dur) var(--sv2-ease); }
    button::before { content: '↗'; margin-right: 6px; color: var(--section-accent-text); font-weight: 800; }
    button:hover { border-color: var(--section-accent); background: var(--sv2-surface-2); }
    button:focus-visible { outline: 2px solid var(--section-accent); outline-offset: 2px; }
  `],
})
export class ChatSuggestionChipsComponent {
  @Input() suggestions: string[] = [];
  @Output() selected = new EventEmitter<string>();
}
