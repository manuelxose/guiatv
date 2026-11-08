import { competitionRight } from './competition-rights';

describe('competition rights (level B)', () => {
  it('returns the official Spanish operator for the Europa League', () => {
    expect(competitionRight('europa-league')?.operator).toBe('Telefónica');
  });
  it('returns nothing for competitions without an official source', () => {
    expect(competitionRight('laliga')).toBeUndefined();
  });
});
