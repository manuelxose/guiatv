/**
 * DEMO DATA ONLY. Every club, competition, player, score, article and channel here is fictional.
 * It exists so the shell can be developed, reviewed and tested without production APIs.
 * Dates are generated relative to "today" so day navigation always has content.
 * Never import this file outside `football-data.ts` and tests.
 */
import { addDays, madridInstant } from '../domain/calendar';
import {
  Broadcast,
  Competition,
  Match,
  MatchEvent,
  MatchStat,
  MatchStatus,
  NewsItem,
  SportsSnapshot,
  StandingRow,
  Standings,
  Team,
} from '../domain/models';

const team = (slug: string, name: string, shortName: string, hue: number, city: string, founded: number): Team => ({ slug, name, shortName, hue, city, founded });

export const DEMO_TEAMS: readonly Team[] = [
  team('real-costa', 'Real Costa', 'RCO', 210, 'Costa Azul', 1912),
  team('racing-sur', 'Racing Sur', 'RSU', 8, 'Puerto Sur', 1921),
  team('atletico-norte', 'Atlético Norte', 'ANO', 350, 'Norte Alto', 1903),
  team('deportivo-valle', 'Deportivo Valle', 'DVA', 140, 'Valle Verde', 1930),
  team('union-puerto', 'Unión Puerto', 'UPU', 45, 'Puerto Viejo', 1927),
  team('sporting-mesa', 'Sporting Mesa', 'SME', 275, 'Mesa Real', 1919),
  team('ciudad-alta', 'Ciudad Alta', 'CAL', 190, 'Ciudad Alta', 1945),
  team('club-ribera', 'Club Ribera', 'CRI', 25, 'Ribera Baja', 1935),
];

export const DEMO_COMPETITIONS: readonly Competition[] = [
  {
    slug: 'liga-demo-a',
    name: 'Liga Demo A',
    country: 'España',
    kind: 'league',
    hue: 210,
    season: '2026/27',
    description: 'Liga ficticia de seis equipos para desarrollo. Sus zonas de clasificación son de demostración.',
    teamSlugs: ['real-costa', 'racing-sur', 'atletico-norte', 'deportivo-valle', 'union-puerto', 'club-ribera'],
    zones: [
      { from: 1, to: 2, kind: 'qualification', label: 'Clasificación a la Liga Continental Demo' },
      { from: 6, to: 6, kind: 'relegation', label: 'Descenso' },
    ],
  },
  {
    slug: 'copa-demo',
    name: 'Copa Demo',
    country: 'España',
    kind: 'cup',
    hue: 275,
    season: '2026/27',
    description: 'Eliminatoria ficticia a partido único. No tiene clasificación.',
    teamSlugs: ['union-puerto', 'sporting-mesa', 'ciudad-alta', 'club-ribera'],
  },
  {
    slug: 'liga-continental-demo',
    name: 'Liga Continental Demo',
    country: 'Europa',
    kind: 'international',
    hue: 150,
    season: '2026/27',
    description: 'Fase de liga ficticia entre cuatro clubes. Sin zonas verificadas.',
    teamSlugs: ['real-costa', 'ciudad-alta', 'atletico-norte', 'sporting-mesa'],
  },
];

/** [team, won, drawn, lost, goalsFor, goalsAgainst] → ordered, internally consistent table. */
function table(competitionSlug: string, entries: readonly (readonly [string, number, number, number, number, number])[]): Standings {
  const rows: StandingRow[] = entries.map(([teamSlug, won, drawn, lost, goalsFor, goalsAgainst]) => ({
    teamSlug,
    played: won + drawn + lost,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    points: won * 3 + drawn,
  }));
  rows.sort((a, b) => b.points - a.points || b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor);
  return { competitionSlug, rows };
}

export const DEMO_STANDINGS: readonly Standings[] = [
  table('liga-demo-a', [
    ['real-costa', 7, 2, 1, 19, 8],
    ['atletico-norte', 6, 2, 2, 16, 9],
    ['racing-sur', 5, 3, 2, 14, 10],
    ['deportivo-valle', 3, 3, 4, 11, 13],
    ['union-puerto', 2, 2, 6, 9, 17],
    ['club-ribera', 1, 2, 7, 7, 17],
  ]),
  table('liga-continental-demo', [
    ['real-costa', 3, 1, 0, 8, 2],
    ['ciudad-alta', 2, 1, 1, 5, 4],
    ['sporting-mesa', 1, 1, 2, 4, 6],
    ['atletico-norte', 0, 1, 3, 2, 7],
  ]),
];

