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

/**
 * M11-C Admin supervision of the AI editorial pipeline (/v2/admin/editorial, admin role enforced by the router).
 * Read-only views plus the emergency stop. Nothing here approves or publishes: that stays on the review-key
 * endpoints of BlogController, which re-run every gate.
 */

const db = () => BlogPostModel.db;
const settings = () => db().collection<{ _id: string; paused?: boolean; pausedAt?: Date; pausedBy?: string; pausedReason?: string }>('editorial_settings');
const audit = () => db().collection('editorial_audit');
const jobs = () => db().collection('editorial_jobs');
const DAY = 864e5;

/** Automatic publication needs the deploy-time switch on AND no emergency stop from the Admin. */
export async function editorialPolicyState() {
  const doc = await settings().findOne({ _id: 'policy' });
  const envEnabled = process.env.EDITORIAL_POLICY_PUBLISHING === 'enabled';
  const paused = Boolean(doc?.paused);
  return {
    envEnabled, paused, active: envEnabled && !paused,
    pausedAt: doc?.paused ? doc.pausedAt?.toISOString() ?? null : null,
    pausedBy: doc?.paused ? doc.pausedBy ?? null : null,
    pausedReason: doc?.paused ? doc.pausedReason ?? null : null,
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
    const [policy, approvalsLast24h, recentJobs, posts, spend] = await Promise.all([
      editorialPolicyState(),
      db().collection('editorial_policy_approvals').countDocuments({ at: { $gte: since(DAY) } }),
      jobs().find({}, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(50).toArray(),
      BlogPostModel.find({ origin: 'ai-assisted', editorial: { $exists: true } })
        .select({ title: 1, slug: 1, status: 1, reviewState: 1, reviewedBy: 1, updatedAt: 1, featuredImage: 1, editorial: 1 })
        .sort({ updatedAt: -1 }).limit(50).lean().exec(),
      jobs().aggregate<{ _id: string; usd: number }>([
        // startedAt is stored as the runner's ISO string, so the day is its first 10 characters.
        { $match: { startedAt: { $gte: since(30 * DAY).toISOString() } } },
        { $group: { _id: { $substr: ['$startedAt', 0, 10] }, usd: { $sum: '$costUsd' } } },
      ]).toArray(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const { routes, imageRoutes } = routesFromEnv();
    res.json(successResponse({
      policy: {
        ...policy, approvalsLast24h,
        dailyLimit: Number(process.env.EDITORIAL_POLICY_DAILY_LIMIT ?? 3),
        signingKeyConfigured: Boolean(process.env.EDITORIAL_PIPELINE_SIGNING_KEY),
        liveProviders: [...LIVE_PROVIDERS],
      },
      limits: {
        maxArticleUsd: Number(process.env.EDITORIAL_MAX_ARTICLE_USD ?? DEFAULT_EDITORIAL_LIMITS.maxArticleUsd),
        maxDailyUsd: Number(process.env.EDITORIAL_MAX_DAILY_USD ?? DEFAULT_EDITORIAL_LIMITS.maxDailyUsd),
        maxDailyArticles: Number(process.env.EDITORIAL_MAX_DAILY ?? DEFAULT_EDITORIAL_LIMITS.maxDailyArticles),
      },
      routes, imageRoutes,
      spend: {
        todayUsd: +(spend.find((d) => d._id === today)?.usd ?? 0).toFixed(4),
        last30dUsd: +spend.reduce((sum, d) => sum + d.usd, 0).toFixed(4),
      },
      jobs: recentJobs,
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

  /** Lifting the stop needs the editorial review key as well (router), and the env switch still decides. */
  resume = async (req: Request, res: Response): Promise<void> => {
    // The reviewer name is what the key holder declares; the authenticated actor is recorded next to it.
    const by = String(req.header('x-editorial-reviewer') || '').trim().slice(0, 120) || actor(req);
    await settings().updateOne({ _id: 'policy' }, { $set: { paused: false }, $unset: { pausedAt: 1, pausedBy: 1, pausedReason: 1 } }, { upsert: true });
    await audit().insertOne({ at: new Date(), action: 'policy-resume', by, actor: actor(req) });
    res.json(successResponse({ policy: await editorialPolicyState() }));
  };

  /**
   * Run summaries from the pipeline runner (scripts/editorial-agents.mjs --api): every job, blocked ones too.
   * No draft text or evidence is accepted here. `jobId` is unique, so a replayed report is refused.
   */
  recordJob = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
    const job = {
      jobId: text(b.jobId, 160), slug: text(b.slug, 120), state: text(b.state, 40), reason: text(b.reason, 1000),
      startedAt: text(b.startedAt, 40), backend: text(b.backend, 80), imageFailure: text(b.imageFailure, 500),
      costUsd: Number(b.costUsd),
      costEntries: (Array.isArray(b.costEntries) ? b.costEntries : []).filter((e: unknown) => e && typeof e === 'object').slice(0, 50).map((e: Record<string, unknown>) => ({
        role: text(e.role, 20), model: text(e.model, 80), inputTokens: Number(e.inputTokens) || 0,
        outputTokens: Number(e.outputTokens) || 0, searches: Number(e.searches) || 0, usd: Number(e.usd) || 0,
      })),
      blockingCodes: (Array.isArray(b.blockingCodes) ? b.blockingCodes : []).slice(0, 50).map((c: unknown) => text(c, 60)),
    };
    if (!job.jobId || !job.slug || !job.state || !job.startedAt || Number.isNaN(Date.parse(job.startedAt)) || !Number.isFinite(job.costUsd) || job.costUsd < 0) {
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
