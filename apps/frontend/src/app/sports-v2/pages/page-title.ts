import { effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

/** Keeps the document title in step with the data a page shows. Call from a constructor. */
export function usePageTitle(title: () => string): void {
  const doc = inject(Title);
  effect(() => doc.setTitle(`${title()} · Fútbol (vista previa) - Guía TV`));
}
