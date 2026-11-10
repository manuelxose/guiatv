import type { TvReadItemDTO } from '../api/models';
import type { AssistantMemorySnapshot } from '../interfaces/chatbot.interface';
import type { UserContentInteraction } from '../interfaces/user.interface';
import { PREFERENCE_QUESTIONS, PreferenceOption } from '../interfaces/chat-profile.types';

/** Every genre the profile offers: the broad TV genres of the assistant questions plus film/series genres. */
export const GENRE_OPTIONS: PreferenceOption[] = [
  ...(PREFERENCE_QUESTIONS.find((q) => q.key === 'likedGenres')?.options ?? []),
  ...['Acción', 'Drama', 'Comedia', 'Terror', 'Ciencia ficción', 'Suspense', 'Romance', 'Animación'].map((value) => ({ value, label: value })),
];

/**
 * The viewer profile the AI tab draws: built only from what the user set (profile + assistant memory) and what
 * they did (watched/rated), so every number and sentence on screen can be traced back to real data.
 */

export const norm = (v: string): string => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** The chat's memory extractor stores short forms ("pareja", "sin terror", "evitar netflix"); the UI shows the full option. */
const STRIP = /^(sin|evitar|nada de|no)\s+/;
export const sameValue = (a: string, b: string): boolean => {
  const x = norm(a).replace(STRIP, '').replace(/^(en|con)\s+/, '');
  const y = norm(b).replace(STRIP, '').replace(/^(en|con)\s+/, '');
  return x === y || (x.length > 3 && y.length > 3 && (x.startsWith(y) || y.startsWith(x)));
};

export interface Affinity {
  genre: string;
  score: number;
  /** 0–100, relative to the strongest genre. */
  pct: number;
  /** Where the score comes from, shown under the bar. */
  sources: string[];
}

/**
 * Genre affinity: +3 for each genre the user picked, +1 per watched title of that genre (+ its stars − 3 when rated),
 * −4 for genres they dislike. Only positive scores are kept, strongest first.
 */
