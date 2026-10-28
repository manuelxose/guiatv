import type { EditorialModel, EditorialTopic, RouteTable } from './EditorialAgentPipeline';
import {
  CostLedger, CostSummary, DEFAULT_EDITORIAL_LIMITS, EditorialLimits, EditorialVolatility, OFFICIAL_DOMAINS, REVIEW_CADENCE_DAYS, sourceKindFor,
} from './EditorialEvidence';

/**
 * M11-F autonomous topic queue. A model may PROPOSE topics (discovery); whether one enters the queue, its score and
 * the order of work are decided here, deterministically, so every decision can be explained and tested.
 */

export type TopicState = 'queued' | 'running' | 'published' | 'held' | 'rejected' | 'expired';

/** What the discovery model proposes (validated here, never trusted). */
export interface TopicProposal {
  slug: string;
  title: string;
  topic: string;
  intent: string;
  category: string;
  volatility: EditorialVolatility;
  seedUrls: string[];
  notes?: string;
  /** ISO date after which the topic is no longer useful (a season, a launch); absent = evergreen. */
  freshUntil?: string;
  /** Model-assessed reader demand 1-5; one input of the score, labelled as such. */
  readerNeed?: number;
  whyDistinct?: string;
}

export interface QueuedTopic {
  id: string;
  title: string;
  intent: string;
  category: string;
  sourceCandidates: string[];
  sourceFamilies: string[];
  score: number;
  scoreExplanation: string[];
  freshUntil: string | null;
  duplicateCheck: { maxSimilarity: number; closest: string | null };
  createdAt: string;
  updatedAt: string;
  state: TopicState;
  reason?: string;
  attempts: number;
  /** The pipeline input, built once when the topic is accepted. */
  topic: EditorialTopic;
  publicUrl?: string;
}

export interface TopicQueueFile {
  version: 1;
  lastDiscoveryAt?: string;
  topics: QueuedTopic[];
}

/** Coverage already on the site or in flight: what a new topic must not duplicate. */
export interface CoverageItem { slug: string; title: string; categories?: string[]; sourceFamilies?: string[] }

export interface QueuePolicy {
  /** Titles/intents at or above this token overlap are the same reader need. */
  duplicateSimilarity: number;
  /** Max topics (published in the window + queued) leaning on one source family, e.g. one law. */
  maxPerSourceFamily: number;
  /** Max queued topics per category, so one family cannot fill the queue. */
  maxQueuedPerCategory: number;
  /** Max topics started per category per day. */
  maxPerCategoryPerDay: number;
  /** A run held this many times leaves the queue. */
  maxAttempts: number;
  /** Rejected candidates are remembered this long, so discovery does not propose them again. */
  rejectedMemoryDays: number;
}

export const DEFAULT_QUEUE_POLICY: Readonly<QueuePolicy> = Object.freeze({
  duplicateSimilarity: 0.45,
  maxPerSourceFamily: 3,
  maxQueuedPerCategory: 3,
  maxPerCategoryPerDay: 2,
  maxAttempts: 2,
  rejectedMemoryDays: 60,
});

/** Editorial families GuíaTV covers; a category outside them is not a GuíaTV topic. */
export const TOPIC_CATEGORIES = ['Televisión', 'Cine', 'Series', 'Streaming', 'Fútbol', 'Deportes', 'Tecnología'] as const;

const STOPWORDS = new Set(('para como cual cuales cuando donde desde entre hasta sobre todo todos todas este esta estos estas '
  + 'que qué del las los una unos unas por sin con más mas sus son ser hay muy tambien también puede pueden españa espana '
  + 'guia guía 2025 2026 2027').split(' '));

/** Lower-case, accent-free content words (4+ letters), for overlap checks. */
export function topicTokens(text: string): Set<string> {
  const words = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9ñ]+/);
  return new Set(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

/** Jaccard overlap of two token sets: 0 = unrelated, 1 = same words. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** One source family = one publisher document set: a BOE law by its id, otherwise host + first path segment. */
export function sourceFamily(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host.endsWith('boe.es') && u.searchParams.get('id')) return `boe.es:${u.searchParams.get('id')}`;
    return `${host}/${u.pathname.split('/').filter(Boolean)[0] ?? ''}`;
  } catch {
    return 'invalid';
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/;
/** Distinct publishing hosts among seed URLs (www. ignored). */
export function seedPublishers(urls: string[]): number {
  return new Set(urls.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } })).size;
}
const LIFESPAN_POINTS: Record<EditorialVolatility, number> = { stable: 15, 'sports-rights': 12, pricing: 8, availability: 8, 'catalog-ranking': 6, 'tv-schedule': 0 };

