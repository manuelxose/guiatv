import {
  AI_AUTHOR,
  aiDisclosure,
  CostLedger,
  CostSummary,
  CriticReview,
  DEFAULT_EDITORIAL_LIMITS,
  EditorialBudgetExceeded,
  EditorialLimits,
  EditorialPipelineState,
  EditorialProvenance,
  EditorialVolatility,
  EvidenceBundle,
  EvidenceClaim,
  evaluateEvidence,
  hashBundle,
  hashText,
  measureValue,
  metadataHash,
  nextReviewAt,
  signProvenance,
  sourceKindFor,
  stripClaimMarkers,
  ValueSignals,
  verifyBundle,
  IMAGE_PRICES,
  ImageAsset,
  MODEL_PRICES,
} from './EditorialEvidence';
import { EditorialFinding, evaluateEditorialQuality, policyGateFailures } from './EditorialReviewPolicy';
import { coverAsset, coverRequest, ImageModel, imageProblems, ImageRoute } from './EditorialImages';

/**
 * M11-B editorial workflow: research → evidence → editorial → SEO → independent critic → publisher gates.
 * Roles are prompts over one injectable model client; the orchestration and every gate are plain code.
 * The output is a reviewable CMS draft plus its provenance; nothing here writes to a database.
 */

export const PIPELINE_VERSION = 'm11e2-1';
export type EditorialRole = 'research' | 'evidence' | 'editorial' | 'seo' | 'critic';

export interface ModelRoute { provider: string; model: string; effort: 'low' | 'medium' | 'high' }
/** Per role, in order of preference: primary first, then fallbacks. */
export type RouteTable = Readonly<Record<EditorialRole, readonly ModelRoute[]>>;
const ROLES: readonly EditorialRole[] = ['research', 'evidence', 'editorial', 'seo', 'critic'];

/**
 * Role routing (docs/adr/0001): strong models where facts are decided, a cheap one for mechanical metadata.
 * A route names its provider; an adapter refuses routes for another provider, so nothing is silently re-routed.
 */
export const DEFAULT_ROUTES: RouteTable = Object.freeze({
  research: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }],
  evidence: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }],
  editorial: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' }],
  seo: [{ provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' }, { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low' }],
  critic: [{ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' }],
});
/** No real image provider is verified yet (prices, terms): covers need an explicit route, e.g. the local mock. */
export const DEFAULT_IMAGE_ROUTES: readonly ImageRoute[] = Object.freeze([]);

/** Providers with a real adapter in this codebase. Policy approval trusts signed provenance only from these. */
export const LIVE_PROVIDERS: ReadonlySet<string> = new Set(['anthropic']);
export const LIVE_IMAGE_PROVIDERS: ReadonlySet<string> = new Set<string>();

/**
 * Why provenance may not publish by policy (null = it may): every text provider that answered, and every
 * image provider, must be live. Replayed, scripted and mock output always needs a named reviewer.
 */
export function policyProviderProblem(p: Pick<EditorialProvenance, 'backend' | 'images'>): string | null {
  const text = String(p.backend ?? '').split('+');
  if (!text.every((provider) => LIVE_PROVIDERS.has(provider))) return `proveedor de texto no verificado: ${p.backend ?? 'ninguno'}`;
  const image = (p.images ?? []).find((i) => !LIVE_IMAGE_PROVIDERS.has(i.provider));
  return image ? `proveedor de imagen no verificado: ${image.provider}` : null;
}

/**
 * EDITORIAL_ROUTES / EDITORIAL_IMAGE_ROUTES (JSON) override the defaults. Every route must name a priced model,
 * so a configuration typo stops the CLI or the Admin view instead of running an unpriced model.
 */
export function routesFromEnv(env: NodeJS.ProcessEnv = process.env): { routes: RouteTable; imageRoutes: readonly ImageRoute[] } {
  const routes = env.EDITORIAL_ROUTES ? { ...DEFAULT_ROUTES, ...JSON.parse(env.EDITORIAL_ROUTES) } as RouteTable : DEFAULT_ROUTES;
  const imageRoutes = env.EDITORIAL_IMAGE_ROUTES ? JSON.parse(env.EDITORIAL_IMAGE_ROUTES) as ImageRoute[] : DEFAULT_IMAGE_ROUTES;
  for (const role of ROLES) {
    const list = routes[role];
    if (!Array.isArray(list) || !list.length) throw new Error(`EDITORIAL_ROUTES.${role}: at least one route`);
    for (const r of list) {
      if (!r.provider || !MODEL_PRICES[r.model] || !['low', 'medium', 'high'].includes(r.effort)) throw new Error(`EDITORIAL_ROUTES.${role}: invalid or unpriced route ${JSON.stringify(r)}`);
    }
  }
  for (const r of imageRoutes) if (!r.provider || IMAGE_PRICES[r.model] === undefined) throw new Error(`EDITORIAL_IMAGE_ROUTES: unpriced route ${JSON.stringify(r)}`);
  return { routes, imageRoutes };
}

type Chosen = Record<EditorialRole, { route: ModelRoute; model: EditorialModel }>;
/**
 * Fallback = the first route, in order, whose provider has a configured adapter, whose model is priced and,
 * for research, whose adapter can search the web. Chosen once per job: a failure later holds the job.
 */
export function chooseRoutes(table: RouteTable, models: readonly EditorialModel[]): Chosen {
  const chosen = {} as Chosen;
  for (const role of ROLES) {
    const pick = table[role]
      .map((route) => ({ route, model: models.find((m) => m.provider === route.provider) }))
      .find(({ route, model }) => model && MODEL_PRICES[route.model] && (role !== 'research' || model.webSearch));
    if (!pick) throw new Error(`${role}: ninguna ruta disponible${role === 'research' ? ' con búsqueda web' : ''}`);
    chosen[role] = pick as Chosen[EditorialRole];
  }
  return chosen;
}

export interface ModelCall {
  role: EditorialRole;
  provider: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  system: string;
  prompt: string;
  /** JSON schema the answer must match. */
  schema: Record<string, unknown>;
  /** Allow up to N web searches (research only). */
  webSearches?: number;
}
export interface ModelResult {
  json: unknown;
  usage: { input_tokens: number; output_tokens: number };
  searches?: number;
}
export interface EditorialModel {
  /** Who answers: recorded as the provenance backend ('anthropic', 'replay', …). */
  readonly provider: string;
  /** Can retrieve web pages itself (server tools); research routes require it. */
  readonly webSearch?: boolean;
  /** Output cap of one request: the ledger needs this much headroom before it lets a call start. */
  readonly maxOutputTokens?: number;
  call(request: ModelCall): Promise<ModelResult>;
}

