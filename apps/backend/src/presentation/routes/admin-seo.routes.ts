// /v2/admin/seo — rutas y persistencia del centro de control SEO (M14-F). El núcleo
// determinista (cuadrícula, detección, corrección, inspección) vive en
// SeoIndexationService; aquí están las consultas/escrituras Mongo y el contrato HTTP
// sobre el sobre { success, data, meta }.
import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { PUBLIC_EDITORIAL_FILTER } from '../../application/services/EditorialReviewPolicy';
import { guideUrl } from '../../application/services/SearchConsoleMonitor';
import {
  batchInspectUrls, buildSeoGrid, detectIssues, ISSUE_DEFS, parseSeoIndexationQuery,
  safeSeoFix, scheduleReinspections, type SeoIssueState, type SeoIssueView,
  type SeoIndexationQuery, type SeoPostSeed, type SeoUrlView,
} from '../../application/services/SeoIndexationService';
import { successResponse } from '../../shared/types/ApiResponse';
import { ValidationError } from '../../shared/errors';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import type { AuthService } from '../../domain/services/AuthService';
import { createAdminAccessGuard } from '../middlewares/adminAccessGuard';
import { strictRateLimit } from '../middlewares/rateLimit';

const db = () => BlogPostModel.db;
const seoUrls = () => db().collection('seo_urls');
const seoIssueCol = () => db().collection('seo_issues');
const RECHECK_AFTER_MS = 7 * 864e5;

const toUrlView = (d: Record<string, any>): SeoUrlView => ({
  url: d.url, slug: d.slug, contentType: d.contentType, publishedAt: d.publishedAt,
  intendedIndexable: d.intendedIndexable, state: d.state, lastInspectedAt: d.lastInspectedAt,
  inSitemap: d.inSitemap, declaredCanonical: d.declaredCanonical, googleCanonical: d.googleCanonical,
  robotsDirective: d.robotsDirective, issueCodes: d.issueCodes ?? [], actions: d.actions ?? [], nextInspectionAt: d.nextInspectionAt ?? null,
});

const toIssueView = (d: Record<string, any>): SeoIssueView => ({
  id: String(d._id), code: d.code, severity: d.severity, evidence: d.evidence, urls: d.urls,
  detectedAt: d.detectedAt, proposedAction: d.proposedAction, automationEligible: d.automationEligible,
  ...(d.automationKind ? { automationKind: d.automationKind } : {}),
  state: d.state, appliedAt: d.appliedAt ?? null, dismissedAt: d.dismissedAt ?? null, recheck: d.recheck ?? null,
});

const findIssueDoc = async (id: string): Promise<Record<string, any>> => {
  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { throw new ValidationError('Incidencia no encontrada', []); }
  const doc = await seoIssueCol().findOne({ _id: oid });
  if (!doc) throw new ValidationError('Incidencia no encontrada', []);
  return doc;
};

async function loadSeoInventory(): Promise<{ seeds: SeoPostSeed[]; grid: SeoUrlView[]; inspections: Map<string, any> }> {
  const posts = await BlogPostModel.find(PUBLIC_EDITORIAL_FILTER)
    .select({ slug: 1, title: 1, content: 1, excerpt: 1, contentType: 1, publishedAt: 1, seo: 1, faqItems: 1, editorial: 1 })
    .sort({ publishedAt: -1 }).lean().exec();
  const seeds: SeoPostSeed[] = posts.map((raw) => {
    const p = raw as Record<string, any>;
    const seo = (p.seo ?? {}) as Record<string, any>;
    const editorial = (p.editorial ?? {}) as Record<string, any>;
    return {
      slug: String(p.slug ?? ''), title: String(p.title ?? ''), content: String(p.content ?? ''),
      excerpt: String(p.excerpt ?? ''), contentType: String(p.contentType ?? 'guide'),
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      metaTitle: seo.metaTitle ?? null, metaDescription: seo.metaDescription ?? null,
      canonicalUrl: seo.canonicalUrl ?? null,
      faqItems: (p.faqItems ?? []) as Array<{ question?: string; answer?: string }>,
      claims: (editorial.bundle?.claims ?? []) as Array<{ status?: string }>,
    };
  });
  const urls = seeds.filter((s) => s.slug).map((s) => guideUrl(s.slug));
  const inspected = await db().collection('editorial_gsc_inspections').find({ url: { $in: urls } }).toArray();
  const inspMap = new Map<string, any>(inspected.map((i) => [String((i as any).url), i]));
  const sitemapSlugs = new Set(seeds.filter((s) => s.slug).map((s) => s.slug as string));
  return { seeds, grid: buildSeoGrid(seeds, inspMap, sitemapSlugs), inspections: inspMap };
}

