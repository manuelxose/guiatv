/**
 * Human-readable labels for analytics paths, for admin displays only (stored paths are unchanged, so historical data
 * keeps grouping exactly as before). Technical airing ids such as `/contenido/program:20261104_antena_3_20261104210000`
 * become "Emisión · <title> · Antena 3 · 04/11 21:00".
 *
 * Cost bound: one projected `$in` query for at most `maxLookups` unknown airing ids per call, results kept in a small
 * in-process cache (positive 6 h, negative 10 min). Airings that are no longer stored fall back to what the id itself
 * encodes (channel and start), without inventing a title.
 */
export interface AiringSummary {
  id: string;
  title?: string;
  channelName?: string;
  start?: string;
}

export type AiringLookup = (ids: string[]) => Promise<AiringSummary[]>;

const STATIC_LABELS: Record<string, string> = {
  '/': 'Inicio',
  '/canales': 'Canales',
  '/plataformas': 'Plataformas',
  '/deportes': 'Deportes',
  '/deportes/futbol': 'Fútbol',
  '/programacion-tv/series': 'Programación · Series',
  '/programacion-tv/peliculas': 'Programación · Películas',
  '/programacion-tv/en-directo': 'TV en directo',
  '/programacion-tv/que-ver-hoy': 'Qué ver hoy',
  '/programacion-tv/guia-canales': 'Guía de canales',
  '/comparador-streaming': 'Comparador de streaming',
  '/tendencias': 'Tendencias',
  '/blog': 'Blog',
  '/guias': 'Guías',
  '/editorial': 'Editorial',
  '/para-ti': 'Para ti',
  '/comunidad': 'Comunidad',
  '/perfil': 'Perfil',
  '/mi-cuenta': 'Mi cuenta',
  '/iniciar-sesion': 'Iniciar sesión',
  '/registro': 'Registro',
  '/cookies': 'Política de cookies',
  '/privacidad': 'Privacidad',
  '/avisolegal': 'Aviso legal',
  '/terminos': 'Términos',
  '/accesibilidad': 'Accesibilidad',
  '/sobre-nosotros': 'Sobre nosotros',
  '/sitemap': 'Mapa del sitio',
};

const PREFIX_LABELS: Array<[string, string]> = [
  ['/programas/', 'Programa'],
  ['/peliculas/', 'Película'],
  ['/series/', 'Serie'],
  ['/canales/', 'Canal'],
  ['/programacion-tv/ver-canal/', 'Canal'],
  ['/ver-canal/', 'Canal'],
  ['/blog/', 'Blog'],
  ['/guias/', 'Guía'],
  ['/editorial/', 'Editorial'],
  ['/deportes/futbol/', 'Fútbol'],
];

const AIRING_PATH = /^\/contenido\/program:([^/]{1,120})$/;
const AIRING_ID = /^(\d{8})_([a-z0-9_]+?)_(\d{14})$/i;

export function humanizeSlug(slug: string): string {
  let text = slug;
  try {
    text = decodeURIComponent(slug);
  } catch {
    // keep raw
  }
  text = text.replace(/[-_]+/g, ' ').trim();
  if (!text) return slug;
  return text.charAt(0).toLocaleUpperCase('es') + text.slice(1);
}

/** Channel and start encoded in an EPG airing id (`YYYYMMDD_<channel>_<YYYYMMDDHHMMSS>`), if it has that shape. */
export function parseAiringId(id: string): { channel: string; start: string } | null {
  const match = AIRING_ID.exec(id);
  if (!match) return null;
  const ts = match[3];
  const channel = match[2].split('_').map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
  return { channel, start: `${ts.slice(6, 8)}/${ts.slice(4, 6)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}` };
}

function formatStart(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const pad = (value: string) => value.padStart(2, '0');
  return `${pad(get('day'))}/${pad(get('month'))} ${pad(get('hour'))}:${pad(get('minute'))}`;
}

export function staticLabel(path: string): string | undefined {
  if (STATIC_LABELS[path]) return STATIC_LABELS[path];
  for (const [prefix, label] of PREFIX_LABELS) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length).split('/').filter(Boolean);
      if (rest.length) return `${label} · ${rest.map(humanizeSlug).join(' · ')}`;
    }
  }
  return undefined;
}

export class PathLabelResolver {
  private readonly cache = new Map<string, { label: string; until: number }>();

  constructor(
    private readonly lookup: AiringLookup,
    private readonly options = { maxLookups: 50, maxCache: 2_000, ttlMs: 6 * 60 * 60_000, negativeTtlMs: 10 * 60_000 },
    private readonly now: () => number = Date.now
  ) {}

  async resolve(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const pending = new Map<string, string>(); // airing id -> path
    const at = this.now();
    for (const path of new Set(paths)) {
      const airing = AIRING_PATH.exec(path);
      if (!airing) {
        const label = staticLabel(path);
        if (label) out.set(path, label);
        continue;
      }
      let id = airing[1];
      try {
        id = decodeURIComponent(id);
      } catch {
        // keep raw
      }
      const cached = this.cache.get(id);
      if (cached && cached.until > at) out.set(path, cached.label);
      else if (pending.size < this.options.maxLookups) pending.set(id, path);
      else out.set(path, this.fallback(id));
    }
    if (!pending.size) return out;

    let found: AiringSummary[] = [];
    try {
      found = await this.lookup([...pending.keys()]);
    } catch {
      found = [];
    }
    const byId = new Map(found.map((airing) => [airing.id, airing]));
    for (const [id, path] of pending) {
      const airing = byId.get(id);
      const label = airing ? this.describe(airing) : this.fallback(id);
      this.remember(id, label, airing ? this.options.ttlMs : this.options.negativeTtlMs);
      out.set(path, label);
    }
    return out;
  }

  private describe(airing: AiringSummary): string {
    const parsed = parseAiringId(airing.id);
    const parts = ['Emisión', airing.title?.trim(), airing.channelName?.trim() || parsed?.channel, formatStart(airing.start) || parsed?.start].filter(Boolean);
    return parts.join(' · ');
  }

  private fallback(id: string): string {
    const parsed = parseAiringId(id);
    return parsed ? `Emisión · ${parsed.channel} · ${parsed.start}` : 'Emisión de la guía';
  }

  private remember(id: string, label: string, ttlMs: number): void {
    if (this.cache.size >= this.options.maxCache) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(id, { label, until: this.now() + ttlMs });
  }
}
