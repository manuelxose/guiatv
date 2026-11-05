import { StandingRow, StandingZone } from './models';

export const goalDifference = (r: StandingRow): number => r.goalsFor - r.goalsAgainst;

/** The zone a 1-based position falls in, or undefined when the competition supplies none. */
export function zoneAt(zones: readonly StandingZone[] | undefined, position: number): StandingZone | undefined {
  return zones?.find((z) => position >= z.from && position <= z.to);
}

/** A row is internally consistent when played = W+D+L and points = 3W+D. */
export function isConsistent(r: StandingRow): boolean {
  return r.played === r.won + r.drawn + r.lost && r.points === r.won * 3 + r.drawn;
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