async function refreshSeoUrls(now = new Date()): Promise<void> {
  await seoUrls().createIndex({ url: 1 }, { unique: true });
  const { grid } = await loadSeoInventory();
  for (const row of grid) {
    const observed = { url: row.url, slug: row.slug, contentType: row.contentType, publishedAt: row.publishedAt, state: row.state, lastInspectedAt: row.lastInspectedAt, googleCanonical: row.googleCanonical, updatedAt: now };
    const intent = { intendedIndexable: row.intendedIndexable, inSitemap: row.inSitemap, declaredCanonical: row.declaredCanonical, robotsDirective: row.robotsDirective, nextInspectionAt: row.nextInspectionAt, issueCodes: row.issueCodes, actions: row.actions };
    await seoUrls().updateOne({ url: row.url }, { $set: observed, $setOnInsert: intent }, { upsert: true });
  }
}

const availableActions = (codes: string[]): string[] => {
  const out = new Set<string>(['inspect', 'schedule']);
  for (const c of codes) out.add(ISSUE_DEFS[c]?.automationKind ? 'apply' : 'review');
  return [...out];
};

async function runSeoAudit(now = new Date()): Promise<{ issues: SeoIssueView[]; urls: number }> {
  await seoIssueCol().createIndex({ key: 1 }, { unique: true });
  await refreshSeoUrls(now);
  const { grid, seeds, inspections } = await loadSeoInventory();
  const detected = detectIssues(grid, seeds, inspections);
  const nowIso = now.toISOString();
  const detectedKeys = new Set<string>();
  const openByUrl = new Map<string, Set<string>>();
  const views: SeoIssueView[] = [];
  for (const s of detected) {
    const key = `${s.code}:${[...s.urls].sort().join('|')}`;
    detectedKeys.add(key);
    const base = { code: s.code, severity: s.severity, evidence: s.evidence, urls: s.urls, proposedAction: s.proposedAction, automationEligible: s.automationEligible, ...(s.automationKind ? { automationKind: s.automationKind } : {}) };
    const existing = await seoIssueCol().findOne({ key });
    if (existing) await seoIssueCol().updateOne({ key }, { $set: base });
    else await seoIssueCol().insertOne({ key, ...base, state: 'open', detectedAt: nowIso, appliedAt: null, dismissedAt: null, recheck: null });
    const saved = await seoIssueCol().findOne({ key });
    if (saved) {
      views.push(toIssueView(saved));
      for (const u of s.urls) { const set = openByUrl.get(u) ?? new Set<string>(); set.add(s.code); openByUrl.set(u, set); }
    }
  }
  const applied = await seoIssueCol().find({ state: 'applied', 'recheck.result': 'pending' }).toArray();
  for (const a of applied) {
    const scheduledAt = new Date(a.recheck?.scheduledAt ?? 0).getTime();
    if (scheduledAt > now.getTime()) continue;
    const result = detectedKeys.has(String(a.key)) ? 'unresolved' : 'resolved';
    await seoIssueCol().updateOne({ _id: a._id }, { $set: { 'recheck.result': result, 'recheck.checkedAt': nowIso } });
  }
  for (const row of grid) {
    const codes = [...(openByUrl.get(row.url) ?? new Set<string>())].sort();
    await seoUrls().updateOne({ url: row.url }, { $set: { issueCodes: codes, actions: availableActions(codes), updatedAt: now } });
  }
  return { issues: views, urls: grid.length };
}

async function seoSummary(): Promise<Record<string, unknown>> {
  const [rows, issues] = await Promise.all([seoUrls().find({}).toArray(), seoIssueCol().find({}).toArray()]);
  const byState: Record<string, number> = {}; const byType: Record<string, number> = {}; const bySeverity: Record<string, number> = {};
  for (const r of rows) { byState[String((r as any).state)] = (byState[String((r as any).state)] ?? 0) + 1; byType[String((r as any).contentType)] = (byType[String((r as any).contentType)] ?? 0) + 1; }
  let openIssues = 0;
  for (const i of issues) if ((i as any).state === 'open') { openIssues++; bySeverity[String((i as any).severity)] = (bySeverity[String((i as any).severity)] ?? 0) + 1; }
  return { total: rows.length, indexable: rows.filter((r) => (r as any).intendedIndexable).length, indexed: rows.filter((r) => (r as any).state === 'indexed').length, byState, byType, openIssues, bySeverity };
}

async function seoIndexationList(q: SeoIndexationQuery): Promise<{ rows: SeoUrlView[]; total: number }> {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter: Record<string, unknown> = {};
  if (q.q) filter.$or = [{ url: { $regex: escape(q.q), $options: 'i' } }, { slug: { $regex: escape(q.q), $options: 'i' } }];
  if (q.state) filter.state = q.state;
  if (q.indexable !== undefined) filter.intendedIndexable = q.indexable;
  if (q.hasIssues === true) filter['issueCodes.0'] = { $exists: true };
  if (q.hasIssues === false) filter['issueCodes.0'] = { $exists: false };
  const total = await seoUrls().countDocuments(filter);
  const docs = await seoUrls().find(filter).sort({ [q.sort]: q.dir }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).toArray();
  return { rows: docs.map((d) => toUrlView(d as Record<string, any>)), total };
}

