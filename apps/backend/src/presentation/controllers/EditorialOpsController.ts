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
import { searchConsoleOverview } from '../../application/services/SearchConsoleMonitor';

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

export class EditorialOpsController {
  constructor(private readonly storage: IStorageRepository) {}

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
    const [policy, approvalsLast24h, recentJobs, todayJobs, posts, spend, searchConsole] = await Promise.all([
      editorialPolicyState(),
      db().collection('editorial_policy_approvals').countDocuments({ at: { $gte: since(DAY) } }),
      jobs().find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(50).toArray(),
      // startedAt is the runner's ISO string, so a string range is the UTC day.
      jobs().find({ startedAt: { $gte: today } }, { projection: { _id: 0, state: 1, revisions: 1, costUsd: 1, costEntries: 1, blockingCodes: 1 } }).toArray(),
      BlogPostModel.find({ origin: 'ai-assisted', editorial: { $exists: true } })
        .select({ title: 1, slug: 1, status: 1, reviewState: 1, reviewedBy: 1, updatedAt: 1, featuredImage: 1, editorial: 1 })
        .sort({ updatedAt: -1 }).limit(50).lean().exec(),
      jobs().aggregate<{ _id: string; usd: number }>([
        // startedAt is stored as the runner's ISO string, so the day is its first 10 characters.
        { $match: { startedAt: { $gte: since(30 * DAY).toISOString() } } },
        { $group: { _id: { $substr: ['$startedAt', 0, 10] }, usd: { $sum: '$costUsd' } } },
      ]).toArray(),
      // Monitoring only: a GSC read failure must not take the runner's overview (its cap and stop source) down.
      searchConsoleOverview().catch(() => null),
    ]);
    const { routes, imageRoutes } = routesFromEnv();
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
          id: String(post._id), slug: post.slug, title: post.title, status: post.status, reviewState: post.reviewState ?? 'unreviewed',
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
      provenance: {
        pipelineVersion: p.pipelineVersion, state: p.state, backend: p.backend ?? null,
        signed: provenanceSignatureValid(p, process.env.EDITORIAL_PIPELINE_SIGNING_KEY),
        bundle: p.bundle, critic: p.critic ?? null, cost: p.cost ?? null, images: p.images ?? [],
        lastVerifiedAt: p.lastVerifiedAt ?? null, nextReviewAt: p.nextReviewAt ?? null,
      },
      findings,
      policyBlockers: policyGateFailures(findings),
      revisions: (post.revisions ?? []).map((r) => ({ version: r.version, savedAt: r.savedAt, reason: r.reason, status: r.snapshot?.status })),
    }));
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
}
