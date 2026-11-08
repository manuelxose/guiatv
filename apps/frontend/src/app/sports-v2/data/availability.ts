/**
 * Data availability model for the Match Center.
 * A pure, deterministic helper: any fetch outcome resolves to exactly one state.
 */

export type DataAvailability =
  | 'loading'
  | 'fresh'
  | 'stale'
  | 'provider_unavailable'
  | 'unavailable'
  | 'competition_not_covered';

/** Default freshness window: live data older than this is labelled `stale`. */
export const DEFAULT_STALE_AFTER_MS = 2 * 60_000;

export interface AvailabilityInput {
  /** A fetch for this resource is in flight. */
  readonly loading: boolean;
  /** The competition has at least one approved provider. */
  readonly hasApprovedProvider: boolean;
  /** The last fetch for this resource failed. */
  readonly fetchFailed: boolean;
  /** The provider returned a non-empty value for this field. */
  readonly hasData: boolean;
  /** Epoch ms of the last successful update; null when unknown (demo data or a missing header). */
  readonly updatedAt: number | null;
  /** Current epoch ms. */
  readonly now: number;
  /** Freshness window; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  readonly staleAfterMs?: number;
}

/** True when `updatedAt` is inside the freshness window; an unknown timestamp counts as fresh (nothing honest to say). */
export function isFresh(updatedAt: number | null, now: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): boolean {
  if (updatedAt == null) return true;
  return now - updatedAt <= staleAfterMs;
}

/**
 * Resolve exactly one availability state. Precedence is fixed so a combination can never
 * produce two states: loading → competition_not_covered → provider_unavailable → unavailable → fresh|stale.
 */
export function resolveAvailability(input: AvailabilityInput): DataAvailability {
  if (input.loading) return 'loading';
  if (!input.hasApprovedProvider) return 'competition_not_covered';
  if (input.fetchFailed) return 'provider_unavailable';
  if (!input.hasData) return 'unavailable';
  return isFresh(input.updatedAt, input.now, input.staleAfterMs) ? 'fresh' : 'stale';
}
