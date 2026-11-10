import { Request, Response } from 'express';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { successResponse } from '../../shared/types/ApiResponse';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { AuthenticatedRequest } from '../middlewares/authGuard';
import {
  DEFAULT_EDITORIAL_LIMITS,
  EditorialProvenance,
  evaluateEvidence,
  provenanceSignatureValid,
} from '../../application/services/EditorialEvidence';
import { evaluateEditorialQuality, policyGateFailures, PUBLIC_EDITORIAL_FILTER } from '../../application/services/EditorialReviewPolicy';
import { LIVE_PROVIDERS, routesFromEnv } from '../../application/services/EditorialAgentPipeline';
import type { IStorageRepository } from '../../domain/repositories/IStorageRepository';
import { EditorialMediaRejected, storeEditorialCover } from '../../infrastructure/storage/EditorialMediaStore';
import { generatedImageFindings } from '../../application/services/EditorialImages';
import { editorialCoverPreview } from '../middlewares/editorialMediaGate';
import { runSearchConsoleMonitor, searchConsoleOverview } from '../../application/services/SearchConsoleMonitor';
import { submitSitemapToSearchConsole } from '../../application/services/submitSitemapToSearchConsole';
import { EditorialGenerationService, runnerStartAllowed, RunnerStartMode } from '../../application/services/EditorialGenerationService';
import { EditorialRunnerService } from '../../application/services/EditorialRunnerService';
import { EditorialProvidersService } from '../../application/services/EditorialProvidersService';
import {
  EditorialJobLedger,
  ERROR_CLASSES,
  ErrorClass,
  JOB_KINDS,
  JOB_STATES,
  JobKind,
  JobState,
  LedgerQuery,
  STAGE_NAMES,
  StageName,
} from '../../application/services/EditorialJobLedger';

/**
 * M11-C Admin supervision of the AI editorial pipeline (/v2/admin/editorial, admin role enforced by the router).
 * Read-only views plus the emergency stop. Nothing here approves or publishes: that stays on the review-key
 * endpoints of BlogController, which re-run every gate.
 */

const db = () => BlogPostModel.db;
const settings = () => db().collection<{ _id: string; paused?: boolean; pausedAt?: Date; pausedBy?: string; pausedReason?: string; dailyLimit?: number; dailyLimitBy?: string; dailyLimitAt?: Date; activatedAt?: Date; activatedBy?: string }>('editorial_settings');
const audit = () => db().collection('editorial_audit');
const jobs = () => db().collection('editorial_jobs');
const DAY = 864e5;
/** One Search Console run at a time: a second click reports the live run instead of stacking API calls. */
let searchConsoleRun: Promise<unknown> | null = null;

/**
 * M11-D: AI articles per day (pipeline runs and policy publications). Recommended 3: a steady cadence of
 * well-sourced guides; Google's scaled-content policy targets volume without value, not a number, so the cap is
 * a quality brake rather than an SEO target. Changeable at any time from the Admin, within 1..10.
 */
export const DAILY_LIMIT = Object.freeze({ recommended: 3, min: 1, max: 10 });
const validDailyLimit = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= DAILY_LIMIT.min && (n as number) <= DAILY_LIMIT.max;

/**
 * Automatic publication needs the deploy-time switch on, the one-time Admin activation (human key, M11-E2) and no
 * emergency stop. The switch alone only makes the mode available: a deploy never starts publishing by itself.
 */
export async function editorialPolicyState() {
  const doc = await settings().findOne({ _id: 'policy' });
  const envEnabled = process.env.EDITORIAL_POLICY_PUBLISHING === 'enabled';
  const paused = Boolean(doc?.paused);
  const activated = Boolean(doc?.activatedAt);
  // The Admin setting wins; then the deploy-time env (legacy); then the recommendation.
  const envLimit = Number(process.env.EDITORIAL_POLICY_DAILY_LIMIT);
  const dailyLimit = validDailyLimit(doc?.dailyLimit) ? doc!.dailyLimit : validDailyLimit(envLimit) ? envLimit : DAILY_LIMIT.recommended;
  return {
    envEnabled, paused, activated, active: envEnabled && activated && !paused,
    activatedAt: doc?.activatedAt?.toISOString() ?? null, activatedBy: doc?.activatedBy ?? null,
    pausedAt: doc?.paused ? doc.pausedAt?.toISOString() ?? null : null,
    pausedBy: doc?.paused ? doc.pausedBy ?? null : null,
    pausedReason: doc?.paused ? doc.pausedReason ?? null : null,
    dailyLimit, dailyLimitBy: doc?.dailyLimitBy ?? null, dailyLimitRange: DAILY_LIMIT,
  };
}

const actor = (req: Request) => {
  const user = (req as AuthenticatedRequest).user;
  return user ? user.email || user.id : 'admin-key';
};
const usdOf = (p?: EditorialProvenance) => p?.cost?.usd ?? 0;

const MAX_BULK = 50;
const asJobState = (value: unknown): JobState | undefined => JOB_STATES.includes(value as JobState) ? value as JobState : undefined;
const asStage = (value: unknown): StageName => {
  if (!STAGE_NAMES.includes(value as StageName)) throw new ValidationError('Invalid stage', [{ field: 'stage', message: STAGE_NAMES.join(', '), value }]);
  return value as StageName;
};
const asErrorClass = (value: unknown): ErrorClass => ERROR_CLASSES.includes(value as ErrorClass) ? value as ErrorClass : 'unknown';
const asError = (value: unknown): { classification: ErrorClass; message: string } | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as { classification?: unknown; message?: unknown };
  return { classification: asErrorClass(row.classification), message: String(row.message ?? '').slice(0, 500) };
};
const asUsage = (value: unknown) => {
  const row = (value ?? {}) as Record<string, unknown>;
  const number = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
  return { modelCalls: number(row.modelCalls), inputTokens: number(row.inputTokens), outputTokens: number(row.outputTokens), usd: number(row.usd) };
};
const leaseCredentials = (req: Request) => ({
  token: String(req.body?.token ?? ''),
  generation: Number(req.body?.generation),
});
const requireLease = (req: Request) => {
  const { token, generation } = leaseCredentials(req);
  if (!/^[0-9a-f-]{36}$/i.test(token) || !Number.isInteger(generation) || generation < 1) {
    throw new ValidationError('A live lease token and generation are required', [{ field: 'token', message: 'claim the job first', value: token ? 'present' : 'missing' }]);
  }
  return { token, generation };
};
/** The cron calls the runner start endpoint with no signal; a human operator declares the action explicitly. */
const runnerStartMode = (req: Request): RunnerStartMode => (req.body?.mode === 'manual' ? 'manual' : 'automatic');

