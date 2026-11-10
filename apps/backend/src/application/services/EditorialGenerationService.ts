import { randomUUID } from 'node:crypto';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { DEFAULT_ROUTES, EditorialRole, ModelRoute, RouteTable } from './EditorialAgentPipeline';
import { MODEL_PRICES, OFFICIAL_DOMAINS } from './EditorialEvidence';
import { TOPIC_CATEGORIES } from './EditorialTopicQueue';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';

export const EDITORIAL_CONTENT_TYPES = ['guide', 'ranking', 'analysis'] as const;
export const EDITORIAL_LENGTHS = {
  short: { min: 600, max: 900 },
  medium: { min: 900, max: 1400 },
  long: { min: 1400, max: 2000 },
} as const;
export type EditorialContentType = typeof EDITORIAL_CONTENT_TYPES[number];
export type EditorialLength = keyof typeof EDITORIAL_LENGTHS;

export interface EditorialGenerationSettings {
  enabled: boolean;
  scheduleHours: number;
  topicsPerCycle: number;
  categories: string[];
  contentTypes: EditorialContentType[];
  defaultLength: EditorialLength;
  sourceDomains: string[];
  routes: RouteTable;
  updatedAt?: string;
  updatedBy?: string;
}

export interface EditorialGenerationTopic {
  title: string;
  slug: string;
  topic: string;
  intent: string;
  category: string;
  volatility: 'stable' | 'pricing' | 'availability' | 'sports-rights' | 'catalog-ranking';
  contentType: EditorialContentType;
  length: EditorialLength;
  seedUrls: string[];
  internalSources: Array<{ id: string; url: string }>;
}

type GenerationRequest = {
  _id?: string;
  id: string;
  kind: 'generate' | 'discover' | 'queue-action';
  /** kind 'queue-action': a human decision on one topic of the runner's queue, applied by the runner. */
  queueAction?: { action: 'approve' | 'reject' | 'prioritize' | 'edit'; topicId: string; reason?: string; edit?: { title?: string; intent?: string; seedUrls?: string[] } };
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  topic?: EditorialGenerationTopic;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  claimsObserved?: number;
  claimedAt?: Date;
  finishedAt?: Date;
  claimToken?: string;
};

const db = () => BlogPostModel.db;
const settings = () => db().collection<{ _id: string; settings?: EditorialGenerationSettings }>('editorial_settings');
const requests = () => db().collection<GenerationRequest>('editorial_generation_requests');
const cycles = () => db().collection('editorial_cycles');
// `current`: the runner's heartbeat; `scheduler`: the OS scheduler's ticks (M15).
const runner = () => db().collection<{ _id: string; lastSeenAt?: Date; version?: string; status?: string; lastError?: string; capabilities?: unknown; lastTickAt?: Date; lastAutomaticStartAt?: Date; lastOutcome?: string }>('editorial_runner');
const queue = () => db().collection<{ _id: string; items?: any[]; updatedAt?: Date }>('editorial_queue_snapshot');

export const DEFAULT_GENERATION_SETTINGS: EditorialGenerationSettings = {
  // M14-R fail-closed: un despliegue sin ajustes persistidos no puede publicar por omisión. El operador
  // activa la generación explícitamente desde el Admin; la publicación sigue sujeta a la parada de emergencia.
  enabled: false,
  scheduleHours: 3,
  topicsPerCycle: 1,
  categories: [...TOPIC_CATEGORIES],
  contentTypes: ['guide'],
  defaultLength: 'medium',
  sourceDomains: [...OFFICIAL_DOMAINS],
  routes: DEFAULT_ROUTES as RouteTable,
};

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fail = (message: string): never => { throw new ValidationError(message, []); };
const enumValue = <T extends string | number>(value: unknown, allowed: readonly T[], fallback?: T): T => {
  const candidate = value ?? fallback;
  if (!candidate || !allowed.includes(candidate as T)) return fail(`Invalid value; expected ${allowed.join(', ')}`);
  return candidate as T;
};
const integer = (value: unknown, min: number, max: number, fallback: number) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fail(`Expected an integer from ${min} to ${max}`);
  return n;
};
const stringList = (value: unknown, allowed: readonly string[], fallback: string[]) => {
  const list = value === undefined ? fallback : value;
  if (!Array.isArray(list) || !list.length || list.length > allowed.length || list.some((x) => typeof x !== 'string' || !allowed.includes(x))) return fail('Invalid selection');
  return [...new Set(list)] as string[];
};

