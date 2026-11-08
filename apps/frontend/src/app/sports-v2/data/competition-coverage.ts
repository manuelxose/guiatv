/**
 * Per-competition provider coverage for the public Sports v2 surface.
 *
 * Sourced from docs/sports-v2/M06-PROVIDER-ELIGIBILITY.md (captain-authored):
 * OpenLigaDB is APPROVED_LIMITED_COVERAGE (ODbL, with attribution) and supplies
 * real 2026/27 fixtures/results/goal timelines for exactly the competitions
 * listed below. LaLiga was added after a direct provider probe on 2026-11-06
 * (shortcut `la1`, 380 real fixtures from 2026-08-15); Copa del Rey, LaLiga
 * Hypermotion and the rest stay OUT because the provider returns no fixtures
 * for them, so a match in one of those never reads as "approved provider".
 *
 * Unknown slugs fail closed (not covered): a competition we have not measured
 * must not be presented as covered. A fixture surfaced only through the EPG is
 * not a verified result-bearing match and is therefore never covered here.
 */

const COVERED_COMPETITIONS: ReadonlySet<string> = new Set([
  'bundesliga',        // bl1
  'bundesliga-2',      // bl2
  'premier-league',    // pl
  'champions-league',  // ucl
  'europa-league',     // uel2026
  'conference-league', // uecl2026
  'dfb-pokal',         // dfb
  'laliga',            // la1 (verified 2026-11-06: 380 fixtures)
  'mundial',           // wm2026 (World Cup 2026)
]);

/** True only for competitions an approved provider actually covers in 2026/27. */
export function competitionHasApprovedProvider(slug: string | undefined): boolean {
  return COVERED_COMPETITIONS.has(String(slug ?? '').trim().toLowerCase());
}
