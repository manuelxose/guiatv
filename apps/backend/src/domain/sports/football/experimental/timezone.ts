/**
 * Experimental timezone helpers for OpenLigaDB payloads.
 *
 * - `kickoffFromMatchDateTimeUtc` uses the provider's explicit UTC field as-is
 *   (never deriving a kickoff from a naive local time when UTC is available).
 * - `zonedTimeToUtc` converts a NAIVE local wall time (no offset) into UTC
 *   using an IANA zone (Europe/Berlin by default) — a fallback for payloads
 *   that only carry a local wall time.
 */

/** Offset in ms (local wall clock minus UTC) for an instant in the given zone. */
export function getTimeZoneOffsetMs(epochMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - epochMs;
}

export function zonedTimeToUtc(naiveLocal: string, timeZone = 'Europe/Berlin'): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(String(naiveLocal ?? '').trim());
  if (!match) {
    throw new Error(`Expected naive local time "YYYY-MM-DDTHH:mm[:ss]", got "${naiveLocal}"`);
  }
  let timePart = match[2];
  if (timePart.length === 5) timePart += ':00';
  const asUtc = Date.parse(`${match[1]}T${timePart}Z`);
  if (Number.isNaN(asUtc)) {
    throw new Error(`Invalid naive local time "${naiveLocal}"`);
  }
  // Two passes remove the single-pass DST-boundary ambiguity for normal times.
  let utcMs = asUtc - getTimeZoneOffsetMs(asUtc, timeZone);
  const corrected = asUtc - getTimeZoneOffsetMs(utcMs, timeZone);
  if (corrected !== utcMs) utcMs = corrected;
  return new Date(utcMs).toISOString();
}

export function kickoffFromMatchDateTimeUtc(matchDateTimeUtc: string): string {
  const parsed = Date.parse(matchDateTimeUtc);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid matchDateTimeUTC "${matchDateTimeUtc}"`);
  }
  return new Date(parsed).toISOString();
}