function validRoutes(value: unknown): RouteTable {
  if (!value || typeof value !== 'object') return fail('Routes are required');
  const input = value as Record<string, unknown>;
  const roles: EditorialRole[] = ['research', 'evidence', 'editorial', 'seo', 'critic'];
  const result = {} as Record<EditorialRole, ModelRoute[]>;
  for (const role of roles) {
    const list = input[role];
    if (!Array.isArray(list) || !list.length || list.length > 3) return fail(`${role}: one to three routes are required`);
    result[role] = list.map((route) => {
      if (!route || typeof route !== 'object') return fail(`${role}: invalid route`);
      const r = route as Record<string, unknown>;
      const provider = enumValue(r.provider, ['anthropic', 'openai', 'deepseek'] as const);
      const model = text(r.model, 80);
      if (!model || !MODEL_PRICES[model]) return fail(`${role}: unknown or unpriced model`);
      if (provider === 'anthropic' && !model.startsWith('claude-') || provider === 'openai' && !model.startsWith('gpt-') || provider === 'deepseek' && !model.startsWith('deepseek-')) return fail(`${role}: model does not belong to ${provider}`);
      return { provider, model, effort: enumValue(r.effort, ['low', 'medium', 'high'] as const) };
    });
  }
  return result as RouteTable;
}

function validTopic(value: unknown): EditorialGenerationTopic {
  if (!value || typeof value !== 'object') return fail('A topic is required');
  const input = value as Record<string, unknown>;
  const slug = text(input.slug, 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(slug)) return fail('Slug must contain at least three lowercase words separated by hyphens');
  const title = text(input.title, 110);
  const topic = text(input.topic, 500);
  const intent = text(input.intent, 500);
  if (title.length < 20 || topic.length < 20 || intent.length < 20) return fail('Title, topic and intent must contain at least 20 characters');
  const seedUrls = Array.isArray(input.seedUrls) ? [...new Set(input.seedUrls.map((x) => text(x, 2000)))] : [];
  if (!seedUrls.length || seedUrls.length > 4) return fail('One to four source URLs are required');
  for (const source of seedUrls) {
    let url: URL;
    try { url = new URL(source); } catch { return fail('Invalid source URL'); }
    if (url.protocol !== 'https:') return fail('Source URLs must use HTTPS');
  }
  const internalSources = Array.isArray(input.internalSources) ? input.internalSources.slice(0, 4).map((source, index) => {
    const url = text((source as any)?.url, 300);
    if (!/^\/(?!\/)[\w\-/?=&.]*$/.test(url)) return fail('Internal sources must be local paths');
    return { id: text((source as any)?.id, 40) || `internal-${index + 1}`, url };
  }) : [];
  return {
    title, slug, topic, intent, seedUrls, internalSources,
    category: enumValue(input.category, TOPIC_CATEGORIES),
    volatility: enumValue(input.volatility, ['stable', 'pricing', 'availability', 'sports-rights', 'catalog-ranking'] as const, 'stable'),
    contentType: enumValue(input.contentType, EDITORIAL_CONTENT_TYPES, 'guide'),
    length: enumValue(input.length, Object.keys(EDITORIAL_LENGTHS) as EditorialLength[], 'medium'),
  };
}

/** Same horizon as the runner lock (`lockAlive` in editorial-agents.mjs): past it the owner is treated as dead. */
export const CLAIM_LEASE_MS = 6 * 3600e3;

export type RunnerStartMode = 'automatic' | 'manual';