/** A failed call whose billed usage is known; any other error leaves the job's spend unresolved. */
export class ModelCallFailed extends Error {
  constructor(message: string, readonly usage: ModelResult['usage'], readonly searches = 0) { super(message); }
}

export interface EditorialTopic {
  slug: string;
  topic: string;
  intent: string;
  volatility: EditorialVolatility;
  categories: string[];
  /** GuíaTV public API reads the article may rely on (programmes, channels, catalogue). */
  internalSources: Array<{ id: string; url: string }>;
  /** Starting points the research agent must consider (e.g. the operator's price page). */
  seedUrls?: string[];
  notes?: string;
  /**
   * M11-F: GuíaTV pages checked by the runner (200, self-canonical, indexable) that fit this topic. When given, they
   * are the only internal links the article may carry, besides the editorial policy page.
   */
  linkTargets?: Array<{ path: string; label: string }>;
}

export interface EditorialDeps {
  /** One adapter answering every primary route (replay, tests)… */
  model?: EditorialModel;
  /** …or configured adapters, routed by provider through `routes` with fallbacks. */
  models?: readonly EditorialModel[];
  routes?: RouteTable;
  /** Cover images: configured image adapters and their routes. No adapter or no route = no cover. */
  images?: readonly ImageModel[];
  imageRoutes?: readonly ImageRoute[];
  fetchSource: (url: string) => Promise<{ status: number; text: string }>;
  /** HTTP status of an internal path on the live site, without following redirects. */
  internalLinkStatus: (path: string) => Promise<number>;
  /** markdown → HTML (marked in the CLI). */
  render: (markdown: string) => string;
  /** Publicly approved posts: duplication and link targets. */
  corpus: Array<{ slug: string; content?: string }>;
  now?: () => Date;
  /** EDITORIAL_PIPELINE_SIGNING_KEY: without it the provenance is unsigned and only a person can approve it. */
  signingKey?: string;
}

export interface CmsDraft {
  title: string;
  slug: string;
  status: 'draft';
  origin: 'ai-assisted';
  excerpt: string;
  content: string;
  categories: string[];
  contentType: 'guide';
  evergreen: boolean;
  targetQuery: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  authorName: string;
  authorId: string;
  coverImage?: string;
  coverAlt?: string;
}

export interface EditorialRun {
  slug: string;
  state: EditorialPipelineState;
  reason?: string;
  draft?: CmsDraft;
  provenance?: EditorialProvenance;
  findings: EditorialFinding[];
  value?: ValueSignals;
  cost: CostSummary;
  /** Generated originals for the media store (not serialised into the run file). */
  media?: Array<{ asset: ImageAsset; bytes: Buffer }>;
  /** Why the article has no cover; the text goes on without one. */
  imageFailure?: string;
  /** M11-E2: every draft version, its critic verdict and gate result, and what the pipeline did next. */
  revisions?: RevisionRecord[];
  /** Sources the research named that could not be read (left out of the evidence). */
  droppedSources?: string[];
  /** M11-E2b: candidates a critic blocked for missing evidence, kept as they were; their signature is never reused. */
  blockedCandidates?: Array<{ draftHash: string; bundleHash: string; critic: CriticReview; signature?: string }>;
}

export interface RevisionRecord {
  attempt: number;
  draftHash: string;
  verdict: CriticReview['verdict'];
  issues: number;
  blocking: string[];
  action: 'pass' | 'block' | 'new-candidate' | 'rewrite' | 're-research' | 'abandon';
  /** The excerpt and metadata were rewritten for this version (the reviewed text was not). */
  repaired?: 'metadata';
  /** Local edits made for deterministic gate defects before the critic saw this version. */
  gateFixes?: number;
}
/** Gate findings that mean the evidence is short, so another rewrite of the same claims cannot fix them. */
const EVIDENCE_GAPS = new Set(['unsupported-claim', 'no-distinct-value']);
/** M11-E2b: gate findings the writer or the SEO agent can fix with a local edit, before the critic sees the draft. */
const WRITER_FIXABLE = new Set([
  'uncited-factual-statement', 'figure-not-in-claim', 'figure-in-words', 'metadata-figure-not-in-claims', 'invalid-metadata',
  'internal-link-status', 'broken-internal-link', 'unsourced-link', 'invalid-link', 'claim-marker-leak', 'fabricated-experience',
  'placeholder-text', 'unknown-claim', 'faq-not-evidenced', 'unverified-internal-link', 'excessive-internal-links',
]);
const MAX_GATE_FIXES = 3;
/** M11-F: a guide links a few relevant GuíaTV pages, not a directory of them. The AI disclosure links the policy page. */
const MAX_INTERNAL_LINKS = 4;
const POLICY_PAGE = '/politica-editorial';

/**
 * M11-E2b: one quality standard for writer and critic. Live runs showed drafts failing on criteria the writer never saw
 * (repetition, filler, inferences), and every rewrite trading old defects for new ones.
 */