export class EditorialOpsController {
  private readonly generation = new EditorialGenerationService();
  private readonly runnerProcess = new EditorialRunnerService();
  private readonly providers = new EditorialProvidersService();
  private readonly ledger = new EditorialJobLedger();

  constructor(private readonly storage: IStorageRepository, private readonly submitSitemap = submitSitemapToSearchConsole) {}

  /** Cover upload from the runner (raw image body); re-validated here because this is the trust boundary. */
  uploadCover = async (req: Request, res: Response): Promise<void> => {
    const sha = String(req.params.sha256 || '');
    if (!/^[0-9a-f]{64}$/.test(sha) || !Buffer.isBuffer(req.body)) {
      throw new ValidationError('Invalid cover upload', [{ field: 'body', message: 'Raw PNG, JPEG or WebP body to /media/<sha256>', value: sha }]);
    }
    try {
      const stored = await storeEditorialCover(this.storage, req.body, sha);
      await audit().insertOne({ at: new Date(), action: 'cover-upload', by: actor(req), sha256: sha });
      res.status(201).json(successResponse(stored));
    } catch (error) {
      if (error instanceof EditorialMediaRejected) throw new ValidationError('Cover rejected', [{ field: 'body', message: error.message, value: sha }]);
      throw error;
    }
  };

