import { kickoffTime } from './calendar';
import { MatchStatus } from './models';

export interface StatusPresentation {
  readonly label: string;
  /** Glyph shown next to the label so colour is never the only signal (WCAG 1.4.1). */
  readonly glyph: '●' | '✓' | '◷' | '⏸';
}

export const STATUS_PRESENTATION: Readonly<Record<MatchStatus, StatusPresentation>> = {
  live: { label: 'En vivo', glyph: '●' },
  finished: { label: 'Finalizado', glyph: '✓' },
  scheduled: { label: 'Programado', glyph: '◷' },
  postponed: { label: 'Aplazado', glyph: '⏸' },
};

/** Spanish label for the clock slot of a match card. */
export function matchClockLabel(status: MatchStatus, minute: number | undefined, kickoff: string): string {
  if (status === 'live') return minute != null ? `${minute}'` : 'En vivo';
  if (status === 'finished') return 'FIN';
  if (status === 'postponed') return 'Aplazado';
  return kickoffTime(kickoff);
}

/** Accessible one-sentence description of a score line. */
export function scoreAriaLabel(
  home: string,
  away: string,
  status: MatchStatus,
  homeScore?: number,
  awayScore?: number,
): string {
  if ((status === 'live' || status === 'finished') && homeScore != null && awayScore != null) {
    return `${home} ${homeScore}, ${away} ${awayScore}, ${STATUS_PRESENTATION[status].label.toLowerCase()}`;
  }
  return `${home} contra ${away}, ${STATUS_PRESENTATION[status].label.toLowerCase()}`;
}
