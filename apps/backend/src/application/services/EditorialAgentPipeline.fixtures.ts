/** Shared M11-B pipeline fixtures: a scripted model and a small offline web (tests only). */
import { EditorialDeps, EditorialModel, EditorialRole, EditorialTopic, ModelCall } from './EditorialAgentPipeline';

export const NOW = new Date('2026-10-26T10:00:00Z');
export const PAGES: Record<string, string> = {
  'https://guiaprogramaciontv.com/v2/programs/el-padrino': '{"title":"El Padrino","channel":"La 2","start":"2026-10-27T22:00:00+01:00","path":"/programas/el-padrino"}',
  'https://www.rtve.es/play/la-2/': 'La 2 emite cine clásico los martes en la sesión "Días de cine clásico" a partir de las 22:00.',
  'https://www.filmaffinity.com/es/film809297.html': 'El Padrino (1972), dirigida por Francis Ford Coppola, ganó el Óscar a la mejor película.',
  'https://www.imdb.com/title/tt0068646/': 'The Godfather (1972) directed by Francis Ford Coppola. El Padrino ganó el Óscar a la mejor película en 1973.',
};
export const topic: EditorialTopic = {
  slug: 'el-padrino-en-la-2-esta-semana',
  topic: 'El Padrino en La 2 esta semana: qué ver y por qué',
  intent: 'qué ver en la tele esta semana',
  volatility: 'tv-schedule',
  categories: ['Cine'],
  internalSources: [{ id: 'g1', url: 'https://guiaprogramaciontv.com/v2/programs/el-padrino' }],
};

export const research = {
  researchQuestions: ['¿Cuándo emite La 2 El Padrino?', '¿Qué premios tiene?'],
  sources: [
    { id: 'r1', url: 'https://www.rtve.es/play/la-2/', publisher: 'RTVE' },
    { id: 'p1', url: 'https://www.filmaffinity.com/es/film809297.html', publisher: 'FilmAffinity' },
    { id: 'p2', url: 'https://www.imdb.com/title/tt0068646/', publisher: 'IMDb' },
  ],
  claims: [
    { id: 'c1', text: 'La 2 emite El Padrino el 27 de octubre a las 22:00', volatility: 'tv-schedule', quotes: [{ sourceId: 'g1', quote: '"channel":"La 2","start":"2026-10-27T22:00' }] },
    { id: 'c2', text: 'El Padrino es de 1972 y la dirigió Francis Ford Coppola', volatility: 'stable', quotes: [{ sourceId: 'p1', quote: 'El Padrino (1972), dirigida por Francis Ford Coppola' }, { sourceId: 'p2', quote: 'The Godfather (1972) directed by Francis Ford Coppola' }] },
    { id: 'c3', text: 'Ganó el Óscar a la mejor película', volatility: 'stable', quotes: [{ sourceId: 'p1', quote: 'ganó el Óscar a la mejor película' }, { sourceId: 'p2', quote: 'ganó el Óscar a la mejor película' }] },
    { id: 'c4', text: 'La 2 programa cine clásico los martes desde las 22:00', volatility: 'tv-schedule', quotes: [{ sourceId: 'r1', quote: 'La 2 emite cine clásico los martes en la sesión "Días de cine clásico" a partir de las 22:00' }] },
    { id: 'c5', text: 'Netflix tiene El Padrino', volatility: 'availability', quotes: [{ sourceId: 'p1', quote: 'disponible en Netflix' }] },
  ],
};
export const GOOD = [
  '# El Padrino en La 2: el clásico de Coppola vuelve el martes',
  '',
  'La 2 la emite el martes 27 de octubre a las 22:00 [[c1]], dentro de su franja de cine clásico de los martes [[c4]].',
  '',
  'Es la película de Francis Ford Coppola de 1972 [[c2]] y ganó el Óscar a la mejor película [[c3]]. Merece verla en abierto si no la tienes en ninguna plataforma.',
  '',
  'Ficha en [GuíaTV](/programas/el-padrino) y datos de [FilmAffinity](https://www.filmaffinity.com/es/film809297.html).',
].join('\n');
export const draft = (markdown = GOOD) => ({
  title: 'El Padrino en La 2: el clásico de Coppola vuelve el martes',
  excerpt: 'Cuándo emite La 2 El Padrino esta semana y por qué es una cita con el cine clásico en abierto.',
  metaTitle: 'El Padrino en La 2 esta semana',
  metaDescription: 'La 2 emite El Padrino el martes en su franja de cine clásico: horario, ficha y por qué verla en abierto.',
  markdown,
  distinctValue: { readerBenefit: 'Une el pase de La 2 que publica GuíaTV con el palmarés verificado en dos editores, para decidir si verla en abierto esta semana.', claimIds: ['c1', 'c3'] },
});
export const pass = { verdict: 'pass', issues: [] };

export type Script = Partial<Record<EditorialRole, unknown[]>>;
export function scripted(script: Script, usage = { input_tokens: 2000, output_tokens: 800 }, provider = 'scripted') {
  const calls: ModelCall[] = [];
  let active = 0;
  let peak = 0;
  const model: EditorialModel = {
    provider,
    async call(request) {
      calls.push(request);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      const queue = script[request.role] ?? [];
      const json = queue.length > 1 ? queue.shift() : queue[0];
      if (json === undefined) throw new Error(`no scripted answer for ${request.role}`);
      return { json: structuredClone(json), usage, searches: request.webSearches ? 2 : 0 };
    },
  };
  return { model, calls, peak: () => peak };
}
export const deps = (model: EditorialModel, over: Partial<EditorialDeps> = {}): EditorialDeps => ({
  model,
  fetchSource: async (url) => (PAGES[url] ? { status: 200, text: PAGES[url] } : { status: 404, text: '' }),
  internalLinkStatus: async (path) => (path === '/programas/el-padrino' || path === '/politica-editorial' ? 200 : 404),
  render: (md) => md.split(/\n{2,}/).map((p) => /^#{2,6} /.test(p) ? `<h2>${p.replace(/^#+ /, '')}</h2>` : `<p>${p.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')}</p>`).join(''),
  corpus: [{ slug: 'precios-plataformas-streaming-espana', content: '<p>Precios del streaming en España.</p>' }],
  now: () => NOW,
  ...over,
});
/** Full-length variant (the CMS keeps its 250-word floor): analysis prose states no figures, so it needs no citations. */
export const LONG = `${GOOD}\n\n## Por qué verla en abierto\n\n${Array.from({ length: 9 }, () =>
  'La película funciona como retrato de una familia que confunde lealtad y negocio, y su ritmo pausado premia verla sin cortes ni distracciones. ' +
  'Para quien la descubre ahora, conviene fijarse en cómo cada escena de celebración esconde una decisión que cambia el destino de los personajes.').join(' ')}`;