  overview = async (_req: Request, res: Response): Promise<void> => {
    const since = (ms: number) => new Date(Date.now() - ms);
    const today = new Date().toISOString().slice(0, 10);
    const [policy, approvalsLast24h, recentJobs, todayJobs, posts, spend, searchConsole, operations] = await Promise.all([
      editorialPolicyState(),
      db().collection('editorial_policy_approvals').countDocuments({ at: { $gte: since(DAY) } }),
      jobs().find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(50).toArray(),
      // startedAt is the runner's ISO string, so a string range is the UTC day.
      jobs().find({ startedAt: { $gte: today } }, { projection: { _id: 0, state: 1, revisions: 1, costUsd: 1, costEntries: 1, blockingCodes: 1 } }).toArray(),
      BlogPostModel.find({ origin: 'ai-assisted', editorial: { $exists: true } })
        .select({ title: 1, slug: 1, status: 1, reviewState: 1, reviewedBy: 1, updatedAt: 1, featuredImage: 1, editorial: 1, __v: 1 })
        .sort({ updatedAt: -1 }).limit(50).lean().exec(),
      jobs().aggregate<{ _id: string; usd: number }>([
        // startedAt is stored as the runner's ISO string, so the day is its first 10 characters.
        { $match: { startedAt: { $gte: since(30 * DAY).toISOString() } } },
        { $group: { _id: { $substr: ['$startedAt', 0, 10] }, usd: { $sum: '$costUsd' } } },
      ]).toArray(),
      // Monitoring only: a GSC read failure must not take the runner's overview (its cap and stop source) down.
      searchConsoleOverview().catch(() => null),
      this.generation.operationalState(),
    ]);
    // The runner uses the Admin's persisted route table, not the deploy-time defaults; show what actually runs.
    const routes = operations.generation.routes;
    const { imageRoutes } = routesFromEnv();
    // The runner owns the money caps; its latest report says which budget it ran under (M11-E2 testing: unlimited).
    const unlimited = recentJobs[0]?.budget === 'unlimited';
    const count = (state: string) => todayJobs.filter((j) => j.state === state).length;
    // Null-prototype maps: a stored model name such as "__proto__" must not reach Object.prototype.
    const models: Record<string, { calls: number; inputTokens: number; outputTokens: number; usd: number }> = Object.create(null);
    const reasons: Record<string, number> = Object.create(null);
    for (const job of todayJobs) {
      for (const e of job.costEntries ?? []) {
        const m = (models[e.model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
        m.calls++; m.inputTokens += e.inputTokens; m.outputTokens += e.outputTokens; m.usd = +(m.usd + e.usd).toFixed(4);
      }
      for (const code of job.blockingCodes ?? []) reasons[code] = (reasons[code] ?? 0) + 1;
    }
    res.json(successResponse({
      policy: {
        ...policy, approvalsLast24h,
        signingKeyConfigured: Boolean(process.env.EDITORIAL_PIPELINE_SIGNING_KEY),
        liveProviders: [...LIVE_PROVIDERS],
      },
      limits: {
        budget: unlimited ? 'unlimited' : 'capped',
        maxArticleUsd: unlimited ? null : Number(process.env.EDITORIAL_MAX_ARTICLE_USD ?? DEFAULT_EDITORIAL_LIMITS.maxArticleUsd),
        maxDailyUsd: unlimited ? null : Number(process.env.EDITORIAL_MAX_DAILY_USD ?? DEFAULT_EDITORIAL_LIMITS.maxDailyUsd),
        maxDailyArticles: policy.dailyLimit,
      },
      // Attempts and publications are separate counts: a held or rejected attempt uses no publishing slot.
      today: {
        generated: todayJobs.length, published: count('published'), ready: count('approved-by-policy'),
        held: count('verified'), rejected: count('blocked'),
        revisions: todayJobs.reduce((sum, j) => sum + (Number(j.revisions) || 0), 0), models, reasons,
      },
      ...operations,
      runner: { ...operations.runner, process: this.runnerProcess.state() },
      routes, imageRoutes,
      spend: {
        todayUsd: +(spend.find((d) => d._id === today)?.usd ?? 0).toFixed(4),
        last30dUsd: +spend.reduce((sum, d) => sum + d.usd, 0).toFixed(4),
      },
      jobs: recentJobs,
      searchConsole,
      posts: posts.map((post) => {
        const p = post.editorial as EditorialProvenance;
        const count = (status: string) => p.bundle.claims.filter((c) => (c.status ?? 'unverified') === status).length;
        return {
          id: String(post._id), version: post.__v ?? null, slug: post.slug, title: post.title, status: post.status, reviewState: post.reviewState ?? 'unreviewed',
          reviewedBy: post.reviewedBy ?? null, updatedAt: post.updatedAt, pipelineState: p.state, backend: p.backend ?? null,
          signed: Boolean(p.signature), costUsd: usdOf(p),
          claims: { supported: count('supported'), conflicting: count('conflicting'), unverified: count('unverified') },
          sources: p.bundle.sources.length, criticVerdict: p.critic?.verdict ?? null,
          coverUrl: post.featuredImage?.sourceUrl ?? null, nextReviewAt: p.nextReviewAt ?? null,
        };
      }),
    }));
  };

  post = async (req: Request, res: Response): Promise<void> => {
    const post = await BlogPostModel.findById(String(req.params.id)).lean().exec().catch(() => null);
    if (!post?.editorial) throw new NotFoundError('AI editorial post not found');
    const p = post.editorial as EditorialProvenance;
    const [publicPosts, unpublished] = await Promise.all([
      BlogPostModel.find({ ...PUBLIC_EDITORIAL_FILTER, _id: { $ne: post._id } }).select({ slug: 1, content: 1 }).lean().exec(),
      BlogPostModel.find({ _id: { $ne: post._id }, $nor: [PUBLIC_EDITORIAL_FILTER] }).select({ slug: 1 }).lean().exec(),
    ]);
    // The same gates BlogController runs at approval, so what the Admin shows is what approval will decide.
    const findings = [
      ...evaluateEvidence(post, p),
      ...generatedImageFindings(post),
      ...evaluateEditorialQuality(post, {
        others: publicPosts.map((o) => ({ slug: String(o.slug), content: o.content })),
        unpublishedSlugs: unpublished.map((o) => String(o.slug)),
      }),
    ];
    res.json(successResponse({
      post: {
        id: String(post._id), slug: post.slug, title: post.title, status: post.status, reviewState: post.reviewState ?? 'unreviewed',
        reviewedBy: post.reviewedBy ?? null, reviewNotes: post.reviewNotes ?? null, excerpt: post.excerpt ?? '', content: post.content ?? '',
        metaTitle: post.seo?.metaTitle ?? '', metaDescription: post.seo?.metaDescription ?? '',
        coverUrl: post.featuredImage?.sourceUrl ?? null, coverAlt: post.featuredImage?.alt ?? null, author: post.author ?? null,
        // A draft's cover is not public (editorialMediaGate), so the Admin gets the image itself.
        coverPreview: await editorialCoverPreview(post.featuredImage?.sourceUrl),
      },
      version: post.__v ?? null,
      pendingEdit: post.pendingEdit ?? null,
      provenance: {
        pipelineVersion: p.pipelineVersion, state: p.state, backend: p.backend ?? null,
        signed: provenanceSignatureValid(p, process.env.EDITORIAL_PIPELINE_SIGNING_KEY),
        bundle: p.bundle, critic: p.critic ?? null, cost: p.cost ?? null, images: p.images ?? [],
        lastVerifiedAt: p.lastVerifiedAt ?? null, nextReviewAt: p.nextReviewAt ?? null,
      },
      findings,
      policyBlockers: policyGateFailures(findings),
      revisions: (post.revisions ?? []).map((r) => ({ version: r.version, savedAt: r.savedAt, reason: r.reason, status: r.snapshot?.status })),
      // The most recent stored version, for a diff against what is shown now.
      previous: (() => {
        const last = (post.revisions ?? []).at(-1);
        return last ? { version: last.version, savedAt: last.savedAt, reason: last.reason, title: last.snapshot?.title ?? '', content: last.snapshot?.content ?? '' } : null;
      })(),
    }));
  };

  updatePost = async (req: Request, res: Response): Promise<void> => {
    const post = await BlogPostModel.findById(String(req.params.id)).exec().catch(() => null);
    if (!post?.editorial) throw new NotFoundError('AI editorial post not found');
    const body = req.body ?? {};
    if (!Object.prototype.hasOwnProperty.call(body, 'expectedVersion') || body.expectedVersion !== (post.__v ?? null) || body.expectedStatus !== post.status) {
      throw new ConflictError('El artículo cambió desde que se abrió; vuelve a cargarlo');
    }
    const updates: Record<string, unknown> = { reviewState: 'unreviewed' };
    for (const field of ['title', 'excerpt', 'content'] as const) {
      if (body[field] !== undefined) updates[field] = String(body[field]).trim().slice(0, field === 'content' ? 100_000 : 500);
    }
    if (body.metaTitle !== undefined) updates['seo.metaTitle'] = String(body.metaTitle).trim().slice(0, 120);
    if (body.metaDescription !== undefined) updates['seo.metaDescription'] = String(body.metaDescription).trim().slice(0, 220);
    if (updates.title !== undefined && String(updates.title).length < 20) throw new ValidationError('Title must contain at least 20 characters', []);
    const version = post.__v === undefined ? { $exists: false } : post.__v;
    if (post.status === 'publish') {
      const pendingEdit = {
        title: String(updates.title ?? post.pendingEdit?.title ?? post.title),
        excerpt: String(updates.excerpt ?? post.pendingEdit?.excerpt ?? post.excerpt ?? ''),
        content: String(updates.content ?? post.pendingEdit?.content ?? post.content ?? ''),
        metaTitle: String(updates['seo.metaTitle'] ?? post.pendingEdit?.metaTitle ?? post.seo?.metaTitle ?? ''),
        metaDescription: String(updates['seo.metaDescription'] ?? post.pendingEdit?.metaDescription ?? post.seo?.metaDescription ?? ''),
        savedAt: new Date(),
      };
      const result = await BlogPostModel.updateOne({ _id: post._id, status: 'publish', __v: version }, { $set: { pendingEdit }, $inc: { __v: 1 } }, { timestamps: false });
      if (!result.matchedCount) throw new ConflictError('The post changed while this request ran; read it again');
      await audit().insertOne({ at: new Date(), action: 'editorial-pending-edit', by: actor(req), postId: String(post._id), slug: post.slug });
      res.json(successResponse({ updated: true, id: String(post._id) }));
      return;
    }
    const result = await BlogPostModel.updateOne({ _id: post._id, status: 'draft', __v: version }, { $set: updates, $unset: { reviewedBy: 1, reviewNotes: 1 }, $inc: { __v: 1 } });
    if (!result.matchedCount) throw new ConflictError('The post changed while this request ran; read it again');
    await audit().insertOne({ at: new Date(), action: 'editorial-post-edit', by: actor(req), postId: String(post._id), slug: post.slug });
    res.json(successResponse({ updated: true, id: String(post._id) }));
  };

  /** A person declines an unfinished draft: it stays unpublished and the reason is kept. Nothing public changes. */
  rejectPost = async (req: Request, res: Response): Promise<void> => {
    const post = await BlogPostModel.findById(String(req.params.id)).exec().catch(() => null);
    if (!post?.editorial) throw new NotFoundError('AI editorial post not found');
    if (post.status !== 'draft') throw new ConflictError('Only unpublished drafts can be rejected');
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    const version = post.__v === undefined ? { $exists: false } : post.__v;
    const result = await BlogPostModel.updateOne({ _id: post._id, status: 'draft', __v: version }, { $set: { reviewState: 'rejected', reviewedBy: actor(req), reviewedAt: new Date(), reviewNotes: reason || 'Rechazado por un administrador' }, $inc: { __v: 1 } });
    if (!result.matchedCount) throw new ConflictError('The post changed while this request ran; read it again');
    await audit().insertOne({ at: new Date(), action: 'editorial-post-reject', by: actor(req), postId: String(post._id), slug: post.slug, reason });
    res.json(successResponse({ rejected: true, id: String(post._id) }));
  };

  deletePost = async (req: Request, res: Response): Promise<void> => {
    const post = await BlogPostModel.findById(String(req.params.id)).select({ slug: 1, status: 1, editorial: 1, pendingEdit: 1, __v: 1 }).lean().exec().catch(() => null);
    if (!post?.editorial) throw new NotFoundError('AI editorial post not found');
    if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, 'expectedVersion') || req.body.expectedVersion !== (post.__v ?? null) || req.body.expectedStatus !== post.status) {
      throw new ConflictError('El artículo cambió desde que se abrió; vuelve a cargarlo');
    }
    if (post.status === 'publish' && post.pendingEdit) {
      const version = post.__v === undefined ? { $exists: false } : post.__v;
      const result = await BlogPostModel.updateOne({ _id: post._id, status: 'publish', __v: version }, { $unset: { pendingEdit: 1 }, $inc: { __v: 1 } }, { timestamps: false });
      if (!result.matchedCount) throw new ConflictError('The post changed while this request ran; read it again');
      await audit().insertOne({ at: new Date(), action: 'editorial-pending-edit-delete', by: actor(req), postId: String(post._id), slug: post.slug });
      res.json(successResponse({ deleted: true, id: String(post._id), pendingEdit: true }));
      return;
    }
    if (post.status !== 'draft') throw new ConflictError('Only unpublished drafts can be deleted');
    const version = post.__v === undefined ? { $exists: false } : post.__v;
    const result = await BlogPostModel.deleteOne({ _id: post._id, status: 'draft', __v: version });
    if (!result.deletedCount) throw new ConflictError('The post changed while this request ran; read it again');
    await audit().insertOne({ at: new Date(), action: 'editorial-post-delete', by: actor(req), postId: String(post._id), slug: post.slug });
    res.json(successResponse({ deleted: true, id: String(post._id) }));
  };