/**
 * M14-R: puerta fail-closed del arranque del runner. Un arranque automático (programado) exige el
 * interruptor persistido `enabled`; un arranque manual es una acción explícita de un operador y siempre
 * se permite — se audita aparte y no modifica `enabled` ni la política de publicación.
 */
export function runnerStartAllowed(
  settings: { enabled: boolean; scheduleHours?: number },
  mode: RunnerStartMode,
  lastAutomaticStartAt: Date | null = null,
  now = new Date(),
): { allowed: boolean; reason: string | null } {
  if (mode === 'manual') return { allowed: true, reason: null };
  if (settings.enabled !== true) return { allowed: false, reason: 'generation-disabled' };
  // M15: the OS scheduler only ticks (every 15 min); `scheduleHours` from the Admin decides when a cycle is due,
  // so the frequency shown in the panel is the one that runs. A 10 min margin absorbs tick jitter.
  const due = !lastAutomaticStartAt || now.getTime() - lastAutomaticStartAt.getTime() >= (settings.scheduleHours ?? 3) * 3600e3 - SCHEDULER_TICK_MS * 2 / 3;
  return due ? { allowed: true, reason: null } : { allowed: false, reason: 'not-due' };
}

/** The OS scheduler's tick (infra/cron/guiatv-editorial-cycle.sh). The panel calls it stopped after two missed ticks. */
export const SCHEDULER_TICK_MS = 15 * 60e3;

export class EditorialGenerationService {
  async getSettings(): Promise<EditorialGenerationSettings> {
    const doc = await settings().findOne({ _id: 'generation' });
    return { ...DEFAULT_GENERATION_SETTINGS, ...(doc?.settings ?? {}) };
  }

  async updateSettings(input: unknown, actor: string) {
    if (!input || typeof input !== 'object') return fail('Settings are required');
    const value = input as Record<string, unknown>;
    const current = await this.getSettings();
    const next: EditorialGenerationSettings = {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : current.enabled,
      scheduleHours: enumValue(value.scheduleHours, [3, 6, 12, 24] as const, current.scheduleHours as 3),
      topicsPerCycle: integer(value.topicsPerCycle, 1, 10, current.topicsPerCycle),
      categories: stringList(value.categories, TOPIC_CATEGORIES, current.categories),
      contentTypes: stringList(value.contentTypes, EDITORIAL_CONTENT_TYPES, current.contentTypes) as EditorialContentType[],
      defaultLength: enumValue(value.defaultLength, Object.keys(EDITORIAL_LENGTHS) as EditorialLength[], current.defaultLength),
      sourceDomains: stringList(value.sourceDomains, OFFICIAL_DOMAINS, current.sourceDomains),
      routes: value.routes === undefined ? current.routes : validRoutes(value.routes),
      updatedAt: new Date().toISOString(), updatedBy: actor,
    };
    await settings().updateOne({ _id: 'generation' }, { $set: { settings: next } }, { upsert: true });
    return next;
  }

  async createRequest(kind: 'generate' | 'discover', input: unknown, actor: string) {
    const topic = kind === 'generate' ? validTopic(input) : undefined;
    if (topic) {
      const config = await this.getSettings();
      if (!config.categories.includes(topic.category) || !config.contentTypes.includes(topic.contentType)) fail('The selected category or content type is disabled');
      const domains = new Set(config.sourceDomains);
      if (topic.seedUrls.some((url) => !domains.has(new URL(url).hostname.replace(/^www\./, '')))) fail('Every source domain must be enabled in generation settings');
    }
    const now = new Date();
    const request: GenerationRequest = { id: randomUUID(), kind, status: 'queued', topic, createdAt: now, updatedAt: now, createdBy: actor, claimsObserved: 0 };
    await requests().insertOne(request);
    return this.publicRequest(request);
  }

