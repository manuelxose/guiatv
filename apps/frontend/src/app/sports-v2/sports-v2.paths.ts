/** Public mount of the football section (the identity the legacy section already had). All in-app links derive from it. */
export const SPORTS_V2_BASE = '/deportes/futbol';

export const sv2Link = (...segments: string[]): string[] => [SPORTS_V2_BASE, ...segments];