  requeuePost = async (req: Request, res: Response): Promise<void> => {
    const post = await BlogPostModel.findById(String(req.params.id)).lean().exec().catch(() => null);
    if (!post?.editorial) throw new NotFoundError('AI editorial post not found');
    if (post.status !== 'draft') throw new ConflictError('Only unpublished drafts can be requeued');
    const p = post.editorial as EditorialProvenance;
    if (!['blocked', 'requires-update', 'verified'].includes(p.state)) throw new ConflictError('Only blocked or unfinished editorial drafts can be requeued');
    const words = String(post.content ?? '').split(/\s+/).filter(Boolean).length;
    const categoryName = (post.categories ?? []).map((category) => String((category as { name?: string }).name || '')).find((name) => ['Televisión', 'Cine', 'Series', 'Streaming', 'Fútbol', 'Deportes', 'Tecnología'].includes(name));
    // The request refuses seed URLs from domains not enabled in the settings; the old research may have used others.
    const enabled = new Set((await this.generation.getSettings()).sourceDomains);
    // A stored URL can be malformed (`https://exa mple`): it is dropped, not a 500 that leaves the draft stuck.
    const enabledSeed = (url: string) => { try { return /^https:\/\//.test(url) && enabled.has(new URL(url).hostname.replace(/^www\./, '')); } catch { return false; } };
    const request = await this.generation.createRequest('generate', {
      title: post.title, slug: post.slug,
      topic: p.bundle.topic, intent: p.bundle.intent,
      category: categoryName || 'Streaming',
      // A claim may be `tv-schedule`; a topic may not (the request rejects it), so take the first claim value a topic allows.
      volatility: (p.bundle.claims ?? []).map((claim) => claim.volatility).find((v) => ['stable', 'pricing', 'availability', 'sports-rights', 'catalog-ranking'].includes(v)) || 'stable',
      contentType: ['guide', 'ranking', 'analysis'].includes(String(post.contentType)) ? post.contentType : 'guide',
      length: words > 1400 ? 'long' : words > 900 ? 'medium' : 'short',
      seedUrls: (p.bundle.sources ?? []).map((source) => String(source.url ?? '')).filter(enabledSeed).slice(0, 4),
      internalSources: [],
    }, actor(req));
    try {
      await BlogPostModel.deleteOne({ _id: post._id, status: 'draft' });
    } catch (error) {
      await this.generation.cancelRequest(request.id).catch(() => undefined);
      throw error;
    }
    await audit().insertOne({ at: new Date(), action: 'editorial-post-requeue', by: actor(req), postId: String(post._id), slug: post.slug, requestId: request.id });
    res.status(201).json(successResponse(request));
  };

  /** Emergency stop: any admin may switch automatic publication off at once, without a deploy. */
  pause = async (req: Request, res: Response): Promise<void> => {
    const reason = String(req.body?.reason ?? '').trim().slice(0, 500);
    if (!reason) throw new ValidationError('A reason is required', [{ field: 'reason', message: 'Required', value: reason }]);
    const by = actor(req);
    await settings().updateOne({ _id: 'policy' }, { $set: { paused: true, pausedAt: new Date(), pausedBy: by, pausedReason: reason } }, { upsert: true });
    await audit().insertOne({ at: new Date(), action: 'policy-pause', by, reason });
    res.json(successResponse({ policy: await editorialPolicyState() }));
  };

  /**
   * Activation (first time) or lifting the stop: needs the editorial review key as well (router), and the env switch
   * still decides. This is an administrative switch for the mode, not an approval of any article.
   */
  resume = async (req: Request, res: Response): Promise<void> => {
    // The reviewer name is what the key holder declares; the authenticated actor is recorded next to it.
    const by = String(req.header('x-editorial-reviewer') || '').trim().slice(0, 120) || actor(req);
    await settings().updateOne({ _id: 'policy' }, { $set: { paused: false, activatedAt: new Date(), activatedBy: by }, $unset: { pausedAt: 1, pausedBy: 1, pausedReason: 1 } }, { upsert: true });
    await audit().insertOne({ at: new Date(), action: 'policy-resume', by, actor: actor(req) });
    res.json(successResponse({ policy: await editorialPolicyState() }));
  };

  /** Articles per day; needs the human review key (router), so the runner cannot raise its own cap. */
  setDailyLimit = async (req: Request, res: Response): Promise<void> => {
    const dailyLimit = Number(req.body?.dailyLimit);
    if (!validDailyLimit(dailyLimit)) {
      throw new ValidationError('Invalid daily limit', [{ field: 'dailyLimit', message: `An integer from ${DAILY_LIMIT.min} to ${DAILY_LIMIT.max}`, value: req.body?.dailyLimit }]);
    }
    const by = String(req.header('x-editorial-reviewer') || '').trim().slice(0, 120) || actor(req);
    const before = (await editorialPolicyState()).dailyLimit;
    await settings().updateOne({ _id: 'policy' }, { $set: { dailyLimit, dailyLimitBy: by, dailyLimitAt: new Date() } }, { upsert: true });
    await audit().insertOne({ at: new Date(), action: 'daily-limit', by, actor: actor(req), from: before, to: dailyLimit });
    res.json(successResponse({ policy: await editorialPolicyState() }));
  };

  /**
   * Run summaries from the pipeline runner (scripts/editorial-agents.mjs --api): every job, blocked ones too.
   * No draft text or evidence is accepted here. `jobId` is unique, so a replayed report is refused.
   */
  recordJob = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
    const amount = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
    const started = typeof b.startedAt === 'string' && b.startedAt.length <= 40 ? new Date(b.startedAt) : null;
    const job = {
      jobId: text(b.jobId, 160), slug: text(b.slug, 120), state: text(b.state, 40), reason: text(b.reason, 1000),
      // Stored normalised: the overview selects a day by comparing ISO strings.
      startedAt: started && !Number.isNaN(started.getTime()) ? started.toISOString() : null,
      backend: text(b.backend, 80), imageFailure: text(b.imageFailure, 500),
      costUsd: Number(b.costUsd),
      costEntries: (Array.isArray(b.costEntries) ? b.costEntries : []).filter((e: unknown) => e && typeof e === 'object').slice(0, 50).map((e: Record<string, unknown>) => ({
        role: text(e.role, 20), model: text(e.model, 80) === '__proto__' ? null : text(e.model, 80), inputTokens: amount(e.inputTokens),
        outputTokens: amount(e.outputTokens), searches: amount(e.searches), usd: amount(e.usd),
        ...(e.costBasis === 'estimated-list' ? { costBasis: 'estimated-list' } : {}),
        ...(e.modelIdentity === 'requested' || e.modelIdentity === 'reported' ? { modelIdentity: e.modelIdentity } : {}),
        ...(e.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: amount(e.cacheReadInputTokens) } : {}),
        ...(e.cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens: amount(e.cacheCreationInputTokens) } : {}),
      })),
      blockingCodes: (Array.isArray(b.blockingCodes) ? b.blockingCodes : []).slice(0, 50).map((c: unknown) => text(c, 60)),
      // M11-E2 audit: how many revisions, what each one did, the budget mode and the public URL (if published).
      revisions: Number.isInteger(b.revisions) && b.revisions >= 0 ? Math.min(b.revisions, 50) : 0,
      revisionLog: (Array.isArray(b.revisionLog) ? b.revisionLog : []).slice(0, 20).map((r: unknown) => text(r, 300)),
      budget: b.budget === 'unlimited' ? 'unlimited' : 'capped',
      publicUrl: typeof b.publicUrl === 'string' && /^https:\/\/(?:www\.)?guiaprogramaciontv\.com\/guias\/[a-z0-9-]+$|^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/guias\/[a-z0-9-]+$/.test(b.publicUrl) ? b.publicUrl : null,
    };
    if (!job.jobId || !job.slug || !job.state || !job.startedAt || !Number.isFinite(job.costUsd) || job.costUsd < 0) {
      throw new ValidationError('Invalid job report', [{ field: 'job', message: 'jobId, slug, state, startedAt (ISO) and costUsd >= 0 are required', value: job.jobId }]);
    }
    await jobs().createIndex({ jobId: 1 }, { unique: true });
    try {
      await jobs().insertOne({ ...job, receivedAt: new Date() });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictError(`Job ${job.jobId} already recorded`);
      throw error;
    }
    res.status(201).json(successResponse({ jobId: job.jobId }));
  };

  recordIndexingRequest = async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.body?.slug || '');
    const post = await BlogPostModel.findOne({ ...PUBLIC_EDITORIAL_FILTER, slug }).select({ _id: 1 }).lean().exec();
    if (!post) throw new NotFoundError('Public guide not found');
    const at = new Date();
    await audit().insertOne({ at, action: 'indexing-request-recorded', postId: String(post._id), slug, by: actor(req) });
    res.json(successResponse({ recordedAt: at }));
  };

  submitGuideSitemap = async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.body?.slug || '');
    const post = await BlogPostModel.findOne({ ...PUBLIC_EDITORIAL_FILTER, slug }).select({ _id: 1 }).lean().exec();
    if (!post) throw new NotFoundError('Public guide not found');
    const result = await this.submitSitemap({ enabled: true, sitemapUrl: 'https://guiaprogramaciontv.com/sitemap-blog.xml' });
    if (!result.submitted) throw new Error('No se pudo enviar el sitemap a Search Console');
    const at = new Date();
    await audit().insertOne({ at, action: 'guide-sitemap-submitted', postId: String(post._id), slug, by: actor(req) });
    res.json(successResponse({ submittedAt: at }));
  };

  /** Kick a read-only Search Console synchronization; the run itself is bounded and one at a time. */
  searchConsoleRun = async (req: Request, res: Response): Promise<void> => {
    if (searchConsoleRun) {
      res.status(202).json(successResponse({ running: true, started: false }));
      return;
    }
    searchConsoleRun = runSearchConsoleMonitor().catch(() => null).finally(() => { searchConsoleRun = null; });
    await audit().insertOne({ at: new Date(), action: 'search-console-run', by: actor(req) });
    res.status(202).json(successResponse({ running: true, started: true }));
  };

  providerHealth = async (req: Request, res: Response): Promise<void> => {
    // Automatic on page load; an explicit ?refresh=1 bypasses the 60 s cache after a credential change.
    res.json(successResponse(await this.providers.check(req.query.refresh === '1')));
  };

  generationSettings = async (_req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.getSettings()));
  };

  updateGenerationSettings = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.updateSettings(req.body, actor(req))));
  };

  createGenerationRequest = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(successResponse(await this.generation.createRequest('generate', req.body, actor(req))));
  };

  createDiscoveryRequest = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(successResponse(await this.generation.createRequest('discover', {}, actor(req))));
  };

  createQueueAction = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(successResponse(await this.generation.createQueueAction(req.body, actor(req))));
  };

  cancelGenerationRequest = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.cancelRequest(String(req.params.id))));
  };

  retryGenerationRequest = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.retryRequest(String(req.params.id))));
  };

  runnerProcessState = async (_req: Request, res: Response): Promise<void> => {
    res.json(successResponse(this.runnerProcess.state()));
  };

  startRunnerProcess = async (req: Request, res: Response): Promise<void> => {
    const mode = runnerStartMode(req);
    const settings = await this.generation.getSettings();
    // M15: an automatic start is the OS scheduler's tick; `scheduleHours` decides whether a cycle is due.
    const tick = mode === 'automatic' ? await this.generation.schedulerTick() : null;
    const gate = runnerStartAllowed(settings, mode, tick?.lastAutomaticStartAt ?? null);
    if (!gate.allowed) {
      // Ticks repeat every 15 min: a refusal is audited when it starts (paused since…), not on every repeat; `not-due`
      // is the normal wait between cycles.
      if (tick) await this.generation.recordTickOutcome(gate.reason ?? 'started');
      if (gate.reason !== 'not-due' && tick?.lastOutcome !== gate.reason) await audit().insertOne({ at: new Date(), action: 'runner-process-start-refused', by: actor(req), reason: gate.reason, mode });
      res.json(successResponse({ started: false, reason: gate.reason, mode, enabled: settings.enabled }));
      return;
    }
    const wasRunning = this.runnerProcess.state().running;
    const state = await this.runnerProcess.start();
    if (tick) await this.generation.recordTickOutcome('started');
    if (mode === 'automatic' && !wasRunning) await this.generation.recordAutomaticStart();
    await audit().insertOne({ at: new Date(), action: 'runner-process-start', by: actor(req), pid: state.pid, mode, alreadyRunning: wasRunning });
    res.json(successResponse({ ...state, started: true, alreadyRunning: wasRunning, mode }));
  };

  stopRunnerProcess = async (req: Request, res: Response): Promise<void> => {
    const before = this.runnerProcess.state();
    const state = await this.runnerProcess.stop();
    await audit().insertOne({ at: new Date(), action: 'runner-process-stop', by: actor(req), pid: before.pid });
    res.json(successResponse(state));
  };

  restartRunnerProcess = async (req: Request, res: Response): Promise<void> => {
    const mode = runnerStartMode(req);
    const settings = await this.generation.getSettings();
    const gate = runnerStartAllowed(settings, mode);
    if (!gate.allowed) {
      await audit().insertOne({ at: new Date(), action: 'runner-process-restart-refused', by: actor(req), reason: gate.reason, mode });
      res.json(successResponse({ started: false, reason: gate.reason, mode, enabled: settings.enabled }));
      return;
    }
    const state = await this.runnerProcess.restart();
    await audit().insertOne({ at: new Date(), action: 'runner-process-restart', by: actor(req), pid: state.pid, mode });
    res.json(successResponse({ ...state, started: true, mode }));
  };

  runnerProcessLogs = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(this.runnerProcess.logs(Number(req.query.lines || 120))));
  };

  runnerWork = async (_req: Request, res: Response): Promise<void> => {
    res.json(successResponse({ settings: await this.generation.getSettings(), requests: await this.generation.pendingRequests(), policy: await editorialPolicyState(), ownershipProtocols: ['v1'] }));
  };

  runnerHeartbeat = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.reportRunner(req.body)));
  };

  claimGenerationRequest = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.claimRequest(String(req.params.id))));
  };

  claimOwnedGenerationRequest = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.generation.claimRequest(String(req.params.id), true)));
  };

  finishGenerationRequest = async (req: Request, res: Response): Promise<void> => {
    const status = req.body?.status;
    if (status !== 'completed' && status !== 'failed') throw new ValidationError('Status must be completed or failed', []);
    const token = req.header('x-editorial-claim-token');
    if (token !== undefined && (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token))) throw new ValidationError('Invalid claim token', []);
    res.json(successResponse(await this.generation.finishRequest(String(req.params.id), status, req.body?.reason, token)));
  };

  runnerCycle = async (req: Request, res: Response): Promise<void> => {
    res.status(201).json(successResponse(await this.generation.reportCycle(req.body)));
  };

  // ---------------------------------------------------------------------------------------------------------------
  // M14-B: durable job ledger. Admin reads/actions and the runner's own lease-guarded writes.

  ledgerList = async (req: Request, res: Response): Promise<void> => {
    const rawStates = String(req.query.states ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const states = rawStates.map((value) => {
      const state = asJobState(value);
      if (!state) throw new ValidationError('Invalid state filter', [{ field: 'states', message: JOB_STATES.join(', '), value }]);
      return state;
    });
    const rawKind = String(req.query.kind ?? '').trim();
    if (rawKind && !JOB_KINDS.includes(rawKind as JobKind)) throw new ValidationError('Invalid kind filter', []);
    const archived = req.query.archived === '1' ? true : req.query.archived === '0' ? false : undefined;
    const query: LedgerQuery = {
      states: states.length ? states : undefined,
      kind: rawKind ? rawKind as JobKind : undefined,
      q: String(req.query.q ?? '').slice(0, 80) || undefined,
      archived,
      staleOnly: req.query.stale === '1',
      limit: Number(req.query.limit) || undefined,
      skip: Number(req.query.skip) || undefined,
    };
    res.json(successResponse(await this.ledger.list(query)));
  };

  ledgerGet = async (req: Request, res: Response): Promise<void> => {
    res.json(successResponse(await this.ledger.get(String(req.params.jobId))));
  };

  ledgerAction = async (req: Request, res: Response): Promise<void> => {
    const jobId = String(req.params.jobId);
    const action = String(req.params.action);
    const by = actor(req);
    if (action === 'delete') {
      await this.ledger.deleteMetadata(jobId);
      await audit().insertOne({ at: new Date(), action: 'editorial-ledger-delete', by, jobId });
      res.json(successResponse({ deleted: true, jobId }));
      return;
    }
    let job;
    switch (action) {
      case 'pause': job = await this.ledger.pause(jobId, by); break;
      case 'resume': job = await this.ledger.resume(jobId, by); break;
      case 'cancel': job = await this.ledger.cancel(jobId, by, String(req.body?.reason ?? '')); break;
      case 'retry': job = await this.ledger.retry(jobId, by); break;
      case 'recover': job = await this.ledger.recover(jobId, req.body?.force === true); break;
      case 'archive': job = await this.ledger.archive(jobId, by); break;
      default: throw new ValidationError('Invalid ledger action', [{ field: 'action', message: 'pause, resume, cancel, retry, recover, archive or delete', value: action }]);
    }
    await audit().insertOne({ at: new Date(), action: `editorial-ledger-${action}`, by, jobId, to: job.state });
    res.json(successResponse(job));
  };

  /** Reconcile every expired lease at once: requeue or dead-letter, never a live lease. */
  ledgerRecoverStale = async (req: Request, res: Response): Promise<void> => {
    const recovered = await this.ledger.recoverStale();
    await audit().insertOne({ at: new Date(), action: 'editorial-ledger-recover-stale', by: actor(req), recovered: recovered.length });
    res.json(successResponse({ recovered: recovered.map((job) => ({ jobId: job.jobId, state: job.state })), count: recovered.length }));
  };

  /** Bulk operations return one result per job: a mixed selection is expected, not an all-or-nothing failure. */
  ledgerBulk = async (req: Request, res: Response): Promise<void> => {
    const action = String(req.body?.action ?? '');
    if (!['pause', 'resume', 'cancel', 'retry', 'recover', 'archive', 'delete'].includes(action)) {
      throw new ValidationError('Invalid bulk action', [{ field: 'action', message: 'pause, resume, cancel, retry, recover, archive or delete', value: action }]);
    }
    const ids: string[] = [...new Set<string>((Array.isArray(req.body?.jobIds) ? req.body.jobIds : []).map((id: unknown) => String(id)).filter(Boolean))];
    if (!ids.length || ids.length > MAX_BULK) throw new ValidationError(`Select between 1 and ${MAX_BULK} jobs`, []);
    const by = actor(req);
    const reason = String(req.body?.reason ?? '');
    const results: Array<{ jobId: string; ok: boolean; state?: string; error?: string }> = [];
    for (const jobId of ids) {
      try {
        if (action === 'delete') {
          await this.ledger.deleteMetadata(jobId);
          results.push({ jobId, ok: true, state: 'deleted' });
        } else {
          const job = action === 'cancel' ? await this.ledger.cancel(jobId, by, reason)
            : action === 'recover' ? await this.ledger.recover(jobId, req.body?.force === true)
              : action === 'pause' ? await this.ledger.pause(jobId, by)
                : action === 'resume' ? await this.ledger.resume(jobId, by)
                  : action === 'retry' ? await this.ledger.retry(jobId, by)
                    : await this.ledger.archive(jobId, by);
          results.push({ jobId, ok: true, state: job.state });
        }
      } catch (error) {
        results.push({ jobId, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await audit().insertOne({ at: new Date(), action: `editorial-ledger-bulk-${action}`, by, total: ids.length, failed: results.filter((r) => !r.ok).length });
    res.json(successResponse({ action, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
  };

  ledgerRegister = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const job = await this.ledger.register({
      jobId: String(b.jobId ?? ''),
      slug: String(b.slug ?? ''),
      kind: JOB_KINDS.includes(b.kind as JobKind) ? b.kind as JobKind : 'article',
      maxAttempts: Number.isInteger(b.maxAttempts) ? Number(b.maxAttempts) : undefined,
      stageMs: Number(b.stageMs) || undefined,
      articleMs: Number(b.articleMs) || undefined,
      providerModels: Array.isArray(b.providerModels) ? b.providerModels : [],
      createdBy: 'runner',
    });
    res.status(201).json(successResponse(job));
  };

  ledgerClaim = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const id = String(b.worker?.id ?? '').trim().slice(0, 120);
    if (!id) throw new ValidationError('worker.id is required', []);
    const job = await this.ledger.claim(String(req.params.jobId), {
      id, host: typeof b.worker?.host === 'string' ? b.worker.host.slice(0, 120) : null,
      pid: Number.isInteger(b.worker?.pid) ? b.worker.pid : null,
    }, Number(b.leaseMs) || undefined);
    res.json(successResponse(job));
  };

  ledgerHeartbeat = async (req: Request, res: Response): Promise<void> => {
    const { token, generation } = requireLease(req);
    res.json(successResponse(await this.ledger.heartbeat(String(req.params.jobId), token, generation, String(req.body?.progress ?? '') || undefined, Number(req.body?.leaseMs) || undefined)));
  };

  ledgerStageStart = async (req: Request, res: Response): Promise<void> => {
    const { token, generation } = requireLease(req);
    const name = asStage(req.body?.name);
    res.json(successResponse(await this.ledger.startStage(String(req.params.jobId), token, generation, name, String(req.body?.detail ?? '') || undefined)));
  };

  ledgerStageFinish = async (req: Request, res: Response): Promise<void> => {
    const { token, generation } = requireLease(req);
    const name = asStage(req.body?.name);
    const state = req.body?.state;
    if (!['completed', 'failed', 'skipped', 'cancelled'].includes(state)) throw new ValidationError('Invalid stage state', []);
    res.json(successResponse(await this.ledger.finishStage(String(req.params.jobId), token, generation, name, state, asError(req.body?.error), String(req.body?.detail ?? '') || undefined)));
  };

  ledgerCheckpoint = async (req: Request, res: Response): Promise<void> => {
    const { token, generation } = requireLease(req);
    const stage = req.body?.stage === undefined || req.body?.stage === null ? null : asStage(req.body.stage);
    res.json(successResponse(await this.ledger.checkpoint(String(req.params.jobId), token, generation, { stage, ref: String(req.body?.ref ?? ''), hash: req.body?.hash == null ? null : String(req.body.hash) })));
  };

  ledgerFinish = async (req: Request, res: Response): Promise<void> => {
    const { token, generation } = requireLease(req);
    const state = req.body?.state;
    if (!['completed', 'failed', 'cancelled', 'blocked', 'paused'].includes(state)) throw new ValidationError('Invalid terminal state', []);
    res.json(successResponse(await this.ledger.finish(String(req.params.jobId), token, generation, state, asError(req.body?.error), asUsage(req.body?.usage))));
  };

  ledgerPublication = async (req: Request, res: Response): Promise<void> => {
    const { token, generation } = requireLease(req);
    const phase = req.body?.phase;
    if (phase === 'begin') {
      res.json(successResponse(await this.ledger.beginPublication(String(req.params.jobId), token, generation, String(req.body?.key ?? ''), req.body?.url == null ? null : String(req.body.url))));
      return;
    }
    if (phase === 'finish') {
      const state = req.body?.state;
      if (state !== 'published' && state !== 'rejected') throw new ValidationError('Invalid publication state', []);
      res.json(successResponse(await this.ledger.finishPublication(String(req.params.jobId), token, generation, state, req.body?.url == null ? null : String(req.body.url))));
      return;
    }
    throw new ValidationError('Publication phase must be begin or finish', []);
  };
}