export interface ScreenContext {
  now: Date;
  coverage: CoverageItem[];
  queue: QueuedTopic[];
  policy?: QueuePolicy;
}

/** Deterministic eligibility. Returns every reason a proposal cannot be queued (empty = eligible so far). */
export function screenProposal(p: TopicProposal, ctx: ScreenContext): string[] {
  const policy = ctx.policy ?? DEFAULT_QUEUE_POLICY;
  const reasons: string[] = [];
  if (!SLUG.test(String(p.slug)) || p.slug.length > 80) reasons.push('invalid-candidate: slug');
  if (String(p.title || '').length < 20 || String(p.title).length > 110) reasons.push('invalid-candidate: título');
  if (String(p.intent || '').length < 20 || String(p.topic || '').length < 20) reasons.push('invalid-candidate: tema o intención');
  if (!(TOPIC_CATEGORIES as readonly string[]).includes(p.category)) reasons.push(`invalid-candidate: categoría ${p.category}`);
  if (!(p.volatility in REVIEW_CADENCE_DAYS)) reasons.push('invalid-candidate: volatilidad');
  // A one-day schedule is programmatic, not editorial: it would need daily re-verification to stay true.
  else if (REVIEW_CADENCE_DAYS[p.volatility] < 7) reasons.push('low-value: vida útil inferior a una semana');
  if (p.freshUntil !== undefined) {
    const until = Date.parse(p.freshUntil);
    if (!Number.isFinite(until)) reasons.push('invalid-candidate: freshUntil');
    else if (until < ctx.now.getTime() + 3 * 864e5) reasons.push('expired: la oportunidad caduca en menos de 3 días');
  }
  const seeds = Array.isArray(p.seedUrls) ? p.seedUrls : [];
  if (!seeds.length || seeds.length > 4) reasons.push('insufficient-evidence: 1-4 fuentes semilla');
  for (const url of seeds) {
    if (!/^https:\/\//.test(url)) { reasons.push(`invalid-candidate: semilla ${url}`); continue; }
    // Primary sources only: press can corroborate during research, it cannot be the reason a topic exists.
    const kind = sourceKindFor(url);
    if (kind !== 'official' && kind !== 'dataset') reasons.push(`source-reliability: ${new URL(url).hostname} no es fuente primaria`);
  }
  // The value gate needs GuíaTV data or verified claims from two publishers (EditorialEvidence `no-distinct-value`):
  // a topic resting on one publisher cannot pass it, however well it is written (M11-F canary).
  if (seeds.length && seedPublishers(seeds) < 2) reasons.push('insufficient-evidence: una sola entidad editora entre las fuentes semilla (hacen falta dos)');
  const taken = new Set([...ctx.coverage.map((c) => c.slug), ...ctx.queue.map((q) => q.id)]);
  if (taken.has(p.slug)) reasons.push('duplicate: slug ya usado');
  const dup = closestCoverage(p, ctx);
  if (dup.maxSimilarity >= policy.duplicateSimilarity) reasons.push(`duplicate: misma intención que ${dup.closest} (${dup.maxSimilarity.toFixed(2)})`);
  const families = new Set(seeds.map(sourceFamily));
  const active = ctx.queue.filter((q) => q.state === 'queued' || q.state === 'running' || q.state === 'published');
  for (const f of families) {
    const used = active.filter((q) => q.sourceFamilies.includes(f)).length + ctx.coverage.filter((c) => c.sourceFamilies?.includes(f)).length;
    if (used >= policy.maxPerSourceFamily) reasons.push(`source-concentration: ${f} ya respalda ${used} temas`);
  }
  if (ctx.queue.filter((q) => q.state === 'queued' && q.category === p.category).length >= policy.maxQueuedPerCategory) {
    reasons.push(`category-concentration: ya hay ${policy.maxQueuedPerCategory} temas de ${p.category} en cola`);
  }
  return reasons;
}

/** The most similar existing, queued or recently rejected topic (title + intent words). */
export function closestCoverage(p: Pick<TopicProposal, 'title' | 'intent' | 'slug'>, ctx: ScreenContext): QueuedTopic['duplicateCheck'] {
  const policy = ctx.policy ?? DEFAULT_QUEUE_POLICY;
  const mine = topicTokens(`${p.title} ${p.intent}`);
  const memory = ctx.now.getTime() - policy.rejectedMemoryDays * 864e5;
  const others: Array<{ id: string; text: string }> = [
    ...ctx.coverage.map((c) => ({ id: c.slug, text: `${c.title} ${c.slug.replace(/-/g, ' ')}` })),
    ...ctx.queue.filter((q) => q.state !== 'rejected' || Date.parse(q.updatedAt) >= memory).map((q) => ({ id: q.id, text: `${q.title} ${q.intent}` })),
  ];
  let best = { maxSimilarity: 0, closest: null as string | null };
  for (const o of others) {
    const s = similarity(mine, topicTokens(o.text));
    if (s > best.maxSimilarity) best = { maxSimilarity: Number(s.toFixed(3)), closest: o.id };
  }
  return best;
}

export interface SeedCheck { url: string; status: number; ok: boolean; note: string }

/**
 * Evidence completeness: each seed must be readable without JavaScript and actually talk about the topic
 * (a model can name a plausible URL that does not exist, or a page about something else).
 */
export async function checkSeeds(p: TopicProposal, fetchSource: (url: string) => Promise<{ status: number; text: string }>): Promise<SeedCheck[]> {
  const words = [...topicTokens(`${p.title} ${p.intent}`)];
  const out: SeedCheck[] = [];
  for (const url of p.seedUrls) {
    const res = await fetchSource(url.split('#')[0]).catch(() => ({ status: 0, text: '' }));
    const text = res.text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const hits = words.filter((w) => text.includes(w)).length;
    const ok = res.status === 200 && text.length >= 800 && hits >= Math.min(3, words.length);
    out.push({ url, status: res.status, ok, note: res.status !== 200 ? `HTTP ${res.status}` : text.length < 800 ? 'página sin texto legible (¿SPA?)' : `${hits}/${words.length} términos del tema` });
  }
  return out;
}

/** Explainable 0-100 score. Every component is reported with its reason. */
export function scoreProposal(p: TopicProposal, ctx: ScreenContext & { seeds: SeedCheck[]; linkTargets: number; publishedCategories: string[] }): { score: number; explanation: string[] } {
  const policy = ctx.policy ?? DEFAULT_QUEUE_POLICY;
  const parts: Array<[string, number, string]> = [];
  const verified = ctx.seeds.filter((s) => s.ok);
  const publishers = new Set(verified.map((s) => new URL(s.url).hostname.replace(/^www\./, ''))).size;
  parts.push(['evidencia', Math.round(25 * (verified.length / Math.max(1, ctx.seeds.length))) + (publishers >= 2 ? 5 : 0), `${verified.length}/${ctx.seeds.length} semillas verificadas, ${publishers} editor(es)`]);
  parts.push(['vida útil', LIFESPAN_POINTS[p.volatility] ?? 0, `volatilidad ${p.volatility}`]);
  const dup = closestCoverage(p, ctx);
  parts.push(['novedad', Math.round(20 * Math.max(0, 1 - dup.maxSimilarity / policy.duplicateSimilarity)), `solapamiento máximo ${dup.maxSimilarity} con ${dup.closest ?? '—'}`]);
  parts.push(['enlazado interno', Math.min(10, 2 * ctx.linkTargets), `${ctx.linkTargets} páginas de GuíaTV relacionadas`]);
  const sameCategory = ctx.publishedCategories.filter((c) => c === p.category).length;
  parts.push(['diversidad', sameCategory === 0 ? 10 : sameCategory < 3 ? 5 : 0, `${sameCategory} guías publicadas en ${p.category}`]);
  const need = Math.max(1, Math.min(5, Math.round(Number(p.readerNeed) || 1)));
  parts.push(['demanda (estimada por el modelo)', 2 * need, `${need}/5`]);
  const fresh = p.freshUntil ? Date.parse(p.freshUntil) - ctx.now.getTime() : Infinity;
  parts.push(['actualidad', fresh < 45 * 864e5 ? 10 : 0, p.freshUntil ? `útil hasta ${p.freshUntil.slice(0, 10)}` : 'atemporal']);
  return { score: parts.reduce((s, [, v]) => s + v, 0), explanation: parts.map(([k, v, why]) => `${k} ${v}: ${why}`) };
}

/** The pipeline input for an accepted proposal. Internal sources are GuíaTV pages the article may cite. */
export function topicFor(p: TopicProposal, internalSources: EditorialTopic['internalSources'] = []): EditorialTopic {
  return {
    slug: p.slug, topic: p.topic, intent: p.intent, volatility: p.volatility, categories: [p.category],
    internalSources, seedUrls: p.seedUrls,
    notes: [p.notes, 'Cita solo lo que digan literalmente las fuentes; si un dato no aparece, no lo incluyas.'].filter(Boolean).join(' '),
  };
}

/**
 * Restart recovery and expiry. A topic left `running` by a dead runner goes back to the queue (counted as an attempt);
 * one past its freshness deadline expires. Only called while holding the runner lock.
 */
export function recoverQueue(file: TopicQueueFile, now: Date, policy: QueuePolicy = DEFAULT_QUEUE_POLICY): string[] {
  const notes: string[] = [];
  for (const t of file.topics) {
    if (t.state === 'running') {
      t.attempts++;
      t.state = t.attempts >= policy.maxAttempts ? 'held' : 'queued';
      t.reason = 'ejecución interrumpida';
      t.updatedAt = now.toISOString();
      notes.push(`${t.id}: interrumpido → ${t.state}`);
    }
    if (t.state === 'queued' && !t.topic.internalSources.length && seedPublishers(t.topic.seedUrls ?? []) < 2) {
      Object.assign(t, { state: 'rejected', reason: 'insufficient-evidence: una sola entidad editora verificada (el gate de valor exige dos o datos propios)', updatedAt: now.toISOString() });
      notes.push(`${t.id}: una sola entidad editora → rejected`);
    }
    if (t.state === 'queued' && t.freshUntil && Date.parse(t.freshUntil) < now.getTime() + 864e5) {
      t.state = 'expired';
      t.reason = `caducó el ${t.freshUntil.slice(0, 10)}`;
      t.updatedAt = now.toISOString();
      notes.push(`${t.id}: caducado`);
    }
  }
  return notes;
}

/**
 * The next topics to run: best score first, at most one per category per cycle and `maxPerCategoryPerDay` per day,
 * so the daily allowance is never spent on one family.
 */
export function pickTopics(file: TopicQueueFile, n: number, startedToday: QueuedTopic[], policy: QueuePolicy = DEFAULT_QUEUE_POLICY): QueuedTopic[] {
  const picked: QueuedTopic[] = [];
  const perCategory = new Map<string, number>();
  for (const t of startedToday) perCategory.set(t.category, (perCategory.get(t.category) ?? 0) + 1);
  for (const t of file.topics.filter((x) => x.state === 'queued').sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt))) {
    if (picked.length >= n) break;
    if (picked.some((p) => p.category === t.category)) continue;
    if ((perCategory.get(t.category) ?? 0) >= policy.maxPerCategoryPerDay) continue;
    picked.push(t);
  }
  return picked;
}