const stats = (poss: number, shots: number, shotsAway: number): readonly MatchStat[] => [
  { label: 'Posesión', home: poss, away: 100 - poss, unit: '%' },
  { label: 'Remates', home: shots, away: shotsAway },
  { label: 'Remates a puerta', home: Math.round(shots / 2), away: Math.round(shotsAway / 2) },
  { label: 'Córneres', home: 5, away: 3 },
];

const squad = (formation: string, names: string[]) => ({ formation, players: names });
const TV1: Broadcast = { channel: 'Canal Deportes 1', kind: 'tv' };
const TV2: Broadcast = { channel: 'Canal Deportes 2', kind: 'tv' };
const EU: Broadcast = { channel: 'Canal Europa', kind: 'tv' };
const PLUS: Broadcast = { channel: 'Plataforma Fútbol+', kind: 'streaming' };
const goal = (minute: number, side: 'home' | 'away', player: string): MatchEvent => ({ minute, type: 'goal', side, player });

interface Spec {
  day: number; // offset from today
  at: [number, number]; // Madrid hour, minute
  comp: string;
  round: string;
  home: string;
  away: string;
  status: MatchStatus;
  minute?: number;
  score?: [number, number];
  events?: MatchEvent[];
  stats?: readonly MatchStat[];
  lineups?: Match['lineups'];
  tv?: Broadcast[];
}

