import { FootballScoreboardComponent } from './football-scoreboard.component';
import { FootballMatchDTO } from '../../football.models';

describe('FootballScoreboardComponent kickoff formatting', () => {
  const component = new FootballScoreboardComponent();

  it('keeps the date out of the kickoff time and uses Madrid across daylight saving changes', () => {
    for (const [kickoffAt, time] of [['2026-10-23T00:30:00Z', '02:30'], ['2026-12-23T00:30:00Z', '01:30']]) {
      component.match = { kickoffAt } as FootballMatchDTO;
      expect(component.kickoffTime).toBe(time);
      expect(component.kickoffDate).toContain('23');
      expect(component.kickoffDate).not.toContain(':');
    }
  });

  it('omits invalid provider dates instead of throwing', () => {
    component.match = { kickoffAt: 'invalid' } as FootballMatchDTO;
    expect(component.kickoffTime).toBe('');
    expect(component.kickoffDate).toBe('');
  });
});
