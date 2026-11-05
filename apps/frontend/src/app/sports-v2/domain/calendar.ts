/** Calendar helpers. All user-facing times are Europe/Madrid and say so (see timezoneLabel). */
export const MADRID = 'Europe/Madrid';

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit' });

export const isDayKey = (value: string | null | undefined): value is string => !!value && KEY.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; // rejects 2026-02-31

/** `YYYY-MM-DD` of an instant in Madrid. */
export function dayKey(instant: string | Date): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return Number.isNaN(d.getTime()) ? '' : dayFormatter.format(d);
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

/** "CET" or "CEST", depending on the instant. */
export function timezoneLabel(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, timeZoneName: 'short' }).formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? MADRID;
}

export function kickoffTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: MADRID });
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

/** "5 nov, 20:00" in Madrid time. Intl, not DatePipe: no dependency on registered locale data. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: MADRID }).replace(/\./g, '')}, ${kickoffTime(iso)}`;
}

/** "5 de noviembre de 2026, 20:00" in Madrid time. */
export function longStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: MADRID })}, ${kickoffTime(iso)}`;
}