  async createQueueAction(input: any, actor: string) {
    const action = enumValue(input?.action, ['approve', 'reject', 'prioritize', 'edit'] as const);
    const topicId = text(input?.topicId, 80);
    if (!topicId) fail('topicId is required');
    const edit = action === 'edit' ? {
      ...(typeof input?.edit?.title === 'string' ? { title: text(input.edit.title, 110) } : {}),
      ...(typeof input?.edit?.intent === 'string' ? { intent: text(input.edit.intent, 500) } : {}),
      ...(Array.isArray(input?.edit?.seedUrls) ? { seedUrls: input.edit.seedUrls.slice(0, 6).map((u: unknown) => text(u, 2000)).filter(Boolean) } : {}),
    } : undefined;
    if (action === 'edit' && !Object.keys(edit ?? {}).length) fail('Nothing to edit');
    // One pending decision per topic: a second click must not stack contradictory actions.
    if (await requests().findOne({ kind: 'queue-action', status: 'queued', 'queueAction.topicId': topicId })) throw new ConflictError('Ya hay una acción pendiente para este tema');
    const now = new Date();
    const request: GenerationRequest = { id: randomUUID(), kind: 'queue-action', status: 'queued', queueAction: { action, topicId, reason: text(input?.reason, 300), ...(edit ? { edit } : {}) }, createdAt: now, updatedAt: now, createdBy: actor, claimsObserved: 0 };
    await requests().insertOne(request);
    return this.publicRequest(request);
  }

  async cancelRequest(id: string) {
    const now = new Date();
    const result = await requests().findOneAndUpdate({ id, status: 'queued' }, { $set: { status: 'cancelled', updatedAt: now, finishedAt: now } }, { returnDocument: 'after' });
    if (!result) throw new ConflictError('Only queued requests can be cancelled');
    return this.publicRequest(result);
  }

  async retryRequest(id: string) {
    const result = await requests().findOneAndUpdate({ id, status: { $in: ['failed', 'cancelled'] } }, { $set: { status: 'queued', reason: '', updatedAt: new Date() }, $unset: { claimedAt: '', finishedAt: '', claimToken: '' } }, { returnDocument: 'after' });
    if (!result) throw new NotFoundError('No failed or cancelled generation request found');
    return this.publicRequest(result);
  }

  /**
   * M15: a claim older than any real run belongs to a dead runner (crash, kill, reboot): nothing else would ever
   * finish it. Its token is revoked, so a returning zombie cannot finish it. One automatic retry; a request that is
   * abandoned twice goes to `failed` with the reason, for a person to retry, so a crash loop cannot spend every cycle.
   */
  async recoverAbandonedClaims(now = new Date()) {
    const before = new Date(now.getTime() - CLAIM_LEASE_MS);
    const stale = { status: 'running' as const, $or: [{ claimedAt: { $lt: before } }, { claimedAt: { $exists: false }, updatedAt: { $lt: before } }] };
    const requeued = await requests().updateMany({ ...stale, claimsObserved: { $not: { $gte: 2 } } }, {
      $set: { status: 'queued', reason: 'Ejecución interrumpida: el ejecutor no la terminó; se reintenta una vez', updatedAt: now },
      $unset: { claimToken: '', claimedAt: '' },
    });
    const failed = await requests().updateMany(stale, {
      $set: { status: 'failed', reason: 'Ejecución interrumpida dos veces: revisa el registro del ejecutor y reinténtala', updatedAt: now, finishedAt: now },
      $unset: { claimToken: '' },
    });
    return { requeued: requeued.modifiedCount, failed: failed.modifiedCount };
  }

  async pendingRequests() {
    await this.recoverAbandonedClaims();
    const actions = await requests().find({ status: 'queued', kind: 'queue-action' }).sort({ createdAt: 1, _id: 1 }).limit(20).toArray();
    const [discovery, generation] = await Promise.all(['discover', 'generate'].map((kind) =>
      requests().find({ status: 'queued', kind: kind as GenerationRequest['kind'] }).sort({ createdAt: 1, _id: 1 }).limit(20).toArray()));
    const items: GenerationRequest[] = [...actions];
    for (let i = 0; items.length < 20 && (i < discovery.length || i < generation.length); i++) {
      if (discovery[i]) items.push(discovery[i]);
      if (items.length < 20 && generation[i]) items.push(generation[i]);
    }
    return items.map((item) => this.publicRequest(item));
  }