export function buildDemoMatches(today: string): readonly Match[] {
  const specs: Spec[] = [
    {
      day: 0, at: [20, 0], comp: 'liga-demo-a', round: 'Jornada 11', home: 'real-costa', away: 'racing-sur', status: 'live', minute: 72, score: [2, 1],
      events: [goal(14, 'home', 'M. Ortega'), { minute: 38, type: 'yellow', side: 'away', player: 'J. Salas' }, goal(51, 'away', 'D. Navas'), goal(63, 'home', 'L. Prieto'), { minute: 70, type: 'sub', side: 'home', player: 'A. Cruz' }],
      stats: stats(54, 12, 8),
      lineups: {
        home: squad('4-3-3', ['Vidal', 'Ibarra', 'Soto', 'Peña', 'Lara', 'Ortega', 'Prieto', 'Mena', 'Cruz', 'Gil', 'Rey']),
        away: squad('4-4-2', ['Bravo', 'Salas', 'Nieto', 'Ruiz', 'Vera', 'Navas', 'Toro', 'Luna', 'Cano', 'Pozo', 'Mora']),
      },
      tv: [TV1, PLUS],
    },
    { day: 0, at: [20, 0], comp: 'liga-demo-a', round: 'Jornada 11', home: 'atletico-norte', away: 'deportivo-valle', status: 'live', minute: 31, score: [0, 0], events: [{ minute: 22, type: 'yellow', side: 'home', player: 'R. Campos' }], stats: stats(48, 4, 5), tv: [PLUS] },
    { day: 0, at: [16, 0], comp: 'copa-demo', round: 'Octavos de final', home: 'union-puerto', away: 'sporting-mesa', status: 'finished', score: [1, 3], events: [goal(9, 'away', 'T. Arce'), goal(44, 'home', 'P. Lobo'), goal(58, 'away', 'T. Arce'), goal(81, 'away', 'C. Fe')], stats: stats(41, 7, 13), tv: [TV2] },
    { day: 0, at: [12, 30], comp: 'liga-demo-a', round: 'Jornada 11', home: 'deportivo-valle', away: 'club-ribera', status: 'finished', score: [2, 0], events: [goal(33, 'home', 'S. Pardo'), goal(77, 'home', 'E. Roca')], stats: stats(58, 14, 5), tv: [PLUS] },
    { day: 0, at: [21, 30], comp: 'copa-demo', round: 'Octavos de final', home: 'ciudad-alta', away: 'club-ribera', status: 'scheduled', tv: [TV2] },
    { day: 1, at: [21, 0], comp: 'liga-continental-demo', round: 'Jornada 5', home: 'real-costa', away: 'ciudad-alta', status: 'scheduled', tv: [EU, PLUS] },
    { day: 1, at: [18, 45], comp: 'liga-continental-demo', round: 'Jornada 5', home: 'atletico-norte', away: 'sporting-mesa', status: 'postponed' },
    { day: 2, at: [18, 30], comp: 'liga-demo-a', round: 'Jornada 12', home: 'racing-sur', away: 'union-puerto', status: 'scheduled' },
    { day: 2, at: [21, 0], comp: 'liga-demo-a', round: 'Jornada 12', home: 'deportivo-valle', away: 'atletico-norte', status: 'scheduled', tv: [PLUS] },
    { day: 3, at: [21, 0], comp: 'liga-continental-demo', round: 'Jornada 6', home: 'sporting-mesa', away: 'real-costa', status: 'scheduled', tv: [EU] },
    { day: 5, at: [20, 45], comp: 'liga-continental-demo', round: 'Jornada 6', home: 'ciudad-alta', away: 'atletico-norte', status: 'scheduled' },
    { day: -1, at: [21, 0], comp: 'liga-demo-a', round: 'Jornada 10', home: 'racing-sur', away: 'atletico-norte', status: 'finished', score: [1, 1], events: [goal(27, 'away', 'N. Vega'), goal(66, 'home', 'D. Navas')], stats: stats(49, 9, 10), tv: [TV1] },
    { day: -1, at: [18, 30], comp: 'liga-demo-a', round: 'Jornada 10', home: 'club-ribera', away: 'real-costa', status: 'finished', score: [0, 3], events: [goal(12, 'away', 'M. Ortega'), goal(55, 'away', 'L. Prieto'), goal(89, 'away', 'A. Cruz')], stats: stats(35, 5, 16) },
    { day: -2, at: [21, 0], comp: 'liga-continental-demo', round: 'Jornada 4', home: 'ciudad-alta', away: 'sporting-mesa', status: 'finished', score: [2, 1], events: [goal(18, 'home', 'B. Lago'), goal(49, 'away', 'T. Arce'), goal(90, 'home', 'B. Lago')], stats: stats(52, 11, 9), tv: [EU] },
    { day: -2, at: [18, 30], comp: 'liga-demo-a', round: 'Jornada 10', home: 'union-puerto', away: 'deportivo-valle', status: 'finished', score: [1, 2], events: [goal(40, 'home', 'P. Lobo'), goal(60, 'away', 'S. Pardo'), goal(85, 'away', 'E. Roca')], stats: stats(46, 8, 10) },
    { day: -3, at: [20, 0], comp: 'liga-demo-a', round: 'Jornada 9', home: 'real-costa', away: 'deportivo-valle', status: 'finished', score: [2, 0], events: [goal(21, 'home', 'M. Ortega'), goal(70, 'home', 'L. Prieto')], stats: stats(61, 15, 4) },
    { day: -7, at: [19, 0], comp: 'copa-demo', round: 'Dieciseisavos de final', home: 'sporting-mesa', away: 'club-ribera', status: 'finished', score: [2, 0], events: [goal(30, 'home', 'T. Arce'), goal(75, 'home', 'C. Fe')], stats: stats(57, 12, 6) },
  ];

  return specs.map((s) => {
    const key = addDays(today, s.day);
    const hasScore = s.status === 'live' || s.status === 'finished';
    return {
      slug: `${s.home}-${s.away}-${key}`,
      competitionSlug: s.comp,
      homeSlug: s.home,
      awaySlug: s.away,
      status: s.status,
      kickoff: madridInstant(key, s.at[0], s.at[1]).toISOString(),
      round: s.round,
      minute: s.minute,
      homeScore: hasScore ? s.score?.[0] : undefined,
      awayScore: hasScore ? s.score?.[1] : undefined,
      events: s.events ?? [],
      stats: s.stats ?? [],
      lineups: s.lineups,
      broadcasts: s.tv ?? [],
    };
  });
}