const PROPOSAL_SCHEMA = {
  type: 'object', required: ['candidates'], additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['slug', 'title', 'topic', 'intent', 'category', 'volatility', 'seedUrls', 'readerNeed', 'whyDistinct'],
        properties: {
          slug: { type: 'string' }, title: { type: 'string' }, topic: { type: 'string' }, intent: { type: 'string' },
          category: { type: 'string', enum: [...TOPIC_CATEGORIES] },
          volatility: { type: 'string', enum: Object.keys(REVIEW_CADENCE_DAYS) },
          seedUrls: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, freshUntil: { type: 'string' },
          readerNeed: { type: 'integer' }, whyDistinct: { type: 'string' },
        },
      },
    },
  },
};

export interface DiscoveryContext {
  now: Date;
  coverage: CoverageItem[];
  queue: QueuedTopic[];
  /** GuíaTV's own public sections and data (channel names, hubs), so topics can use and link them. */
  siteInventory: string;
}

/**
 * One model call that PROPOSES topics. It has no web access through the gateway, so seed URLs come from its knowledge
 * and are only accepted after `checkSeeds` reads them. Returns the raw proposals and the call's estimated cost.
 */
export async function proposeTopics(models: readonly EditorialModel[], routes: RouteTable, ctx: DiscoveryContext, limits: EditorialLimits = DEFAULT_EDITORIAL_LIMITS): Promise<{ proposals: TopicProposal[]; cost: CostSummary; model: string }> {
  const route = routes.research.find((r) => models.some((m) => m.provider === r.provider));
  const adapter = route && models.find((m) => m.provider === route.provider);
  if (!route || !adapter) throw new Error('discovery: ninguna ruta de investigación disponible');
  const recentRejected = ctx.queue.filter((q) => q.state === 'rejected').slice(-15).map((q) => `- ${q.title} (${q.reason})`).join('\n');
  const ledger = new CostLedger({ ...limits, maxArticleUsd: Infinity });
  const result = await adapter.call({
    role: 'research', provider: route.provider, model: route.model, effort: 'medium',
    system: 'Eres el jefe de contenidos de GuíaTV, una guía de televisión, cine, series, streaming y fútbol en España. Propones temas de guía útiles y verificables. No inventas URLs: solo propones páginas oficiales que sabes que existen y que se leen sin JavaScript.',
    prompt: `Fecha: ${ctx.now.toISOString().slice(0, 10)}
Guías ya publicadas (no repitas su intención):\n${ctx.coverage.map((c) => `- ${c.title} [${(c.categories ?? []).join(', ')}]`).join('\n')}
En cola:\n${ctx.queue.filter((q) => q.state === 'queued' || q.state === 'running').map((q) => `- ${q.title}`).join('\n') || '(nada)'}
Descartados recientes (no los vuelvas a proponer sin corregir el motivo):\n${recentRejected || '(ninguno)'}
Secciones y datos propios de GuíaTV:\n${ctx.siteInventory}

Propón hasta 8 temas de guía distintos entre sí, repartidos entre categorías (${TOPIC_CATEGORIES.join(', ')}), que un lector en España busque y que se puedan respaldar con fuentes primarias.
Reglas:
- Cada tema tiene 2-4 seedUrls de al menos DOS entidades editoras distintas (por ejemplo la ley en el BOE y el regulador o la plataforma afectada); un tema con un solo editor no se puede publicar. Solo https de fuentes primarias en estos dominios: ${SEED_DOMAINS.join(', ')}. URLs exactas de páginas que existen y tienen el dato en el HTML (por ejemplo una ley consolidada en boe.es/buscar/act.php?id=…, una página de ayuda o de condiciones de una plataforma). Nada de portadas genéricas.
- No dependas siempre de la misma ley o del mismo organismo: busca fuentes de familias distintas.
- Nada de programación del día ni listados que caduquen en días (volatilidad tv-schedule no vale).
- slug en minúsculas con guiones (3-8 palabras); title de 20-100 caracteres; intent = la pregunta concreta del lector.
- notes: qué fuentes usar para qué y qué evitar (cifras o nombres que no estén en ellas).
- freshUntil (AAAA-MM-DD) solo si el tema deja de ser útil en una fecha concreta.
- readerNeed 1-5 = demanda esperada; whyDistinct = qué aporta frente a lo ya publicado.`,
    schema: PROPOSAL_SCHEMA,
  });
  ledger.charge('discovery', route.model, result.usage, result.searches ?? 0);
  const proposals = (result.json as { candidates?: TopicProposal[] })?.candidates;
  return { proposals: Array.isArray(proposals) ? proposals : [], cost: ledger.summary, model: route.model };
}

/** Domains a discovery prompt may propose as seeds (the same list the evidence gate trusts). */
export const SEED_DOMAINS: readonly string[] = OFFICIAL_DOMAINS;