  async claimRequest(id: string, owned = false) {
    const now = new Date();
    const claimToken = owned ? randomUUID() : undefined;
    const result = await requests().findOneAndUpdate({ id, status: 'queued' }, { $set: { status: 'running', updatedAt: now, claimedAt: now, ...(claimToken ? { claimToken } : {}) }, $inc: { claimsObserved: 1 } }, { returnDocument: 'after' });
    if (!result) throw new ConflictError('Request is no longer queued');
    return { ...this.publicRequest(result), ...(claimToken ? { claimToken } : {}) };
  }

  async finishRequest(id: string, status: 'completed' | 'failed', reason = '', claimToken?: string) {
    const now = new Date();
    const owner = claimToken ? claimToken : { $exists: false };
    const result = await requests().findOneAndUpdate({ id, status: 'running', claimToken: owner }, { $set: { status, reason: text(reason, 1000), updatedAt: now, finishedAt: now }, $unset: { claimToken: '' } }, { returnDocument: 'after' });
    if (!result) throw new NotFoundError('Running generation request not found');
    return this.publicRequest(result);
  }

  async reportRunner(input: any) {
    const now = new Date();
    const capabilities = {
      providers: Array.isArray(input?.providers) ? input.providers.filter((x: unknown) => x === 'anthropic' || x === 'openai' || x === 'deepseek') : [],
      webSearch: input?.webSearch === true,
    };
    await runner().updateOne({ _id: 'current' }, { $set: { lastSeenAt: now, version: text(input?.version, 40), status: text(input?.status, 30) || 'ready', lastError: text(input?.error, 1000), capabilities } }, { upsert: true });
    return { receivedAt: now };
  }

  /** M15: every automatic start request is a scheduler tick; the panel shows whether the OS scheduler is alive. */
  async schedulerTick(now = new Date()) {
    const doc = await runner().findOneAndUpdate({ _id: 'scheduler' }, { $set: { lastTickAt: now } }, { upsert: true, returnDocument: 'before' });
    return { lastAutomaticStartAt: doc?.lastAutomaticStartAt ?? null, lastOutcome: doc?.lastOutcome ?? null };
  }

  async recordTickOutcome(outcome: string) {
    await runner().updateOne({ _id: 'scheduler' }, { $set: { lastOutcome: outcome } }, { upsert: true });
  }

  async recordAutomaticStart(now = new Date()) {
    await runner().updateOne({ _id: 'scheduler' }, { $set: { lastAutomaticStartAt: now } }, { upsert: true });
  }

  async reportCycle(input: any) {
    const at = new Date();
    const result = enumValue(input?.result, ['inactive', 'generation-paused', 'daily-limit', 'no-eligible-topics', 'discovery-error', 'ran', 'failed'] as const);
    const row = { at, result, reason: text(input?.reason, 1000), queued: integer(input?.queued, 0, 10000, 0), generated: integer(input?.generated, 0, 100, 0) };
    await cycles().insertOne(row);
    if (Array.isArray(input?.queue)) {
      const items = input.queue.slice(0, 100).map((item: any) => ({
        id: text(item.id, 80), title: text(item.title, 110), category: text(item.category, 40),
        state: text(item.state, 30), pinned: item.pinned === true, intent: text(item.intent, 500), explanation: Array.isArray(item.scoreExplanation) ? item.scoreExplanation.slice(0, 14).map((x: unknown) => text(x, 300)) : [], score: Number(item.score) || 0, attempts: Number(item.attempts) || 0,
        reason: text(item.reason, 1000), sources: Array.isArray(item.sourceCandidates) ? item.sourceCandidates.slice(0, 4).map((x: unknown) => text(x, 2000)) : [],
        updatedAt: text(item.updatedAt, 40),
      })).filter((item: any) => item.id && item.title);
      await queue().replaceOne({ _id: 'current' }, { items, updatedAt: at }, { upsert: true });
    }
    return row;
  }