async function seoExport(): Promise<{ rows: SeoUrlView[]; exportedAt: string }> {
  const docs = await seoUrls().find({}).sort({ url: 1 }).toArray();
  return { exportedAt: new Date().toISOString(), rows: docs.map((d) => toUrlView(d as Record<string, any>)) };
}

async function seoIssueList(state?: SeoIssueState): Promise<SeoIssueView[]> {
  const docs = await seoIssueCol().find(state ? { state } : {}).sort({ detectedAt: -1 }).toArray();
  return docs.map((d) => toIssueView(d as Record<string, any>));
}

async function applySeoIssue(id: string, note: string, now = new Date()): Promise<SeoIssueView> {
  const doc = await findIssueDoc(id);
  if (doc.state !== 'open') throw new ValidationError('La incidencia ya no está abierta', []);
  const rows = await seoUrls().find({ url: { $in: doc.urls } }).toArray();
  const fix = safeSeoFix(String(doc.code), rows.map((r) => toUrlView(r as Record<string, any>)));
  if (fix.applicable) {
    for (const u of fix.updates) await seoUrls().updateOne({ url: u.url }, { $set: { [u.field]: u.value, updatedAt: now } });
  } else if (!note.trim()) {
    throw new ValidationError('Corrección sin automatización segura', [{ field: 'note', message: 'Describe la acción editorial aplicada para registrarla', value: note }]);
  }
  await seoIssueCol().updateOne({ _id: doc._id }, { $set: { state: 'applied', appliedAt: now.toISOString(), recheck: { scheduledAt: new Date(now.getTime() + RECHECK_AFTER_MS).toISOString(), result: 'pending', checkedAt: null } } });
  return toIssueView(await findIssueDoc(id));
}

async function dismissSeoIssue(id: string, now = new Date()): Promise<SeoIssueView> {
  const doc = await findIssueDoc(id);
  if (doc.state === 'dismissed') throw new ValidationError('La incidencia ya está descartada', []);
  await seoIssueCol().updateOne({ _id: doc._id }, { $set: { state: 'dismissed', dismissedAt: now.toISOString() } });
  return toIssueView(await findIssueDoc(id));
}

const stringArray = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 500);

const indexation = async (req: Request, res: Response): Promise<void> => {
  const q = parseSeoIndexationQuery(req.query as Record<string, unknown>);
  const { rows, total } = await seoIndexationList(q);
  res.json(successResponse(rows, { page: q.page, pageSize: q.pageSize, total, pages: Math.ceil(total / q.pageSize) }));
};
const summary = async (_req: Request, res: Response): Promise<void> => { res.json(successResponse(await seoSummary())); };
const inspect = async (req: Request, res: Response): Promise<void> => {
  const urls = stringArray(req.body?.urls);
  if (!urls.length) throw new ValidationError('Selecciona al menos una URL', []);
  res.json(successResponse(await batchInspectUrls(urls)));
};
const schedule = async (req: Request, res: Response): Promise<void> => {
  const urls = stringArray(req.body?.urls);
  if (!urls.length) throw new ValidationError('Selecciona al menos una URL', []);
  const atRaw = String(req.body?.at ?? '');
  const at = atRaw ? new Date(atRaw) : new Date(Date.now() + 24 * 3600e3);
  if (Number.isNaN(at.getTime())) throw new ValidationError('Fecha de reinspección inválida', []);
  res.json(successResponse(await scheduleReinspections(urls, at)));
};
const issues = async (req: Request, res: Response): Promise<void> => {
  const stateRaw = String(req.query.state ?? '').trim();
  const state = ['open', 'applied', 'dismissed'].includes(stateRaw) ? stateRaw as SeoIssueState : undefined;
  res.json(successResponse(await seoIssueList(state)));
};
const applyIssue = async (req: Request, res: Response): Promise<void> => {
  res.json(successResponse(await applySeoIssue(String(req.params.id), String(req.body?.note ?? ''))));
};
const dismissIssue = async (req: Request, res: Response): Promise<void> => {
  res.json(successResponse(await dismissSeoIssue(String(req.params.id))));
};
const audit = async (_req: Request, res: Response): Promise<void> => { res.json(successResponse(await runSeoAudit())); };
const exportGrid = async (_req: Request, res: Response): Promise<void> => { res.json(successResponse(await seoExport())); };

export const createAdminSeoRoutes = (authService: AuthService): Router => {
  const router = Router();
  router.use(createAdminAccessGuard(authService));
  router.get('/indexation', asyncHandler(indexation));
  router.get('/indexation/summary', asyncHandler(summary));
  router.post('/indexation/inspect', strictRateLimit, asyncHandler(inspect));
  router.post('/indexation/schedule', strictRateLimit, asyncHandler(schedule));
  router.get('/issues', asyncHandler(issues));
  router.post('/issues/:id/apply', strictRateLimit, asyncHandler(applyIssue));
  router.post('/issues/:id/dismiss', strictRateLimit, asyncHandler(dismissIssue));
  router.post('/audit', strictRateLimit, asyncHandler(audit));
  router.get('/export', asyncHandler(exportGrid));
  return router;
};
