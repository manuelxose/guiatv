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

export const PIPELINE_VERSION = 'm11b-1';
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
    ledger.assertHeadroom(model, adapter.maxOutputTokens ?? 0);
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

    // 1. Research: sources, verbatim quotes, candidate claims.
    let research: { researchQuestions: string[]; sources: Array<{ id: string; url: string; publisher: string }>; claims: EvidenceClaim[] } | undefined;
    for (let attempt = 0; attempt < limits.maxResearchCalls && !research?.claims?.length; attempt++) {
      research = await ask('research',
        `${STYLE}\nEres el agente de investigación. Buscas fuentes primarias (webs oficiales de operadores, plataformas, competiciones, organismos) y, solo si no existen, prensa de referencia. No uses agregadores de dudosa procedencia ni copies artículos.`,
        `Tema: ${topic.topic}\nIntención del lector: ${topic.intent}\nVolatilidad: ${topic.volatility}\n${topic.notes ? `Notas: ${topic.notes}\n` : ''}${topic.seedUrls?.length ? `Revisa primero: ${topic.seedUrls.join(', ')}\n` : ''}
Datos propios de GuíaTV (fuentes internas con su id; cítalos con ese id):\n${internalText || '(ninguno)'}

Devuelve preguntas de investigación, fuentes (id corto, URL exacta que hayas consultado, editor) y afirmaciones atómicas.
Cada afirmación lleva 1-3 citas literales, copiadas carácter a carácter de la fuente (12-200 caracteres, sin parafrasear) que la prueban, incluidas todas sus cifras.
Si un dato no aparece literal en una fuente consultada, no lo incluyas. Ids de afirmación: c1, c2…`,
        RESEARCH_SCHEMA, 5);
    }
    if (!research?.claims?.length) return { ...run, state: 'blocked', reason: 'la investigación no devolvió afirmaciones' };

    const internalIds = new Set(topic.internalSources.map((s) => s.id));
    const sources = [
      ...topic.internalSources.map((s) => ({ id: s.id, url: s.url, publisher: 'GuíaTV' })),
      ...research.sources.filter((s) => /^https?:\/\//.test(s.url) && !internalIds.has(s.id)),
    ];
    for (const s of sources) await fetchOnce(s.id, s.url);
    let bundle: EvidenceBundle = {
      topic: topic.topic, intent: topic.intent, researchQuestions: research.researchQuestions, createdAt: now().toISOString(), conflicts: [],
      sources: sources.map((s) => ({ ...s, kind: sourceKindFor(s.url), ...retrieval.get(s.id) })),
      claims: research.claims.map((c) => ({ id: c.id, text: c.text, volatility: c.volatility, quotes: c.quotes })),
    };
    run.state = 'researched';

    // 2. Evidence: deterministic quote verification, then a conflict review that can only demote.
    bundle = verifyBundle(bundle, snapshots);
    const supported = bundle.claims.filter((c) => c.status === 'supported');
    if (supported.length >= 2) {
      const review = await ask<{ conflicts: Array<{ claimIds: string[]; note: string }> }>('evidence',
        'Eres el agente de evidencias. Comparas afirmaciones verificadas y señalas solo contradicciones reales entre ellas o con la fecha actual (un dato caducado). No añades información.',
        `Fecha: ${now().toISOString().slice(0, 10)}\nAfirmaciones verificadas con sus citas:\n${claimDigest(supported)}\n\nDevuelve los grupos de ids que se contradicen, con una nota breve. Lista vacía si no hay.`,
        CONFLICT_SCHEMA);
      const known = new Set(supported.map((c) => c.id));
      bundle = verifyBundle({ ...bundle, conflicts: review.conflicts.filter((c) => c.claimIds.some((id) => known.has(id))) }, snapshots);
    }
    const usable = bundle.claims.filter((c) => c.status === 'supported');
    if (usable.length < 3) return { ...run, state: 'blocked', reason: `solo ${usable.length} afirmaciones verificadas`, provenance: partial(bundle) };

    // 3-5. Editorial ⇄ critic, with deterministic SEO checks in between.
    const taken = new Set(deps.corpus.map((p) => p.slug));
    const sourceList = bundle.sources.filter((s) => s.retrievedAt).map((s) => `- ${s.id}: ${s.url} (${s.publisher})`).join('\n');
    let feedback = '';
    let previous = '';
    for (let loop = 0; loop <= limits.maxReviewLoops; loop++) {
      ledger.count('draftAttempts');
      let draft = await ask<{ title: string; excerpt: string; metaTitle: string; metaDescription: string; markdown: string }>('editorial',
        `${STYLE}\nEres el agente editorial. Redactas una guía útil y diferente: explica criterios, compara, y aprovecha los datos propios de GuíaTV cuando los haya.`,
        `Tema: ${topic.topic}\nIntención: ${topic.intent}\n\nSolo puedes usar estas afirmaciones verificadas:\n${claimDigest(usable)}\n\nFuentes que puedes enlazar:\n${sourceList}
\nReglas: markdown con un único "# título"; cada frase, fila de tabla o elemento de lista que dé una cifra, fecha, hora, precio, canal o disponibilidad termina con su marcador [[cN]] (o [[c1,c2]]) antes del punto.
Nada factual sin marcador. Enlaza las fuentes con su URL exacta. Enlaces internos solo a rutas de guiaprogramaciontv.com que aparezcan en los datos propios. Sin sección de preguntas frecuentes.
Extensión: la que pida el tema, sin inflarla.${feedback ? `\n\nBorrador anterior:\n${previous}\n\nCorrige estos problemas de la revisión anterior y conserva el resto:\n${feedback}` : ''}`,
        DRAFT_SCHEMA);

      const metaIssues = metadataProblems(draft, topic.slug, taken);
      if (metaIssues.length) {
        const fixed = await ask<{ title: string; metaTitle: string; metaDescription: string }>('seo',
          'Eres el agente SEO. Ajustas metadatos a los límites sin añadir datos nuevos, sin palabras clave repetidas y sin titulares sensacionalistas.',
          `Problemas: ${metaIssues.join('; ')}\nTítulo: ${draft.title}\nmetaTitle: ${draft.metaTitle}\nmetaDescription: ${draft.metaDescription}\nResumen del artículo: ${draft.excerpt}`,
          META_SCHEMA);
        draft = { ...draft, ...fixed, markdown: draft.markdown.replace(/^# .*$/m, `# ${fixed.title}`) };
      }

      const verifiedOn = now();
      const html = `<div class="editorial-body">${deps.render(stripClaimMarkers(draft.markdown).replace(/^# .*\n?/m, ''))}${aiDisclosure(verifiedOn)}</div>`;
      const bundleHash = hashBundle(bundle);
      const draftHash = hashText(draft.markdown);

      const verdict = await ask<{ verdict: CriticReview['verdict']; issues: CriticReview['issues'] }>('critic',
        'Eres el crítico independiente. No escribiste este texto. Lo contrastas solo con el paquete de evidencias: cualquier dato no respaldado, matiz perdido, conclusión exagerada, recomendación sin criterio explicado, relleno, tono de IA genérico o aporte nulo frente a una ficha de catálogo es un problema. Pass solo si publicarías el texto tal cual.',
        `Afirmaciones verificadas:\n${claimDigest(usable)}\n\nAfirmaciones descartadas:\n${bundle.claims.filter((c) => c.status !== 'supported').map((c) => `- ${c.id} (${c.status}): ${c.text}`).join('\n') || '(ninguna)'}\n\nBorrador:\n${draft.markdown}`,
        CRITIC_SCHEMA);
      const critic: CriticReview = { model: chosen.critic.route.model, verdict: verdict.verdict, issues: verdict.issues, bundleHash, draftHash, reviewedAt: now().toISOString() };

      const provenance: EditorialProvenance = {
        pipelineVersion: PIPELINE_VERSION, state: 'draft', bundle, bundleHash, draftMarkdown: draft.markdown, draftHash, critic, cost: ledger.summary,
        lastVerifiedAt: verifiedOn.toISOString(), nextReviewAt: nextReviewAt(bundle, draft.markdown)?.toISOString(), version: 1,
        backend,
      };
      if (deps.signingKey) provenance.signature = signProvenance(provenance, deps.signingKey);
      const cms: CmsDraft = {
        title: draft.title, slug: topic.slug, status: 'draft', origin: 'ai-assisted', excerpt: draft.excerpt, content: html,
        categories: topic.categories, contentType: 'guide', evergreen: topic.volatility === 'stable', targetQuery: topic.intent,
        metaTitle: draft.metaTitle, metaDescription: draft.metaDescription, canonicalUrl: `/guias/${topic.slug}`,
        authorName: AI_AUTHOR.name, authorId: AI_AUTHOR.id,
      };
      let findings = await publisherFindings(cms, provenance, deps, taken, verifiedOn);
      Object.assign(run, { draft: cms, provenance, findings, value: measureValue(draft.markdown, bundle) });

      if (verdict.verdict === 'block') return finish(run, 'blocked', 'el crítico bloqueó el borrador');
      const blocking = findings.filter((f) => f.severity === 'block');
      if (verdict.verdict === 'pass' && !blocking.length) {
        // Only a text that passed gets a cover, so a rejected draft never spends on images.
        if (await addCover(run, cms, provenance, topic, deps, ledger, verifiedOn)) {
          if (deps.signingKey) provenance.signature = signProvenance(provenance, deps.signingKey);
          findings = run.findings = await publisherFindings(cms, provenance, deps, taken, verifiedOn);
        }
        const pending = policyGateFailures(findings);
        return finish(run, pending.length ? 'verified' : 'approved-by-policy', pending.length ? `requiere confirmación: ${pending.map((f) => f.code).join(', ')}` : undefined);
      }
      ledger.count('reviewFailures');
      previous = draft.markdown;
      feedback = [...verdict.issues.map((i) => `- (${i.severity}) ${i.claimId ? `${i.claimId}: ` : ''}${i.message}`), ...blocking.map((f) => `- (gate) ${f.code}: ${f.message}`)].join('\n');
    }
    return finish(run, 'blocked', 'agotados los ciclos de revisión');
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
async function publisherFindings(cms: CmsDraft, provenance: EditorialProvenance, deps: EditorialDeps, taken: Set<string>, now: Date): Promise<EditorialFinding[]> {
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
  return findings;
}

/** M11-D: durable spend. `reserve` runs before a job may spend, `settle` once it ended; both must persist synchronously. */
export interface SpendJournal {
  reserve(slug: string, allowanceUsd: number): void;
  /** `usd` is what the day must count: the real cost, or the whole allowance when the spend is unresolved. */
  settle(run: EditorialRun, usd: number): void;
}

/**
 * Daily volume, spend and concurrency caps around runEditorialJob. `doneToday` = runs already started today
 * and `spentToday` = USD already spent or reserved today (the CLI reads both from its logs), so a rerun cannot exceed them.
 */
export async function runEditorialBatch(topics: EditorialTopic[], deps: EditorialDeps, limits: EditorialLimits = DEFAULT_EDITORIAL_LIMITS, doneToday = 0, spentToday = 0, journal?: SpendJournal): Promise<EditorialRun[]> {
  const held = (t: EditorialTopic, reason: string): EditorialRun => ({ slug: t.slug, state: 'blocked', reason, findings: [], cost: new CostLedger(limits).summary });
  const allowed = topics.slice(0, Math.max(0, limits.maxDailyArticles - doneToday));
  const skipped = topics.slice(allowed.length).map((t) => held(t, `límite diario de ${limits.maxDailyArticles} artículos`));
  const results: EditorialRun[] = new Array(allowed.length);
  let next = 0;
  // Each job reserves its whole allowance up front, so concurrent jobs cannot together pass the daily ceiling.
  let committed = spentToday;
  const running = new Set<Promise<void>>();
  const worker = async () => {
    while (next < allowed.length) {
      const i = next++;
      // Running jobs give back what they did not spend: wait for them before holding or under-funding a topic.
      while (limits.maxDailyUsd - committed < limits.maxArticleUsd && running.size) await Promise.race(running);
      const allowance = Math.min(limits.maxArticleUsd, limits.maxDailyUsd - committed);
      if (allowance <= 0) { results[i] = held(allowed[i], `límite diario de ${limits.maxDailyUsd} USD`); continue; }
      committed += allowance;
      journal?.reserve(allowed[i].slug, allowance);
      const job: Promise<void> = runEditorialJob(allowed[i], deps, { ...limits, maxArticleUsd: allowance }).then((run) => {
        results[i] = run;
        const usd = run.cost.unresolved ? Math.max(allowance, run.cost.usd) : run.cost.usd;
        journal?.settle(run, usd);
        committed += usd - allowance;
        running.delete(job);
      });
      running.add(job);
      await job;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.maxConcurrentJobs, allowed.length)) }, worker));
  return [...results, ...skipped];
}