  async operationalState() {
    await this.recoverAbandonedClaims();
    const [generation, runnerDoc, schedulerDoc, lastCycle, queueDoc, manual, manualPending, manualRunning, pendingActions] = await Promise.all([
      this.getSettings(), runner().findOne({ _id: 'current' }), runner().findOne({ _id: 'scheduler' }),
      cycles().findOne({}, { sort: { at: -1 } }),
      queue().findOne({ _id: 'current' }), requests().find({ kind: { $ne: 'queue-action' }, status: { $in: ['queued', 'running', 'failed', 'cancelled'] } }).sort({ createdAt: -1 }).limit(50).toArray(),
      requests().countDocuments({ kind: { $ne: 'queue-action' }, status: 'queued' }), requests().countDocuments({ kind: { $ne: 'queue-action' }, status: 'running' }),
      requests().find({ kind: 'queue-action', status: 'queued' }).sort({ createdAt: 1 }).limit(50).toArray(),
    ]);
    const lastSeenAt = runnerDoc?.lastSeenAt ?? null;
    const staleMs = Math.max(15 * 60e3, generation.scheduleHours * 3600e3 + 15 * 60e3);
    const online = Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() <= staleMs);
    const lastTickAt = schedulerDoc?.lastTickAt ?? null;
    const lastAutomaticStartAt = schedulerDoc?.lastAutomaticStartAt ?? null;
    const schedulerActive = Boolean(lastTickAt && Date.now() - new Date(lastTickAt).getTime() <= 2 * SCHEDULER_TICK_MS + 60e3);
    // Only a ticking scheduler with generation enabled has a next run; the first tick after it is due starts it.
    const nextRunAt = generation.enabled && schedulerActive
      ? new Date(Math.max(
        lastAutomaticStartAt ? new Date(lastAutomaticStartAt).getTime() + generation.scheduleHours * 3600e3 - SCHEDULER_TICK_MS * 2 / 3 : 0,
        new Date(lastTickAt!).getTime() + SCHEDULER_TICK_MS)).toISOString()
      : null;
    return {
      generation,
      scheduler: { active: schedulerActive, lastTickAt, lastAutomaticStartAt, tickMinutes: SCHEDULER_TICK_MS / 60e3 },
      runner: {
        online, lastSeenAt, version: runnerDoc?.version ?? null,
        status: !lastSeenAt ? 'never-connected' : online ? (runnerDoc?.status || 'ready') : 'offline',
        lastError: runnerDoc?.lastError || null,
        capabilities: runnerDoc?.capabilities ?? { providers: [], webSearch: false },
      },
      lastCycle: lastCycle ? { at: lastCycle.at, result: lastCycle.result, reason: lastCycle.reason, queued: lastCycle.queued, generated: lastCycle.generated } : null,
      nextRunAt,
      queue: [...manual.map((item) => ({ ...this.publicRequest(item), source: 'manual' })), ...(queueDoc?.items ?? []).map((item: any) => ({ ...item, source: 'discovered' }))].slice(0, 100),
      pendingActions: pendingActions.map((r) => ({ id: r.id, ...r.queueAction })),
      queueSummary: {
        manualPending,
        discovered: queueDoc?.items?.filter((item: any) => item.state === 'queued').length ?? 0,
        running: manualRunning + (queueDoc?.items?.filter((item: any) => item.state === 'running').length ?? 0),
      },
    };
  }

  private publicRequest(item: GenerationRequest) {
    return { id: item.id, kind: item.kind, status: item.status, topic: item.topic, queueAction: item.queueAction, reason: item.reason ?? null, createdAt: item.createdAt, updatedAt: item.updatedAt, createdBy: item.createdBy, claimsObserved: item.claimsObserved ?? null, claimedAt: item.claimedAt ?? null, finishedAt: item.finishedAt ?? null };
  }
}
