/**
 * LEVEL B evidence: an authoritative source says an operator holds the competition's rights in a territory.
 * It is NOT evidence about which channel airs a given fixture, so the UI must always label it as such.
 * Extend only with entries backed by an official source URL.
 */
export interface CompetitionRight {
  readonly operator: string;
  readonly territory: 'ES';
  readonly season: string;
  readonly source: string;
}

const RIGHTS: Readonly<Record<string, CompetitionRight>> = {
  'europa-league': {
    operator: 'Telefónica',
    territory: 'ES',
    season: '2026/27',
    source: 'https://es.uefa.com/uefaeuropaleague/news/028d-1af12c70c473-b75893318d64-1000--donde-ver-la-uefa-europa-league-tv-y-streamings-en-directo/',
  },
};

export const COMPETITION_RIGHTS_LABEL = 'Operador oficial de la competición. Canal de este partido pendiente de confirmar.';

/** Spain is the only market until the user can choose one; the territory is never inferred from the visitor IP. */
export function competitionRight(competitionSlug: string, territory: 'ES' = 'ES'): CompetitionRight | undefined {
  const r = RIGHTS[competitionSlug];
  return r && r.territory === territory ? r : undefined;
}