export const EDITORIAL_RUBRIC = `Criterios de calidad (los mismos que aplica el crítico):
1. Responde a la intención del lector en el primer párrafo, con el dato concreto.
2. Cada dato aparece una sola vez, donde más ayuda: no repitas la misma información en varias secciones.
3. Sin relleno: cada frase aporta un dato, un criterio o una consecuencia práctica. Nada de frases que anuncian lo que viene o resumen lo ya dicho.
4. No vas más allá de las afirmaciones verificadas: ni inferencias, ni consejos, ni generalizaciones que no respalden. Conservas sus matices (excepciones, condiciones).
5. Recomendaciones solo con su criterio explicado.
6. Estructura escaneable: secciones ## con títulos descriptivos y una tabla cuando se comparan opciones.
7. Tono directo de guía práctica, sin fórmulas genéricas.`;
/** What the deterministic gates check, said to the writer up front instead of after a failed draft. */
const GATE_RULES = `Reglas que comprueba un programa (un fallo impide publicar):
- Markdown con un único "# título"; sin sección de preguntas frecuentes; nunca primera persona ni experiencias propias.
- Toda frase, fila de tabla o elemento de lista con una cifra, fecha, hora, día, mes, precio, canal, disponibilidad o una referencia a una norma («artículo 98.1», «Ley 13/2022») termina con su marcador [[cN]] (o [[c1,c2]]) antes del punto, y esa cifra o referencia aparece en las afirmaciones que cita.
- Escribe cada cifra como en su afirmación (si la afirmación dice «dieciocho», no escribas «18»). No uses cantidades con letras seguidas de unidad («dos euros», «tres horas»).
- Título, resumen, metaTitle y metaDescription: solo cifras que el texto da con marcador y escritas igual (nada de «+18» si el texto dice «dieciocho»).
- Enlaces externos solo a las URL exactas de la lista de fuentes; internos solo a rutas de guiaprogramaciontv.com que aparezcan en los datos propios.
- Extensión: la que pida la intención, sin inflarla.`;
const CRITIC_SEVERITY = `Gravedad de cada problema:
- high: dato falso, no respaldado o mal atribuido; matiz de la fuente perdido que cambia el sentido; el texto no responde a la intención.
- medium: inferencia o consejo más allá de la evidencia; falta información importante para la intención que sí está en las afirmaciones; repetición o relleno que ocupa una parte apreciable del texto; recomendación sin criterio.
- low: mejoras de estilo u orden que no cambian lo que el lector entiende.
Veredicto: block solo si el tema o la evidencia no permiten un artículo útil y veraz; revise si hay algún problema high o medium; pass si solo quedan problemas low o ninguno. Señala cada problema una vez, con la frase concreta y cómo corregirla.`;

/**
 * The stricter of the model's verdict and the rubric applied to its issues: a high or medium issue means revise even if the
 * model said pass. Severities can only tighten the verdict, never loosen it (independent review H-C).
 */
export function criticVerdict(answer: { verdict: CriticReview['verdict']; issues: CriticReview['issues'] }): CriticReview['verdict'] {
  const order = ['pass', 'revise', 'block'] as const;
  const bySeverity = answer.issues.some((i) => i.severity === 'high' || i.severity === 'medium') ? 'revise' : 'pass';
  return order[Math.max(order.indexOf(answer.verdict), order.indexOf(bySeverity))];
}

// ---- prompts & schemas --------------------------------------------------------------------------

const STYLE = `Escribes para GuíaTV (guiaprogramaciontv.com), una guía de televisión y streaming en España.
Español de España, natural y directo. Sin introducciones genéricas, sin relleno, sin superlativos que no estén demostrados,
sin repetir la palabra clave para posicionar. Eres un sistema de IA: nunca afirmes haber probado, visto, usado o entrevistado nada,
ni hables en primera persona del singular. No inventes precios, fechas, horarios, canales, derechos ni disponibilidad.`;