export function genreAffinity(likedGenres: string[], memory: AssistantMemorySnapshot | null, history: UserContentInteraction[], limit = 6): Affinity[] {
  const acc = new Map<string, { genre: string; score: number; picked: boolean; watched: number }>();
  const bump = (genre: string, by: number, kind: 'picked' | 'watched' | 'none') => {
    const key = norm(genre).replace(STRIP, '');
    if (!key) return;
    const entry = acc.get(key) ?? { genre: genre.replace(/^(sin|evitar)\s+/i, ''), score: 0, picked: false, watched: 0 };
    entry.score += by;
    if (kind === 'picked') entry.picked = true;
    if (kind === 'watched') entry.watched++;
    acc.set(key, entry);
  };
  [...likedGenres, ...(memory?.likedGenres ?? [])].forEach((g) => bump(g, 3, 'picked'));
  for (const item of history) {
    if (item.status === 'dropped') continue;
    for (const g of item.genres ?? []) bump(g, 1 + (item.rating ? item.rating - 3 : 0), 'watched');
  }
  (memory?.dislikedGenres ?? []).forEach((g) => bump(g, -4, 'none'));

  const ranked = [...acc.values()].filter((e) => e.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  const top = ranked[0]?.score || 1;
  return ranked.map((e) => ({
    genre: e.genre,
    score: e.score,
    pct: Math.round((e.score / top) * 100),
    sources: [e.picked ? 'lo elegiste' : '', e.watched ? `${e.watched} ${e.watched === 1 ? 'visto' : 'vistos'}` : ''].filter(Boolean),
  }));
}

const DURATION_TEXT: Record<string, string> = { corto: 'cosas de menos de una hora', episodio: 'episodios de 30–45 minutos', largo: 'historias largas' };
const list = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/** "Your portrait": one plain sentence per thing the assistant knows; empty when it knows nothing yet. */
export function tasteSummary(platforms: string[], likedGenres: string[], memory: AssistantMemorySnapshot | null): string[] {
  const m = memory;
  const out: string[] = [];
  const contexts = (m?.preferredViewingContexts ?? []).map((c) => norm(c).replace(/^(en|con)\s+/, ''));
  if (contexts.length) out.push(`Sueles ver la tele ${list(contexts.map((c) => (c === 'solo' ? 'solo' : c === 'amigos' ? 'con amigos' : `en ${c}`)))}.`);
  if (m?.preferredDurations?.length) out.push(`Prefieres ${list(m.preferredDurations.map((d) => DURATION_TEXT[d] ?? d))}.`);
  if (platforms.length) out.push(`Tienes ${list(platforms)}.`);
  if (likedGenres.length) out.push(`Te gusta ${list(likedGenres.slice(0, 5).map((g) => g.toLowerCase()))}.`);
  if (m?.favoriteFranchisesOrTitles?.length) out.push(`Tus referencias: ${list(m.favoriteFranchisesOrTitles.slice(0, 4))}.`);
  const avoid = [...(m?.dislikedGenres ?? []), ...(m?.negativeSignals ?? []).map((s) => s.replace(STRIP, ''))];
  const uniqueAvoid = avoid.filter((v, i) => avoid.findIndex((w) => sameValue(v, w)) === i);
  if (uniqueAvoid.length) out.push(`Evitas ${list(uniqueAvoid.slice(0, 4).map((s) => s.toLowerCase()))}.`);
  if (m?.avoidedPlatforms?.length) out.push(`No quieres recomendaciones de ${list(m.avoidedPlatforms)}.`);
  if (m?.preferredAutonomousCommunity) out.push(`Incluimos la tele autonómica de ${m.preferredAutonomousCommunity}.`);
  return out;
}

export interface TonightPick {
  item: TvReadItemDTO;
  reason: string;
  score: number;
}

/** TV airings only carry broad categories; the user's genres map onto them. */
const CATEGORY_FOR: Record<string, string[]> = {
  cine: ['cine'], series: ['series'], documental: ['documental'], deportes: ['deportes'], infantil: ['infantil'],
  entretenimiento: ['entretenimiento'], informativos: ['noticias', 'informativos'], cultura: ['culture', 'cultural'],
  musica: ['musica'], motor: ['deportes'],
};
/** Film/series genres: the guide cannot tell a drama from a comedy, so they only point to Cine and Series. */
const FILM_GENRES = ['accion', 'drama', 'comedia', 'terror', 'ciencia ficcion', 'suspense', 'romance', 'animacion', 'thriller', 'fantasia'];

/**
 * Tonight's airings ranked for this viewer: +3 when its category is one the user likes, +1 when it is cine/series
 * and they like film genres, +2 on a favourite channel, +1 for their region. Anything in an avoided category is
 * dropped, and so is anything with no reason at all.
 */
export function rankTonight(items: TvReadItemDTO[], ctx: { likedGenres: string[]; avoid: string[]; favoriteChannelIds: string[]; community?: string }, limit = 6): TonightPick[] {
  const liked = ctx.likedGenres.map((g) => norm(g));
  const direct = new Set(liked.flatMap((g) => CATEGORY_FOR[g] ?? []));
  const likesFilm = liked.some((g) => FILM_GENRES.includes(g));
  const avoid = ctx.avoid.map((a) => norm(a).replace(STRIP, '').replace(/^contenido\s+/, '')).filter(Boolean);
  const seen = new Set<string>();
  const picks: TonightPick[] = [];
  for (const item of items) {
    const tags = [item.program.editorialCategory, item.program.genre, item.program.subgenre].filter(Boolean).map((t) => norm(String(t)));
    if (avoid.some((a) => tags.some((t) => t.includes(a) || (a.startsWith('reality') && t.includes('reality'))))) continue;
    const key = norm(item.program.title);
    if (seen.has(key)) continue;
    let score = 0;
    let reason = '';
    const category = tags.find((t) => [...direct].some((c) => t.startsWith(c)));
    if (category) {
      score += 3;
      reason = `${item.program.editorialCategory || item.program.genre}, de lo que te gusta`;
    } else if (likesFilm && tags.some((t) => t.startsWith('cine') || t.startsWith('series'))) {
      score += 1;
      reason = tags.some((t) => t.startsWith('cine')) ? 'Cine, como te gusta' : 'Series, como te gustan';
    }
    if (ctx.favoriteChannelIds.includes(item.channel.id)) {
      score += 2;
      reason ||= 'En uno de tus canales';
    }
    if (ctx.community && norm(item.channel.region ?? '') === norm(ctx.community)) {
      score += 1;
      reason ||= `Tele de ${ctx.community}`;
    }
    if (!score) continue;
    seen.add(key);
    picks.push({ item, reason, score });
  }
  return picks.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Ready-made questions built from what the assistant knows, so a tap asks something actually personal. */
export function smartPrompts(platforms: string[], memory: AssistantMemorySnapshot | null, pendingTitles: string[]): string[] {
  const out: string[] = [];
  const ref = memory?.favoriteFranchisesOrTitles?.[0];
  const platform = platforms[0];
  if (ref) out.push(platform ? `Algo parecido a ${ref} en ${platform}` : `Algo parecido a ${ref}`);
  const ctx = memory?.preferredViewingContexts?.[0];
  const short = memory?.preferredDurations?.includes('corto') || memory?.preferredDurations?.includes('episodio');
  out.push(`¿Qué veo esta noche${ctx ? ` ${norm(ctx).startsWith('en') || norm(ctx).startsWith('con') ? ctx.toLowerCase() : `en ${ctx.toLowerCase()}`}` : ''}${short ? ' que dure menos de una hora' : ''}?`);
  if (pendingTitles.length) out.push(`De mi lista (${pendingTitles.slice(0, 3).join(', ')}), ¿cuál veo hoy?`);
  if (memory?.preferredAutonomousCommunity) out.push(`¿Qué echan hoy en la tele de ${memory.preferredAutonomousCommunity}?`);
  if (platforms.length > 1) out.push(`Estrenos de esta semana en ${list(platforms.slice(0, 3))}`);
  out.push('¿Qué partidos dan hoy en abierto?');
  return out.slice(0, 5);
}
