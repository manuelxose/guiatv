import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Tracks the mobile breakpoint (<768px) so match selection can open a full screen instead of a drawer. */
@Injectable()
export class Sv2Viewport {
  /** False on the server: it only changes click behaviour, never rendered markup, so hydration is safe. */
  readonly mobile = signal(false);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID)) || typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 767px)');
    this.mobile.set(query.matches);
    const listener = (e: MediaQueryListEvent) => this.mobile.set(e.matches);
    query.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
  }
}
