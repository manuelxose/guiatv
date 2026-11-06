import { competitionHasApprovedProvider } from './competition-coverage';
import { resolveAvailability } from './availability';

describe('competition coverage', () => {
  it('approves the competitions OpenLigaDB supplies in 2026/27', () => {
    for (const slug of [
      'bundesliga',
      'bundesliga-2',
      'premier-league',
      'champions-league',
      'europa-league',
      'conference-league',
      'dfb-pokal',
      'mundial',
    ]) {
      expect(competitionHasApprovedProvider(slug)).toBeTrue();
    }
  });

  it('reports LaLiga and the other uncovered competitions as not covered', () => {
    for (const slug of [
      'laliga',
      'laliga-hypermotion',
      'copa-del-rey',
      'serie-a',
      'ligue-1',
      'primeira-liga',
      'eredivisie',
      'seleccion-espanola',
      'eurocopa',
      'nations-league',
    ]) {
      expect(competitionHasApprovedProvider(slug)).toBeFalse();
    }
  });

  it('fails closed for an unknown or missing competition slug', () => {
    expect(competitionHasApprovedProvider('some-unknown-league')).toBeFalse();
    expect(competitionHasApprovedProvider(undefined)).toBeFalse();
    expect(competitionHasApprovedProvider('')).toBeFalse();
  });

  it('distinguishes competition_not_covered from an empty-but-covered interval', () => {
    const laliga = resolveAvailability({
      loading: false,
      hasApprovedProvider: competitionHasApprovedProvider('laliga'),
      fetchFailed: false,
      hasData: false,
      updatedAt: null,
      now: 0,
    });
    expect(laliga).toBe('competition_not_covered');

    const coveredEmpty = resolveAvailability({
      loading: false,
      hasApprovedProvider: competitionHasApprovedProvider('champions-league'),
      fetchFailed: false,
      hasData: false,
      updatedAt: null,
      now: 0,
    });
    expect(coveredEmpty).toBe('unavailable');
    expect(coveredEmpty).not.toBe('competition_not_covered');
  });
});