const str = { type: 'string' };
const SOURCE_SCHEMA = { type: 'object', additionalProperties: false, required: ['id', 'url', 'publisher'], properties: { id: str, url: str, publisher: str } };
const CLAIM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'text', 'volatility', 'quotes'],
  properties: {
    id: str, text: str,
    volatility: { type: 'string', enum: ['tv-schedule', 'pricing', 'availability', 'sports-rights', 'catalog-ranking', 'stable'] },
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sourceId', 'quote'], properties: { sourceId: str, quote: str } } },
  },
};
const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['researchQuestions', 'sources', 'claims'],
  properties: { researchQuestions: { type: 'array', items: str }, sources: { type: 'array', items: SOURCE_SCHEMA }, claims: { type: 'array', items: CLAIM_SCHEMA } },
};
const CONFLICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['conflicts'],
  properties: { conflicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claimIds', 'note'], properties: { claimIds: { type: 'array', items: str }, note: str } } } },
};
const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'excerpt', 'metaTitle', 'metaDescription', 'markdown'],
  properties: { title: str, excerpt: str, metaTitle: str, metaDescription: str, markdown: str },
};
const META_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'metaTitle', 'metaDescription'],
  properties: { title: str, metaTitle: str, metaDescription: str },
};
/** M11-E2 metadata repair: the title is the draft's h1 (hashed and criticised), so only these fields may change. */
const META_REPAIR_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['excerpt', 'metaTitle', 'metaDescription'],
  properties: { excerpt: str, metaTitle: str, metaDescription: str },
};
const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'revise', 'block'] },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'message'], properties: { claimId: str, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, message: str } } },
  },
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[…recortado]` : text);
const claimDigest = (claims: EvidenceClaim[]) =>
  claims.map((c) => `- ${c.id} [${c.volatility}] ${c.text}\n${c.quotes.filter((q) => q.verified).map((q) => `    «${q.quote}» (${q.sourceId})`).join('\n')}`).join('\n');

// ---- metadata rules (deterministic SEO) ----------------------------------------------------------

export function metadataProblems(d: { title: string; metaTitle: string; metaDescription: string; excerpt?: string }, slug: string, taken: Set<string>): string[] {
  const out: string[] = [];
  if (d.title.length < 20 || d.title.length > 75) out.push(`título de ${d.title.length} caracteres (20-75)`);
  if (d.metaTitle.length < 15 || d.metaTitle.length > 60) out.push(`metaTitle de ${d.metaTitle.length} caracteres (15-60)`);
  if (d.metaDescription.length < 70 || d.metaDescription.length > 160) out.push(`metaDescription de ${d.metaDescription.length} caracteres (70-160)`);
  if (/(?:…|\.\.\.)$/.test(d.metaTitle) || /(?:…|\.\.\.)$/.test(d.metaDescription)) out.push('metadatos truncados');
  if (d.metaDescription.trim() === d.title.trim()) out.push('la meta descripción repite el título');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) out.push(`slug inválido: ${slug}`);
  if (taken.has(slug)) out.push(`slug ya publicado: ${slug}`);
  return out;
}


// ---- the workflow ------------------------------------------------------------------------------

export async function runEditorialJob(topic: EditorialTopic, deps: EditorialDeps, limits: EditorialLimits = DEFAULT_EDITORIAL_LIMITS): Promise<EditorialRun> {
  const now = deps.now ?? (() => new Date());
  const ledger = new CostLedger(limits);
  const run: EditorialRun = { slug: topic.slug, state: 'draft', findings: [], cost: ledger.summary };
  const table = deps.routes ?? DEFAULT_ROUTES;
  let chosen: Chosen;
  const ask = async <T>(role: EditorialRole, system: string, prompt: string, schema: Record<string, unknown>, webSearches?: number): Promise<T> => {
    const { route: { provider, model, effort }, model: adapter } = chosen[role];
    // Research with server tools may resume up to 4 paused turns (AnthropicEditorialModel), each up to the output cap.
    ledger.assertHeadroom(model, (adapter.maxOutputTokens ?? 0) * (webSearches ? 4 : 1));
    let result: ModelResult;
    try {
      result = await adapter.call({ role, provider, model, effort, system, prompt, schema, webSearches });
    } catch (error) {
      // A failed call can still be billed: charge what is known, otherwise the batch keeps the whole allowance.
      if (error instanceof ModelCallFailed) ledger.charge(role, model, error.usage, error.searches);
      else ledger.summary.unresolved = true;
      throw error;
    }
    ledger.charge(role, model, result.usage, result.searches ?? 0);
    return result.json as T;
  };

  try {
    chosen = deps.models
      ? chooseRoutes(table, deps.models)
      : Object.fromEntries(ROLES.map((role) => [role, { route: table[role][0], model: deps.model! }])) as Chosen;
    // Provenance names every provider that answered, so a mixed route cannot pass as a single live one.
    const backend = [...new Set(ROLES.map((role) => chosen[role].model.provider))].sort().join('+');
    // Internal data first: the research agent may only quote what GuíaTV actually serves.
    const snapshots = new Map<string, string>();
    const retrieval = new Map<string, { retrievedAt?: string; contentHash?: string; httpStatus: number }>();
    const fetchOnce = async (id: string, url: string) => {
      if (retrieval.has(id)) return;
      ledger.count('sourceFetches', limits.maxSourceFetches);
      const res = await deps.fetchSource(url).catch(() => ({ status: 0, text: '' }));
      const ok = res.status === 200 && res.text.trim().length > 0;
      if (ok) snapshots.set(id, res.text);
      retrieval.set(id, { httpStatus: res.status, ...(ok ? { retrievedAt: now().toISOString(), contentHash: hashText(res.text) } : {}) });
    };
    for (const s of topic.internalSources) await fetchOnce(s.id, s.url);
    const internalText = topic.internalSources.filter((s) => snapshots.has(s.id))
      .map((s) => `### ${s.id} ${s.url}\n${clip(snapshots.get(s.id)!, 6000)}`).join('\n\n');
    // M11-E: seed pages are read here, not left to server tools a gateway may not run; publisher = host, never 'GuíaTV'.
    const seeds = (topic.seedUrls ?? []).map((url, i) => ({ id: `s${i + 1}`, url, publisher: new URL(url).hostname.replace(/^www\./, '') }));
    for (const s of seeds) await fetchOnce(s.id, s.url.split('#')[0]);
    // A text fragment (#:~:text=…) points the prompt at the right part of a long page; quotes are still checked against all of it.
    const from = (s: { id: string; url: string }) => {
      const f = /#:~:text=([^&,]+)/.exec(s.url);
      return Math.max(0, f ? snapshots.get(s.id)!.indexOf(decodeURIComponent(f[1])) : 0);
    };
    const seedText = seeds.filter((s) => snapshots.has(s.id))
      .map((s) => `### ${s.id} ${s.url} (${s.publisher})\n${clip(snapshots.get(s.id)!.slice(from(s)), 12000)}`).join('\n\n');

    // 1. Research: sources, verbatim quotes, candidate claims. `gaps` (M11-E2) asks for evidence a review found missing.
    type ResearchAnswer = { researchQuestions: string[]; sources: Array<{ id: string; url: string; publisher: string }>; claims: EvidenceClaim[] };
    let researchCalls = 0;
    const doResearch = (gaps = '') => {
      researchCalls++;
      return ask<ResearchAnswer>('research',
        `${STYLE}\nEres el agente de investigación. Buscas fuentes primarias (webs oficiales de operadores, plataformas, competiciones, organismos) y, solo si no existen, prensa de referencia. No uses agregadores de dudosa procedencia ni copies artículos.`,
        `Tema: ${topic.topic}\nIntención del lector: ${topic.intent}\nVolatilidad: ${topic.volatility}\n${topic.notes ? `Notas: ${topic.notes}\n` : ''}
Datos propios de GuíaTV (fuentes internas con su id; cítalos con ese id):\n${internalText || '(ninguno)'}
${seedText ? `\nFuentes primarias ya descargadas (cítalas con su id; las citas se comprueban contra este texto):\n${seedText}\n` : ''}

Devuelve preguntas de investigación, fuentes (id corto, URL exacta que hayas consultado, editor) y afirmaciones atómicas.
Cada afirmación lleva 1-3 citas literales, copiadas carácter a carácter de la fuente (12-200 caracteres, sin parafrasear) que la prueban, incluidas todas sus cifras.
Una referencia a una norma («artículo 98.1», «Ley 13/2022») solo si la cita está dentro de esa disposición de esa fuente.
Si un dato no aparece literal en una fuente consultada, no lo incluyas. Ids de afirmación: c1, c2…${gaps}`,
        RESEARCH_SCHEMA, 5);
    };
    let research: ResearchAnswer | undefined;
    while (researchCalls < limits.maxResearchCalls && !research?.claims?.length) research = await doResearch();
    if (!research?.claims?.length) return { ...run, state: 'blocked', reason: 'la investigación no devolvió afirmaciones' };

    const fixedIds = new Set([...topic.internalSources, ...seeds].map((s) => s.id));
    // A seed relisted under another id/publisher would count twice in the value gate; an unfetched seed would block approval.
    const seedPages = new Set(seeds.map((s) => s.url.split('#')[0]));
    const sources = [
      ...topic.internalSources.map((s) => ({ id: s.id, url: s.url, publisher: 'GuíaTV' })),
      ...seeds.filter((s) => snapshots.has(s.id)),
      ...research.sources.filter((s) => /^https?:\/\//.test(s.url) && !fixedIds.has(s.id) && !seedPages.has(s.url.split('#')[0])),
    ];
    for (const s of sources) await fetchOnce(s.id, s.url);
    // M11-E2: a page that cannot be read is not evidence; kept in the bundle it blocked every draft (source-not-retrieved).
    const retrieved = (list: Array<{ id: string; url: string; publisher: string }>) => {
      run.droppedSources = [...(run.droppedSources ?? []), ...list.filter((s) => !snapshots.has(s.id)).map((s) => `${s.url} (HTTP ${retrieval.get(s.id)?.httpStatus ?? 0})`)];
      return list.filter((s) => snapshots.has(s.id)).map((s) => ({ ...s, kind: sourceKindFor(s.url), ...retrieval.get(s.id) }));
    };
    // 2. Evidence: deterministic quote verification, then a conflict review that can only demote.
    const assess = async (draftBundle: EvidenceBundle): Promise<EvidenceBundle> => {
      const checked = verifyBundle(draftBundle, snapshots);
      const supported = checked.claims.filter((c) => c.status === 'supported');
      if (supported.length < 2) return checked;
      const review = await ask<{ conflicts: Array<{ claimIds: string[]; note: string }> }>('evidence',
        'Eres el agente de evidencias. Comparas afirmaciones verificadas y señalas solo contradicciones reales entre ellas o con la fecha actual (un dato caducado). No añades información.',
        `Fecha: ${now().toISOString().slice(0, 10)}\nAfirmaciones verificadas con sus citas:\n${claimDigest(supported)}\n\nDevuelve los grupos de ids que se contradicen, con una nota breve. Lista vacía si no hay.`,
        CONFLICT_SCHEMA);
      const known = new Set(supported.map((c) => c.id));
      return verifyBundle({ ...checked, conflicts: [...checked.conflicts, ...review.conflicts.filter((c) => c.claimIds.some((id) => known.has(id)))] }, snapshots);
    };
    let bundle = await assess({
      topic: topic.topic, intent: topic.intent, researchQuestions: research.researchQuestions, createdAt: now().toISOString(), conflicts: [],
      sources: retrieved(sources),
      claims: research.claims.map((c) => ({ id: c.id, text: c.text, volatility: c.volatility, quotes: c.quotes })),
    });
    run.state = 'researched';
    let usable = bundle.claims.filter((c) => c.status === 'supported');
    if (usable.length < 3) return { ...run, state: 'blocked', reason: `solo ${usable.length} afirmaciones verificadas`, provenance: partial(bundle) };

    /** M11-E2 targeted re-research: new claims and sources join the bundle under fresh ids and go through the same checks. */
    const reResearch = async (gaps: string) => {
      const tag = `r${researchCalls + 1}`;
      const more = await doResearch(`\n\nUna revisión encontró estos huecos de evidencia:\n${gaps}\nAfirmaciones descartadas y motivo:\n${bundle.claims.filter((c) => c.status !== 'supported').map((c) => `- ${c.id}: ${c.text} → ${c.note ?? c.status}`).join('\n') || '(ninguna)'}
Devuelve solo afirmaciones nuevas o corregidas que cubran esos huecos, con citas literales. No repitas una afirmación descartada sin corregir el motivo.`);
      const idMap = new Map<string, string>();
      const added: Array<{ id: string; url: string; publisher: string }> = [];
      for (const s of more.sources.filter((x) => /^https?:\/\//.test(x.url))) {
        const same = bundle.sources.find((b) => b.url.split('#')[0] === s.url.split('#')[0]);
        if (same) idMap.set(s.id, same.id);
        else if (!fixedIds.has(s.id)) { idMap.set(s.id, `${tag}-${s.id}`); added.push({ ...s, id: `${tag}-${s.id}` }); }
      }
      for (const s of added) await fetchOnce(s.id, s.url);
      bundle = await assess({
        ...bundle,
        sources: [...bundle.sources, ...retrieved(added)],
        claims: [...bundle.claims, ...more.claims.map((c) => ({ id: `${tag}-${c.id}`, text: c.text, volatility: c.volatility, quotes: c.quotes.map((q) => ({ sourceId: idMap.get(q.sourceId) ?? q.sourceId, quote: q.quote })) }))],
      });
      usable = bundle.claims.filter((c) => c.status === 'supported');
    };

    // 3-5. Editorial ⇄ critic, with deterministic SEO checks in between.
    const taken = new Set(deps.corpus.map((p) => p.slug));
    const sourceList = () => bundle.sources.filter((s) => s.retrievedAt).map((s) => `- ${s.id}: ${s.url} (${s.publisher})`).join('\n');
    let feedback = '';
    let previous = '';
    run.revisions = [];
    type Draft = { title: string; excerpt: string; metaTitle: string; metaDescription: string; markdown: string };
    const writerSystem = `${STYLE}\nEres el agente editorial. Redactas una guía útil y diferente: explica criterios, compara, y aprovecha los datos propios de GuíaTV cuando los haya.\n${EDITORIAL_RUBRIC}`;
    // A function: re-research can add sources between drafts.
    const internalLinks = topic.linkTargets?.length
      ? `\n\nPáginas de GuíaTV que puedes enlazar con una ruta relativa (como mucho ${MAX_INTERNAL_LINKS}, solo si ayudan al lector; ancla descriptiva y distinta en cada una, nunca «aquí»; enlazar no es un dato, pero una frase con un canal o una cifra sigue necesitando su marcador):\n${topic.linkTargets.map((t) => `- ${t.path}: ${t.label}`).join('\n')}`
      : '';
    const writerRules = () => `Fuentes que puedes enlazar:\n${sourceList()}${internalLinks}\n\n${GATE_RULES}`;
    // Everything that does not depend on the critic: the HTML, hashes, the unsigned provenance and the CMS fields.
    const assemble = (d: Draft, verifiedOn: Date, critic?: CriticReview) => {
      const html = `<div class="editorial-body">${deps.render(stripClaimMarkers(d.markdown).replace(/^# .*\n?/m, ''))}${aiDisclosure(verifiedOn)}</div>`;
      const provenance: EditorialProvenance = {
        pipelineVersion: PIPELINE_VERSION, state: 'draft', bundle, bundleHash: hashBundle(bundle), draftMarkdown: d.markdown, draftHash: hashText(d.markdown),
        ...(critic ? { critic } : {}), cost: ledger.summary,
        lastVerifiedAt: verifiedOn.toISOString(), nextReviewAt: nextReviewAt(bundle, d.markdown)?.toISOString(), version: 1, backend,
        // Signed with the verdict: the reviewed excerpt/metadata, and every candidate a critic blocked in this job.
        metadataHash: metadataHash(d),
        ...(run.blockedCandidates?.length ? { blockedCandidates: run.blockedCandidates.map((b) => ({ draftHash: b.draftHash, bundleHash: b.bundleHash, verdict: b.critic.verdict })) } : {}),
      };
      const cms: CmsDraft = {
        title: d.title, slug: topic.slug, status: 'draft', origin: 'ai-assisted', excerpt: d.excerpt, content: html,
        categories: topic.categories, contentType: 'guide', evergreen: topic.volatility === 'stable', targetQuery: topic.intent,
        metaTitle: d.metaTitle, metaDescription: d.metaDescription, canonicalUrl: `/guias/${topic.slug}`,
        authorName: AI_AUTHOR.name, authorId: AI_AUTHOR.id,
      };
      return { provenance, cms };
    };
    const repairMetadata = async (d: Draft, problems: string[]): Promise<Draft> => ({
      ...d,
      ...await ask<{ excerpt: string; metaTitle: string; metaDescription: string }>('seo',
        'Eres el agente SEO. Reescribes el resumen y los metadatos de un artículo. Solo puedes usar cifras, fechas y números que aparezcan escritos igual en el texto del artículo; si dudas, quita la cifra. Sin añadir datos, sin palabras clave repetidas.',
        `Problemas: ${problems.join('; ')}\nLímites: metaTitle 15-60 caracteres, metaDescription 70-160.\nTexto del artículo:\n${clip(stripClaimMarkers(d.markdown), 8000)}\n\nResumen: ${d.excerpt}\nmetaTitle: ${d.metaTitle}\nmetaDescription: ${d.metaDescription}`,
        META_REPAIR_SCHEMA),
    });
    for (let loop = 0; loop <= limits.maxReviewLoops; loop++) {
      ledger.count('draftAttempts');
      let draft = await ask<Draft>('editorial', writerSystem,
        `Tema: ${topic.topic}\nIntención: ${topic.intent}\n\nSolo puedes usar estas afirmaciones verificadas (no hace falta usarlas todas: elige las que responden a la intención):\n${claimDigest(usable)}\n\n${writerRules()}${feedback ? `\n\nBorrador anterior:\n${previous}\n\nCorrige estos problemas de la revisión anterior con el menor cambio posible y conserva el resto tal cual. Un dato que no esté entre las afirmaciones verificadas se elimina o se sustituye por uno verificado:\n${feedback}` : ''}`,
        DRAFT_SCHEMA);

      const metaIssues = metadataProblems(draft, topic.slug, taken);
      if (metaIssues.length) {
        const fixed = await ask<{ title: string; metaTitle: string; metaDescription: string }>('seo',
          'Eres el agente SEO. Ajustas metadatos a los límites sin añadir datos nuevos, sin palabras clave repetidas y sin titulares sensacionalistas.',
          `Problemas: ${metaIssues.join('; ')}\nTítulo: ${draft.title}\nmetaTitle: ${draft.metaTitle}\nmetaDescription: ${draft.metaDescription}\nResumen del artículo: ${draft.excerpt}`,
          META_SCHEMA);
        draft = { ...draft, ...fixed, markdown: draft.markdown.replace(/^# .*$/m, `# ${fixed.title}`) };
      }

      // M11-E2b: the deterministic gates run BEFORE the critic. Mechanical defects are fixed with the smallest edit
      // (metadata by the SEO agent, text by the writer), so the critic reviews a clean draft and its round is not wasted.
      let gateFixes = 0;
      let repaired: RevisionRecord['repaired'];
      for (let fix = 0; fix < MAX_GATE_FIXES; fix++) {
        const { provenance: unreviewed, cms: candidate } = assemble(draft, now());
        const gate = (await publisherFindings(candidate, unreviewed, deps, taken, now(), topic.linkTargets)).filter((f) => f.severity === 'block' && !/^critic-/.test(f.code));
        if (!gate.length || !gate.every((f) => WRITER_FIXABLE.has(f.code))) break;
        gateFixes++;
        if (gate.every((f) => f.code === 'metadata-figure-not-in-claims' && !/^title:/.test(f.message))) {
          draft = await repairMetadata(draft, gate.map((f) => f.message));
          repaired = 'metadata';
          continue;
        }
        ledger.count('draftAttempts');
        const edited = await ask<Draft>('editorial', writerSystem,
          `Tema: ${topic.topic}\n\nAfirmaciones verificadas:\n${claimDigest(usable)}\n\n${writerRules()}\n\nBorrador:\n${draft.markdown}\n\nResumen: ${draft.excerpt}\nmetaTitle: ${draft.metaTitle}\nmetaDescription: ${draft.metaDescription}\n\nEl control automático ha encontrado estos defectos. Corrige solo esas frases o campos, con el menor cambio posible, y devuelve todo lo demás exactamente igual:\n${gate.map((f) => `- ${f.code}: ${f.message}`).join('\n')}`,
          DRAFT_SCHEMA);
        if (hashText(edited.markdown) === hashText(draft.markdown) && edited.excerpt === draft.excerpt && edited.metaTitle === draft.metaTitle && edited.metaDescription === draft.metaDescription) break;
        draft = edited;
      }

      const verifiedOn = now();
      const bundleHash = hashBundle(bundle);
      const draftHash = hashText(draft.markdown);

      const answer = await ask<{ verdict: CriticReview['verdict']; issues: CriticReview['issues'] }>('critic',
        `Eres el crítico independiente. No escribiste este texto. Lo contrastas solo con el paquete de evidencias.\n${EDITORIAL_RUBRIC}\n${CRITIC_SEVERITY}`,
        `Intención del lector: ${topic.intent}\n\nAfirmaciones verificadas:\n${claimDigest(usable)}\n\nAfirmaciones descartadas:\n${bundle.claims.filter((c) => c.status !== 'supported').map((c) => `- ${c.id} (${c.status}): ${c.text}`).join('\n') || '(ninguna)'}
${run.blockedCandidates?.length ? `\nUn candidato anterior de este artículo se bloqueó por falta de evidencias. Comprueba que este borrador resuelve esos problemas; si no, vuelve a bloquearlo:\n${run.blockedCandidates.flatMap((b) => b.critic.issues).map((i) => `- (${i.severity}) ${i.message}`).join('\n')}\n` : ''}
Resumen: ${draft.excerpt}\nmetaTitle: ${draft.metaTitle}\nmetaDescription: ${draft.metaDescription}\n(El resumen y los metadatos se publican con el texto: revísalos con el mismo criterio.)\n\nBorrador:\n${draft.markdown}`,
        CRITIC_SCHEMA);
      const critic: CriticReview = { model: chosen.critic.route.model, verdict: criticVerdict(answer), modelVerdict: answer.verdict, issues: answer.issues, bundleHash, draftHash, reviewedAt: now().toISOString() };
      const verdict = critic;

      const { provenance, cms } = assemble(draft, verifiedOn, critic);
      if (deps.signingKey) provenance.signature = signProvenance(provenance, deps.signingKey);
      // The excerpt and metadata are reviewed and signed with the text (metadataHash), so nothing rewrites them after this.
      let findings = await publisherFindings(cms, provenance, deps, taken, verifiedOn, topic.linkTargets);
      Object.assign(run, { draft: cms, provenance, findings, value: measureValue(draft.markdown, bundle) });
      const blocking = findings.filter((f) => f.severity === 'block');
      const revision: RevisionRecord = { attempt: loop, draftHash, verdict: verdict.verdict, issues: verdict.issues.length, blocking: blocking.map((f) => f.code), action: 'pass', gateFixes, ...(repaired ? { repaired } : {}) };
      run.revisions.push(revision);

      // Discarded claims the critic points at, by claimId or named in its message ("c1, c2 están descartadas").
      const discarded = bundle.claims.filter((c) => c.status !== 'supported');
      const isEvidenceIssue = (i: CriticReview['issues'][number]) => Boolean(i.claimId && !usable.some((c) => c.id === i.claimId))
        || discarded.some((c) => new RegExp(`(?<![\\w-])${c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(i.message));
      const evidenceIssues = verdict.issues.filter(isEvidenceIssue);
      // A critic 'block' is final for this candidate: its draft and signed provenance are kept as they are. Only a block whose
      // every serious issue is missing evidence (review M-A), with research left, starts a NEW candidate from new evidence;
      // the next critic is told about the block and the block stays in the signed provenance.
      if (verdict.verdict === 'block') {
        revision.action = 'block';
        const serious = verdict.issues.filter((i) => i.severity !== 'low');
        const recoverable = serious.length > 0 && serious.every(isEvidenceIssue);
        if (!recoverable || loop >= limits.maxReviewLoops || researchCalls >= limits.maxResearchCalls) return finish(run, 'blocked', 'el crítico bloqueó el borrador');
        run.blockedCandidates = [...(run.blockedCandidates ?? []), { draftHash, bundleHash, critic, signature: provenance.signature }];
        revision.action = 'new-candidate';
        await reResearch(evidenceIssues.map((i) => `- ${i.claimId ? `${i.claimId}: ` : ''}${i.message}`).join('\n'));
        previous = '';
        feedback = '';
        continue;
      }
      if (verdict.verdict === 'pass' && !blocking.length) {
        // Only a text that passed gets a cover, so a rejected draft never spends on images.
        if (await addCover(run, cms, provenance, topic, deps, ledger, verifiedOn)) {
          if (deps.signingKey) provenance.signature = signProvenance(provenance, deps.signingKey);
          findings = run.findings = await publisherFindings(cms, provenance, deps, taken, verifiedOn, topic.linkTargets);
        }
        const pending = policyGateFailures(findings);
        return finish(run, pending.length ? 'verified' : 'approved-by-policy', pending.length ? `requiere confirmación: ${pending.map((f) => f.code).join(', ')}` : undefined);
      }
      ledger.count('reviewFailures');
      // The writer returned the same text again: retrying the same prompt would not change the outcome.
      if (draftHash === hashText(previous)) { revision.action = 'abandon'; return finish(run, 'blocked', 'sin progreso: el borrador revisado es idéntico al anterior'); }
      previous = draft.markdown;
      feedback = [...verdict.issues.map((i) => `- (${i.severity}) ${i.claimId ? `${i.claimId}: ` : ''}${i.message}`), ...blocking.map((f) => `- (gate) ${f.code}: ${f.message}`)].join('\n');
      // Missing evidence is fixed by research, not by rewording: the writer can only use verified claims.
      const gaps = [
        ...blocking.filter((f) => EVIDENCE_GAPS.has(f.code)).map((f) => `- ${f.code}: ${f.message}`),
        ...evidenceIssues.map((i) => `- ${i.claimId ? `${i.claimId}: ` : ''}${i.message}`),
      ];
      if (loop < limits.maxReviewLoops && gaps.length && researchCalls < limits.maxResearchCalls) {
        revision.action = 're-research';
        await reResearch(gaps.join('\n'));
      } else revision.action = 'rewrite';
    }
    return finish(run, 'blocked', `agotados los ciclos de revisión (${limits.maxReviewLoops})`);
  } catch (error) {
    if (error instanceof EditorialBudgetExceeded) return finish(run, 'blocked', `límite: ${error.message}`);
    // A refusal, truncation or network error holds this article; the batch and its ledger survive.
    return finish(run, 'blocked', `error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Cover image for a passed text. Any failure (no priced route, budget, outage, a bad file) leaves the article
 * without a cover and records why; it never blocks or changes the text. Returns whether a cover was added.
 */
async function addCover(run: EditorialRun, cms: CmsDraft, provenance: EditorialProvenance, topic: EditorialTopic, deps: EditorialDeps, ledger: CostLedger, now: Date): Promise<boolean> {
  const route = (deps.imageRoutes ?? DEFAULT_IMAGE_ROUTES).find((r) => deps.images?.some((m) => m.provider === r.provider));
  if (!route) return false;
  try {
    const request = coverRequest({ title: cms.title, categories: topic.categories }, route.model);
    const price = ledger.imagePrice(route.model); // refuses unpriced or over-budget before the provider is called
    const result = await deps.images!.find((m) => m.provider === route.provider)!.generate(request);
    ledger.chargeImage(route.model);
    const problems = imageProblems(result, request);
    if (result.provider !== route.provider) problems.push(`respondió ${result.provider}, se pidió ${route.provider}`);
    if (problems.length) throw new Error(problems.join('; '));
    const asset = coverAsset(result, request, cms.title, price, now.toISOString());
    provenance.images = [asset];
    cms.coverImage = asset.url;
    cms.coverAlt = asset.altText;
    run.media = [{ asset, bytes: result.bytes }];
    return true;
  } catch (error) {
    run.imageFailure = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function finish(run: EditorialRun, state: EditorialPipelineState, reason?: string): EditorialRun {
  run.state = state;
  if (reason) run.reason = reason;
  if (run.provenance) run.provenance.state = state;
  return run;
}

function partial(bundle: EvidenceBundle): EditorialProvenance {
  return { pipelineVersion: PIPELINE_VERSION, state: 'blocked', bundle, bundleHash: hashBundle(bundle), draftMarkdown: '', draftHash: hashText('') };
}

/** Publisher: the evidence gate, the existing CMS quality gate, metadata and every internal link. */
async function publisherFindings(cms: CmsDraft, provenance: EditorialProvenance, deps: EditorialDeps, taken: Set<string>, now: Date, linkTargets?: EditorialTopic['linkTargets']): Promise<EditorialFinding[]> {
  const post = {
    ...cms, categories: cms.categories.map((name) => ({ name, slug: name })),
    author: { name: cms.authorName, id: cms.authorId }, seo: { metaTitle: cms.metaTitle, metaDescription: cms.metaDescription },
    featuredImage: cms.coverImage ? { sourceUrl: cms.coverImage, alt: cms.coverAlt } : undefined,
  };
  const findings = [
    ...evaluateEvidence(post, provenance, now),
    ...evaluateEditorialQuality(post, { others: deps.corpus }),
    ...metadataProblems(cms, cms.slug, taken).map((message) => ({ severity: 'block' as const, code: 'invalid-metadata', message })),
  ];
  const internal = [...new Set([...cms.content.matchAll(/href="(\/(?!\/)[^"#]*)/g)].map((m) => m[1]))];
  for (const path of internal) {
    const status = await deps.internalLinkStatus(path).catch(() => 0);
    if (status !== 200) findings.push({ severity: 'block', code: 'internal-link-status', message: `${path} responde ${status}` });
  }
  if (linkTargets) {
    const allowed = new Set([...linkTargets.map((t) => t.path), POLICY_PAGE]);
    for (const path of internal.filter((p) => !allowed.has(p))) {
      findings.push({ severity: 'block', code: 'unverified-internal-link', message: `${path} no está entre las páginas de GuíaTV verificadas para este tema` });
    }
    const linked = internal.filter((p) => p !== POLICY_PAGE).length;
    if (linked > MAX_INTERNAL_LINKS) findings.push({ severity: 'block', code: 'excessive-internal-links', message: `${linked} enlaces internos; máximo ${MAX_INTERNAL_LINKS}` });
  }
  return findings;
}

/** M11-D: durable spend. `reserve` runs before a job may spend, `settle` once it ended; both must persist synchronously. */
export interface SpendJournal {
  reserve(slug: string, allowanceUsd: number): void;
  /** `usd` is what the day must count: the real cost, or the whole allowance when the spend is unresolved. */
  settle(run: EditorialRun, usd: number): void;
}

/** Reached a publishable state: by policy, or held only for a named reviewer's judgement. */
const PUBLISHABLE: ReadonlySet<EditorialPipelineState> = new Set(['approved-by-policy', 'verified']);

/**
 * Daily volume, spend and concurrency caps around runEditorialJob. `doneToday` = jobs already started today (attempts)
 * and `spentToday` = USD already spent or reserved today (the CLI reads both from its journal), so a rerun cannot exceed them.
 * M11-E2: `maxDailyArticles` caps publishable results and `maxDailyAttempts` caps jobs, so a held article does not use up
 * the publishing quota; with infinite USD caps (EDITORIAL_BUDGET=unlimited) nothing is reserved, every spend is still settled.
 */
export async function runEditorialBatch(topics: EditorialTopic[], deps: EditorialDeps, limits: EditorialLimits = DEFAULT_EDITORIAL_LIMITS, doneToday = 0, spentToday = 0, journal?: SpendJournal): Promise<EditorialRun[]> {
  const held = (t: EditorialTopic, reason: string): EditorialRun => ({ slug: t.slug, state: 'blocked', reason, findings: [], cost: new CostLedger(limits).summary });
  const attempts = limits.maxDailyAttempts ?? limits.maxDailyArticles;
  const allowed = topics.slice(0, Math.max(0, attempts - doneToday));
  const skipped = topics.slice(allowed.length).map((t) => held(t, `límite diario de ${attempts} intentos`));
  const results: EditorialRun[] = new Array(allowed.length);
  let next = 0;
  let publishable = 0;
  const capped = Number.isFinite(limits.maxDailyUsd);
  // Each job reserves its whole allowance up front, so concurrent jobs cannot together pass the daily ceiling.
  let committed = spentToday;
  const running = new Set<Promise<void>>();
  const worker = async () => {
    while (next < allowed.length) {
      const i = next++;
      // A running job may still pass: count it before starting another, so concurrency cannot exceed the quota.
      // Running jobs also give back what they did not spend. One loop for both: no await between the check and the start.
      while (running.size && (publishable + running.size >= limits.maxDailyArticles || (capped && limits.maxDailyUsd - committed < limits.maxArticleUsd))) {
        await Promise.race(running);
      }
      if (publishable >= limits.maxDailyArticles) { results[i] = held(allowed[i], `límite diario de ${limits.maxDailyArticles} artículos`); continue; }
      const allowance = capped ? Math.min(limits.maxArticleUsd, limits.maxDailyUsd - committed) : limits.maxArticleUsd;
      if (allowance <= 0) { results[i] = held(allowed[i], `límite diario de ${limits.maxDailyUsd} USD`); continue; }
      const reserved = Number.isFinite(allowance) ? allowance : 0;
      committed += reserved;
      journal?.reserve(allowed[i].slug, reserved);
      const job: Promise<void> = runEditorialJob(allowed[i], deps, { ...limits, maxArticleUsd: allowance }).then((run) => {
        results[i] = run;
        if (PUBLISHABLE.has(run.state)) publishable++;
        // Unresolved spend counts the whole allowance when there is one; without a cap only what is known can be counted.
        const usd = run.cost.unresolved ? Math.max(reserved, run.cost.usd) : run.cost.usd;
        journal?.settle(run, usd);
        committed += usd - reserved;
        running.delete(job);
      });
      running.add(job);
      await job;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.maxConcurrentJobs, allowed.length)) }, worker));
  return [...results, ...skipped];
}
