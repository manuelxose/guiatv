/**
 * Display helpers for IP-based locations in the admin panel. They only format what the backend stored: nothing is
 * inferred, and unknown or imprecise locations are labelled as such (an IP location is an approximate area, never a
 * person's position).
 */
export interface GeoFields {
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  geo?: { status?: string; source?: string; regionName?: string; accuracyRadiusKm?: number; asn?: number; asOrg?: string; db?: string };
}

const UNKNOWN = 'Desconocido';
let regionNames: Intl.DisplayNames | null | undefined;

/** Spanish country name for an ISO 3166-1 alpha-2 code ("ES" → "España"); unknown values are returned as is. */
export function countryName(code?: string | null): string {
  if (!code || code === UNKNOWN) return 'Ubicación desconocida';
  if (!/^[A-Z]{2}$/.test(code)) return code;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['es'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) || code;
  } catch {
    return code;
  }
}

/** Flag emoji for an ISO alpha-2 code, or an empty string. */
export function countryFlag(code?: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/** Region display: the stored name when the GeoIP database gave one, else its code. */
export function regionLabel(region?: string, regionName?: string): string {
  if (regionName) return regionName;
  if (!region || region === UNKNOWN) return '';
  return region;
}

/** "Madrid, Comunidad de Madrid, España" with whatever parts are known; "Ubicación desconocida" when none is. */
export function locationLabel(item: GeoFields): string {
  const parts = [item.city, regionLabel(item.region, item.geo?.regionName), item.country && item.country !== UNKNOWN ? countryName(item.country) : ''];
  const unique: string[] = [];
  for (const part of parts) if (part && !unique.includes(part)) unique.push(part);
  return unique.join(', ') || 'Ubicación desconocida';
}

const STATUS_LABELS: Record<string, string> = {
  located: 'Ciudad aproximada por IP',
  country_only: 'Solo se conoce el país',
  unknown: 'La base GeoIP no tiene datos para esta IP',
  private: 'Red privada o local (no geolocalizable)',
  invalid: 'Dirección IP no válida',
  unavailable: 'Base GeoIP no disponible al registrar la sesión',
  disabled: 'Geolocalización desactivada',
  none: 'Sesión sin datos de ubicación',
};

export function geoStatusLabel(status?: string): string {
  return STATUS_LABELS[status || ''] || status || 'Sin datos de ubicación';
}

/** How precise the location is, in words: radius when GeoIP reported one, else the outcome. */
export function locationPrecision(item: GeoFields): string {
  const status = item.geo?.status || (item.city ? 'located' : item.country ? 'country_only' : 'none');
  if (status === 'located' && item.geo?.accuracyRadiusKm) return `Aprox. ±${item.geo.accuracyRadiusKm} km según la IP`;
  return geoStatusLabel(status);
}

export function providerLabel(item: GeoFields): string {
  const { asOrg, asn } = item.geo || {};
  if (asOrg && asn) return `${asOrg} (AS${asn})`;
  if (asOrg) return asOrg;
  return asn ? `AS${asn}` : '';
}

export function geoSourceLabel(source?: string): string {
  if (source === 'maxmind') return 'MaxMind GeoLite2 (local)';
  if (source === 'dbip') return 'DB-IP Lite (local) · IP Geolocation by DB-IP';
  return source === 'proxy_header' ? 'Cabeceras de Cloudflare' : 'No registrada';
}

/** Share of a total as a rounded percentage with one decimal ("12,5 %"), or "—" when the total is 0. */
export function share(count: number, total: number): string {
  if (!total) return '—';
  return `${(Math.round((count / total) * 1000) / 10).toLocaleString('es-ES')} %`;
}

/** Bar width for a value relative to the largest one, never 0 for a non-zero value. */
export function barWidth(count: number, max: number): string {
  if (!count || !max) return '0%';
  return `${Math.max(2, Math.round((count / max) * 100))}%`;
}
