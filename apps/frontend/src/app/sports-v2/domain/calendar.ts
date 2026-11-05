/**
 * Calendar helpers. Instants stay ISO/UTC everywhere; only display uses a zone.
 * The zone is Europe/Madrid (server render and tests) until the browser reports its own via setDisplayZone().
 */
export const MADRID = 'Europe/Madrid';

let zone = MADRID;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Returns false (and keeps the current zone) when the runtime does not know the zone. */
export function setDisplayZone(tz: string | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: tz });
  } catch {
    return false;
  }
  zone = tz;
  return true;
}
export const displayZone = (): string => zone;
export const isMadridZone = (): boolean => zone === MADRID;

const KEY = /^\d{4}-\d{2}-\d{2}$/;
function dayFormatter(): Intl.DateTimeFormat {
  let f = dayFormatters.get(zone);
  if (!f) dayFormatters.set(zone, (f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f;
}

export const isDayKey = (value: string | null | undefined): value is string => !!value && KEY.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; // rejects 2026-02-31

/** `YYYY-MM-DD` of an instant in the display zone. */
export function dayKey(instant: string | Date): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return Number.isNaN(d.getTime()) ? '' : dayFormatter().format(d);
}

export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** "Hoy", "Ayer", "Mañana" or "lun 9 nov". */
export function dayLabel(key: string, today: string): string {
  if (key === today) return 'Hoy';
  if (key === addDays(today, -1)) return 'Ayer';
  if (key === addDays(today, 1)) return 'Mañana';
  return shortDay(key);
}

export function shortDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/\./g, '');
}

export function longDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** "CET", "CEST", "GMT-5"... depending on the zone and instant. */
export function timezoneLabel(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: zone, timeZoneName: 'short' }).formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

/** "hora de Madrid (CET)" or "tu hora local (Europe/London, GMT)". */
export function zoneDescription(instant: Date = new Date()): string {
  return isMadridZone() ? `hora de Madrid (${timezoneLabel(instant)})` : `tu hora local (${zone}, ${timezoneLabel(instant)})`;
}

export function kickoffTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zone });
}

/** Madrid wall-clock → instant. Good enough for fixtures; ignores the two DST-switch hours. */
export function madridInstant(key: string, hour: number, minute = 0): Date {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: MADRID, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(guess));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return new Date(guess - (shown - guess));
}

/** "5 nov, 20:00" in the display zone. Intl, not DatePipe: no dependency on registered locale data. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: zone }).replace(/\./g, '')}, ${kickoffTime(iso)}`;
}

/** "5 de noviembre de 2026, 20:00" in the display zone. */
export function longStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: zone })}, ${kickoffTime(iso)}`;
}