export function buildDemoNews(today: string): readonly NewsItem[] {
  const at = (day: number, h: number, m = 0) => madridInstant(addDays(today, day), h, m).toISOString();
  const dm = `${addDays(today, 0)}`;
  return [
    {
      slug: 'claves-del-duelo-real-costa-racing-sur',
      kicker: 'Análisis',
      title: 'Las claves del duelo entre Real Costa y Racing Sur',
      summary: 'Un líder en racha frente a un rival que no pierde fuera de casa: tres aspectos tácticos que decidirán el partido.',
      author: 'Redacción de demostración',
      publishedAt: at(0, 12),
      featured: true,
      competitionSlug: 'liga-demo-a',
      teamSlugs: ['real-costa', 'racing-sur'],
      matchSlug: `real-costa-racing-sur-${dm}`,
      hue: 210,
      body: [
        'Texto ficticio para desarrollo. Real Costa llega como líder tras siete victorias en diez jornadas, con la defensa menos goleada de la Liga Demo A.',
        'Racing Sur, por su parte, ha firmado tres empates a domicilio y mantiene la portería a cero en dos de sus últimos cuatro partidos.',
        'La presión tras pérdida y las acciones a balón parado serán, según este análisis de demostración, los dos terrenos donde se incline el marcador.',
      ],
    },
    {
      slug: 'sporting-mesa-golpea-en-copa',
      kicker: 'Crónica',
      title: 'Sporting Mesa golpea en la Copa Demo con un doblete de Arce',
      summary: 'El delantero firmó dos goles en la victoria 1-3 ante Unión Puerto y deja al equipo en cuartos.',
      author: 'Redacción de demostración',
      publishedAt: at(0, 18, 10),
      competitionSlug: 'copa-demo',
      teamSlugs: ['sporting-mesa', 'union-puerto'],
      matchSlug: `union-puerto-sporting-mesa-${dm}`,
      hue: 275,
      body: [
        'Texto ficticio para desarrollo. Sporting Mesa resolvió el duelo con dos goles de T. Arce y otro de C. Fe en la segunda parte.',
        'Unión Puerto recortó distancias antes del descanso, pero no encontró continuidad ofensiva.',
      ],
    },
    {
      slug: 'previa-liga-continental-jornada',
      kicker: 'Previa',
      title: 'Previa de la jornada continental: horarios y dónde verla',
      summary: 'Real Costa recibe a Ciudad Alta en el partido grande de la jornada de la Liga Continental Demo.',
      author: 'Redacción de demostración',
      publishedAt: at(0, 9, 30),
      competitionSlug: 'liga-continental-demo',
      teamSlugs: ['real-costa', 'ciudad-alta', 'atletico-norte', 'sporting-mesa'],
      hue: 150,
      body: ['Texto ficticio para desarrollo. La jornada arranca con el aplazamiento del Atlético Norte - Sporting Mesa y continúa con el choque entre Real Costa y Ciudad Alta.'],
    },
    {
      slug: 'racing-sur-reclama-su-sitio',
      kicker: 'Opinión',
      title: 'Racing Sur reclama su sitio en la zona alta',
      summary: 'Tres empates seguidos fuera de casa: ¿regularidad o falta de colmillo?',
      author: 'Redacción de demostración',
      publishedAt: at(-1, 23),
      competitionSlug: 'liga-demo-a',
      teamSlugs: ['racing-sur'],
      hue: 8,
      body: ['Texto ficticio para desarrollo. El equipo suma 18 puntos y se mantiene a tres del liderato.'],
    },
    {
      slug: 'ciudad-alta-supera-a-sporting-mesa',
      kicker: 'Crónica',
      title: 'Ciudad Alta supera a Sporting Mesa con gol en el último minuto',
      summary: 'B. Lago firmó un doblete y evitó el empate en el 90.',
      author: 'Redacción de demostración',
      publishedAt: at(-2, 23, 15),
      competitionSlug: 'liga-continental-demo',
      teamSlugs: ['ciudad-alta', 'sporting-mesa'],
      matchSlug: `ciudad-alta-sporting-mesa-${addDays(today, -2)}`,
      hue: 190,
      body: ['Texto ficticio para desarrollo. Ciudad Alta sumó tres puntos agónicos y se coloca segundo en la clasificación.'],
    },
  ];
}

export function buildDemoSnapshot(today: string): SportsSnapshot {
  return { teams: DEMO_TEAMS, competitions: DEMO_COMPETITIONS, matches: buildDemoMatches(today), standings: DEMO_STANDINGS, news: buildDemoNews(today) };
}
