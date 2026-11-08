/**
 * Graceful degradation policy.
 *
 * On provider failure the last good value is returned with `stale: true` — the
 * system never serves an empty result when a good snapshot exists. An optional
 * `isDowngrade` predicate refuses to let a lower-quality value (e.g. an
 * EPG-only batch) replace a richer one, so a transient provider outage never
 * downgrades the data.
 */

export interface DegradationResult<T> {
  value: T;
  stale: boolean;
  fromFallback: boolean;
  lastError?: string;
}

export interface Provenanced {
  sourceProvenance?: { source?: string };
}

export function isEpgOnly(value: Provenanced | null | undefined): boolean {
  return value?.sourceProvenance?.source === 'epg';
}

/** True when a batch is non-empty and every record is EPG-only. */
export function isEpgOnlyBatch<T extends Provenanced>(items: T[]): boolean {
  return items.length > 0 && items.every(isEpgOnly);
}

/** Downgrade predicate: a pure EPG batch must never replace a rich batch. */
export function refuseEpgOnlyDowngrade<T extends Provenanced>(value: T[], lastGood: T[]): boolean {
  return isEpgOnlyBatch(value) && !isEpgOnlyBatch(lastGood);
}

export class GracefulDegradation<T> {
  private lastGood: T | null = null;

  constructor(private readonly isDowngrade: (value: T, lastGood: T) => boolean = () => false) {}

  async get(fetch: () => Promise<T>): Promise<DegradationResult<T>> {
    try {
      const value = await fetch();
      if (this.lastGood && this.isDowngrade(value, this.lastGood)) {
        return {
          value: this.lastGood,
          stale: true,
          fromFallback: true,
          lastError: 'refusing downgrade of a richer record',
        };
      }
      this.lastGood = value;
      return { value, stale: false, fromFallback: false };
    } catch (error) {
      if (this.lastGood) {
        return {
          value: this.lastGood,
          stale: true,
          fromFallback: true,
          lastError: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    }
  }
}

/**
 * Union of rich and EPG records keyed by identity: rich records always win per
 * key, and EPG only fills keys with no rich record. Pure and deterministic.
 */
export function mergeRichAndEpg<T>(rich: T[], epg: T[], keyOf: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const item of epg) merged.set(keyOf(item), item);
  for (const item of rich) merged.set(keyOf(item), item);
  return Array.from(merged.values());
}
