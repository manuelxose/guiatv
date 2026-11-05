/**
 * Mount point of the replacement app. M01 lives under a noindex lab path so no
 * production URL (/deportes/futbol/**) is touched. See docs/sports-v2/ROUTES.md
 * for the cutover plan. All in-app links are built from this constant.
 */
export const SPORTS_V2_BASE = '/laboratorio/futbol';

export const sv2Link = (...segments: string[]): string[] => [SPORTS_V2_BASE, ...segments];
