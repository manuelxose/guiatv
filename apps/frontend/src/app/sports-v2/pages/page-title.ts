import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SPORTS_V2_BASE } from '../sports-v2.paths';
import { useSeo } from './seo';

/**
 * Title plus a canonical URL taken from the route the page was created for (query and fragment excluded, so day and
 * tab views never become separate pages). Pages with entity data call useSeo directly. Call from a constructor.
 */
export function usePageTitle(title: () => string, description?: string, noindex = false): void {
  const segments = inject(Router).url.split(/[?#]/)[0].replace(SPORTS_V2_BASE, '').split('/').filter(Boolean);
  useSeo(() => ({ title: title(), segments, description, noindex }));
}
