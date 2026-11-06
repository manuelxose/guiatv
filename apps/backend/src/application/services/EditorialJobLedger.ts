import { randomUUID } from 'node:crypto';
import { BlogPostModel } from '../../infrastructure/database/models/BlogPost.model';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';

/**
 * M14-B: durable job/stage ledger with leases, fencing and deadlines.
 *
 * The ledger is the single source of truth for what a worker is doing. Every worker write is guarded by the
 * lease token and a monotonically increasing revision, so a worker whose lease expired can never overwrite
 * the worker that recovered the job. Pure transitions live here; the repository only performs an atomic
 * compare-and-set on `revision`.
 */

export const STAGE_NAMES = [
  'topic-selection',
  'source-discovery',
  'source-retrieval',
  'evidence-validation',
  'research-synthesis',
  'editorial-outline',
  'article-drafting',
  'seo-enrichment',
  'quality-evaluation',
  'revision',
  'publication-eligibility',
  'publication',
  'sitemap-registration',
] as const;
export type StageName = typeof STAGE_NAMES[number];

export const JOB_STATES = ['queued', 'running', 'paused', 'cancelling', 'cancelled', 'completed', 'failed', 'dead-letter', 'blocked'] as const;
export type JobState = typeof JOB_STATES[number];
export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(['cancelled', 'completed', 'failed', 'dead-letter', 'blocked']);

export const JOB_KINDS = ['article', 'discovery', 'maintenance', 'enrichment'] as const;
export type JobKind = typeof JOB_KINDS[number];

export const ERROR_CLASSES = [
  'provider-unavailable',
  'provider-timeout',
  'provider-response-too-large',
  'deadline-exceeded',
  'cancelled',
  'validation',
  'source-gate',
  'publication',
  'lease-expired',
  'worker-exit',
  'unknown',
] as const;
export type ErrorClass = typeof ERROR_CLASSES[number];

export type StageState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export interface StageRecord {
  key: string;
  name: StageName;
  attempt: number;
  state: StageState;
  startedAt: string;
  endedAt: string | null;
  deadlineAt: string;
  error: { classification: ErrorClass; message: string } | null;
  detail: string | null;
}

export interface JobLease {
  token: string;
  generation: number;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt: string;
}

export interface JobWorker {
  id: string;
  host: string | null;
  pid: number | null;
}

export interface JobCheckpoint {
  at: string;
  stage: StageName | null;
  ref: string;
  hash: string | null;
}

export interface JobPublication {
  key: string;
  state: 'publishing' | 'published' | 'rejected';
  url: string | null;
  at: string;
}

export interface JobUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface JobLedgerRecord {
  jobId: string;
  slug: string;
  kind: JobKind;
  state: JobState;
  currentStage: StageName | null;
  attempt: number;
  maxAttempts: number;
  worker: JobWorker | null;
  lease: JobLease | null;
  lastLeaseGeneration: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  articleDeadlineAt: string | null;
  lastProgressAt: string;
  progress: string | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  archivedAt: string | null;
  error: { classification: ErrorClass; message: string } | null;
  usage: JobUsage;
  providerModels: string[];
  stages: StageRecord[];
  checkpoints: JobCheckpoint[];
  publication: JobPublication | null;
  publicationKey: string | null;
  lastActionBy: string | null;
  revision: number;
  deadlines: { stageMs: number; articleMs: number };
}

export interface RegisterJobInput {
  jobId: string;
  slug: string;
  kind?: JobKind;
  maxAttempts?: number;
  stageMs?: number;
  articleMs?: number;
  providerModels?: string[];
  createdBy?: string;
}

export interface LedgerQuery {
  states?: JobState[];
  kind?: JobKind;
  slug?: string;
  q?: string;
  archived?: boolean;
  staleOnly?: boolean;
  limit?: number;
  skip?: number;
}

export interface LedgerPage {
  items: JobLedgerRecord[];
  total: number;
  limit: number;
  skip: number;
}

export interface JobLedgerRepository {
  insert(job: JobLedgerRecord): Promise<void>;
  get(jobId: string): Promise<JobLedgerRecord | null>;
  getByPublicationKey(key: string): Promise<JobLedgerRecord | null>;
  /** Atomic compare-and-set on the previous revision. Returns false when another writer won. */
  replace(job: JobLedgerRecord): Promise<boolean>;
  list(query: LedgerQuery, now: Date): Promise<LedgerPage>;
  remove(jobId: string): Promise<boolean>;
}

const MAX_LIMIT = 100;
const MAX_STAGES = 120;
const MAX_CHECKPOINTS = 50;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_STAGE_MS = 10 * 60_000;
const DEFAULT_ARTICLE_MS = 30 * 60_000;
const DEFAULT_LEASE_MS = 90_000;

const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const iso = (date: Date): string => date.toISOString();
const ms = (name: string, value: number | undefined, fallback: number, min: number, max: number): number => {
  const n = value ?? (Number(process.env[name]) || fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ValidationError(`${name} must be an integer from ${min} to ${max}`, []);
  return n;
};

export function deadlines(stageMs?: number, articleMs?: number): { stageMs: number; articleMs: number } {
  return {
    stageMs: ms('EDITORIAL_STAGE_DEADLINE_MS', stageMs, DEFAULT_STAGE_MS, 30_000, 3_600_000),
    articleMs: ms('EDITORIAL_ARTICLE_DEADLINE_MS', articleMs, DEFAULT_ARTICLE_MS, 60_000, 21_600_000),
  };
}

export function leaseMs(value?: number): number {
  return ms('EDITORIAL_JOB_LEASE_MS', value, DEFAULT_LEASE_MS, 30_000, 900_000);
}

const live = (job: JobLedgerRecord, now: Date): boolean => Boolean(job.lease && Date.parse(job.lease.expiresAt) > now.getTime());
const bump = (job: JobLedgerRecord, patch: Partial<JobLedgerRecord>, now: Date): JobLedgerRecord => ({
  ...job, ...patch, updatedAt: iso(now), revision: job.revision + 1,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function requireWorker(job: JobLedgerRecord, token: string, generation: number, now: Date): void {
  if (!job.lease || job.lease.token !== token || job.lease.generation !== generation) {
    throw new ConflictError('Job lease no longer belongs to this worker');
  }
  if (Date.parse(job.lease.expiresAt) <= now.getTime()) throw new ConflictError('Job lease expired');
}

function requireRunning(job: JobLedgerRecord): void {
  if (!['running', 'cancelling'].includes(job.state)) throw new ConflictError(`Job is ${job.state}, not running`);
}

function requireTerminal(job: JobLedgerRecord): void {
  if (!TERMINAL_STATES.has(job.state)) throw new ConflictError(`Job is ${job.state}; only a terminal job can be archived or deleted`);
}

/** MongoDB refuses a duplicate unique-key write with code 11000 (E11000); the memory repository mimics it. */
const isDuplicateKeyError = (error: unknown): boolean => (error as { code?: number } | null)?.code === 11000;

export function createJob(input: RegisterJobInput, now: Date): JobLedgerRecord {
  const jobId = text(input.jobId, 160);
  const slug = text(input.slug, 120);
  if (!jobId || !slug) throw new ValidationError('jobId and slug are required', []);
  const kind = input.kind ?? 'article';
  if (!JOB_KINDS.includes(kind)) throw new ValidationError('Invalid job kind', []);
  if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(slug)) throw new ValidationError('Invalid job slug', []);
  const maxAttempts = Number.isInteger(input.maxAttempts) ? Math.min(Math.max(input.maxAttempts!, 1), 10) : DEFAULT_MAX_ATTEMPTS;
  const d = deadlines(input.stageMs, input.articleMs);
  return {
    jobId, slug, kind, state: 'queued', currentStage: null, attempt: 0, maxAttempts,
    worker: null, lease: null, lastLeaseGeneration: 0, createdAt: iso(now), updatedAt: iso(now), startedAt: null, endedAt: null,
    articleDeadlineAt: null, lastProgressAt: iso(now), progress: null, cancelRequested: false, pauseRequested: false,
    archivedAt: null, error: null, usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
    providerModels: (input.providerModels ?? []).map((m) => text(m, 80)).filter(Boolean).slice(0, 20),
    stages: [], checkpoints: [], publication: null, publicationKey: null, lastActionBy: text(input.createdBy, 120) || null,
    revision: 1, deadlines: d,
  };
}

export function claimJob(job: JobLedgerRecord, worker: JobWorker, now: Date, leaseDurationMs?: number): JobLedgerRecord {
  if (TERMINAL_STATES.has(job.state)) throw new ConflictError(`Job is ${job.state}`);
  if (job.lease && live(job, now)) throw new ConflictError('Job is already owned by a live worker');
  if (job.state === 'paused') throw new ConflictError('Job is paused');
  if (job.articleDeadlineAt && Date.parse(job.articleDeadlineAt) <= now.getTime()) {
    return bump(job, { state: 'failed', endedAt: iso(now), lease: null, worker, error: { classification: 'deadline-exceeded', message: 'Article deadline elapsed before the job could be claimed' } }, now);
  }
  if (job.attempt >= job.maxAttempts) {
    return bump(job, { state: 'dead-letter', endedAt: iso(now), lease: null, worker, error: { classification: 'unknown', message: 'Maximum attempts reached' } }, now);
  }
  const duration = leaseMs(leaseDurationMs);
  const generation = (job.lease?.generation ?? job.lastLeaseGeneration) + 1;
  const lease: JobLease = { token: randomUUID(), generation, acquiredAt: iso(now), expiresAt: new Date(now.getTime() + duration).toISOString(), heartbeatAt: iso(now) };
  return bump(job, {
    state: 'running', worker, lease, lastLeaseGeneration: generation, attempt: job.attempt + 1, startedAt: job.startedAt ?? iso(now),
    articleDeadlineAt: job.articleDeadlineAt ?? new Date(now.getTime() + job.deadlines.articleMs).toISOString(),
    cancelRequested: false, pauseRequested: false, error: null,
  }, now);
}

export function heartbeatJob(job: JobLedgerRecord, token: string, generation: number, now: Date, progress?: string, leaseDurationMs?: number): JobLedgerRecord {
  requireWorker(job, token, generation, now);
  requireRunning(job);
  if (job.articleDeadlineAt && Date.parse(job.articleDeadlineAt) <= now.getTime()) {
    return bump(job, { state: 'failed', endedAt: iso(now), lease: null, error: { classification: 'deadline-exceeded', message: 'Article deadline exceeded' } }, now);
  }
  const lease: JobLease = { ...job.lease!, expiresAt: new Date(now.getTime() + leaseMs(leaseDurationMs)).toISOString(), heartbeatAt: iso(now) };
  return bump(job, { lease, lastProgressAt: iso(now), progress: text(progress, 200) || job.progress }, now);
}

export function startStage(job: JobLedgerRecord, token: string, generation: number, name: StageName, now: Date, detail?: string): JobLedgerRecord {
  requireWorker(job, token, generation, now);
  requireRunning(job);
  if (!STAGE_NAMES.includes(name)) throw new ValidationError('Unknown stage', []);
  if (job.state === 'cancelling') throw new ConflictError('Job cancellation requested');
  const stages = clone(job.stages);
  // A stage restarted without finishing (worker crash between calls) is closed as failed, never left running.
  for (const stage of stages) if (stage.state === 'running') { stage.state = 'failed'; stage.endedAt = iso(now); stage.error = { classification: 'worker-exit', message: 'Stage superseded' }; }
  const attempt = stages.filter((s) => s.name === name).length + 1;
  stages.push({
    key: `${name}#${attempt}`, name, attempt, state: 'running', startedAt: iso(now), endedAt: null,
    deadlineAt: new Date(now.getTime() + job.deadlines.stageMs).toISOString(), error: null, detail: text(detail, 300) || null,
  });
  return bump(job, { stages: stages.slice(-MAX_STAGES), currentStage: name, lastProgressAt: iso(now) }, now);
}

export function finishStage(
  job: JobLedgerRecord, token: string, generation: number, name: StageName, state: Exclude<StageState, 'pending' | 'running'>,
  now: Date, error?: { classification: ErrorClass; message: string }, detail?: string,
): JobLedgerRecord {
  requireWorker(job, token, generation, now);
  const stages = clone(job.stages);
  const stage = [...stages].reverse().find((s) => s.name === name && s.state === 'running');
  if (!stage) throw new ConflictError(`Stage ${name} is not running`);
  stage.state = state;
  stage.endedAt = iso(now);
  stage.error = error ? { classification: error.classification, message: text(error.message, 500) } : null;
  if (detail) stage.detail = text(detail, 300);
  return bump(job, { stages, lastProgressAt: iso(now) }, now);
}

export function addCheckpoint(job: JobLedgerRecord, token: string, generation: number, checkpoint: Omit<JobCheckpoint, 'at'>, now: Date): JobLedgerRecord {
  requireWorker(job, token, generation, now);
  const row: JobCheckpoint = { at: iso(now), stage: checkpoint.stage, ref: text(checkpoint.ref, 200), hash: text(checkpoint.hash ?? '', 80) || null };
  if (!row.ref) throw new ValidationError('Checkpoint ref is required', []);
  return bump(job, { checkpoints: [...job.checkpoints, row].slice(-MAX_CHECKPOINTS), lastProgressAt: iso(now) }, now);
}

export function finishJob(
  job: JobLedgerRecord, token: string | null, generation: number | null, terminal: 'completed' | 'failed' | 'cancelled' | 'blocked' | 'paused',
  now: Date, error?: { classification: ErrorClass; message: string }, usage?: Partial<JobUsage>,
): JobLedgerRecord {
  if (TERMINAL_STATES.has(job.state)) {
    if (job.state === terminal) return job;
    throw new ConflictError(`Job is already ${job.state}`);
  }
  if (token !== null) requireWorker(job, token, generation ?? 0, now);
  const merged: JobUsage = {
    modelCalls: job.usage.modelCalls + Math.max(0, Number(usage?.modelCalls) || 0),
    inputTokens: job.usage.inputTokens + Math.max(0, Number(usage?.inputTokens) || 0),
    outputTokens: job.usage.outputTokens + Math.max(0, Number(usage?.outputTokens) || 0),
    usd: +(job.usage.usd + Math.max(0, Number(usage?.usd) || 0)).toFixed(6),
  };
  return bump(job, {
    state: terminal, endedAt: iso(now), lease: null, error: error ? { classification: error.classification, message: text(error.message, 500) } : job.error,
    usage: merged, cancelRequested: false, pauseRequested: false,
  }, now);
}

export function requestPause(job: JobLedgerRecord, actor: string, now: Date): JobLedgerRecord {
  if (TERMINAL_STATES.has(job.state)) throw new ConflictError(`Job is ${job.state}`);
  if (job.state === 'queued') return bump(job, { state: 'paused', lastActionBy: text(actor, 120) || null }, now);
  return bump(job, { pauseRequested: true, lastActionBy: text(actor, 120) || null }, now);
}

export function resumeJob(job: JobLedgerRecord, actor: string, now: Date): JobLedgerRecord {
  if (job.state !== 'paused') throw new ConflictError('Only a paused job can be resumed');
  return bump(job, { state: 'queued', endedAt: null, pauseRequested: false, lastActionBy: text(actor, 120) || null }, now);
}

/** Cancellation is requested, not declared complete: a live worker must stop and acknowledge it. */
export function requestCancel(job: JobLedgerRecord, actor: string, reason: string, now: Date): JobLedgerRecord {
  if (TERMINAL_STATES.has(job.state)) throw new ConflictError(`Job is ${job.state}`);
  const by = text(actor, 120) || null;
  if (job.state === 'queued' || job.state === 'paused') {
    return bump(job, { state: 'cancelled', endedAt: iso(now), cancelRequested: false, lastActionBy: by, error: { classification: 'cancelled', message: text(reason, 500) || 'Cancelled before it started' } }, now);
  }
  return bump(job, { state: 'cancelling', cancelRequested: true, lastActionBy: by, error: { classification: 'cancelled', message: text(reason, 500) || 'Cancellation requested' } }, now);
}

export function retryJob(job: JobLedgerRecord, actor: string, now: Date): JobLedgerRecord {
  if (!['failed', 'cancelled', 'dead-letter', 'blocked', 'completed'].includes(job.state)) throw new ConflictError(`A ${job.state} job cannot be retried`);
  if (job.attempt >= job.maxAttempts) throw new ConflictError(`Maximum attempts reached (${job.attempt}/${job.maxAttempts})`);
  return bump(job, {
    state: 'queued', endedAt: null, startedAt: null, articleDeadlineAt: null, currentStage: null, lease: null,
    error: null, cancelRequested: false, pauseRequested: false, lastActionBy: text(actor, 120) || null,
  }, now);
}

/** Reconcile a job whose lease expired: requeue it or declare it dead. Never while its lease is live. */
export function recoverJob(job: JobLedgerRecord, now: Date, force = false): JobLedgerRecord {
  if (TERMINAL_STATES.has(job.state)) return job;
  if (!['running', 'cancelling'].includes(job.state)) throw new ConflictError(`A ${job.state} job does not need lease recovery`);
  if (live(job, now) && !force) throw new ConflictError('Job lease is still live; refusing to recover');
  if (job.cancelRequested) return bump(job, { state: 'cancelled', endedAt: iso(now), lease: null, error: { classification: 'cancelled', message: 'Cancellation reconciled after the worker left' } }, now);
  if (job.attempt < job.maxAttempts) {
    return bump(job, { state: 'queued', lease: null, currentStage: null, error: { classification: 'lease-expired', message: 'Worker lease expired; job requeued' } }, now);
  }
  return bump(job, { state: 'dead-letter', endedAt: iso(now), lease: null, error: { classification: 'lease-expired', message: 'Worker lease expired and attempts are exhausted' } }, now);
}

export function archiveJob(job: JobLedgerRecord, actor: string, now: Date): JobLedgerRecord {
  requireTerminal(job);
  if (job.archivedAt) return job;
  return bump(job, { archivedAt: iso(now), lastActionBy: text(actor, 120) || null }, now);
}

export function beginPublication(job: JobLedgerRecord, token: string, generation: number, key: string, url: string | null, now: Date): JobLedgerRecord {
  requireWorker(job, token, generation, now);
  requireRunning(job);
  // A job that received a cancel request must never start publishing, even if the worker is still live.
  if (job.cancelRequested || job.state === 'cancelling') throw new ConflictError('Job cancellation requested');
  const publicationKey = text(key, 160);
  if (!publicationKey) throw new ValidationError('A publication idempotency key is required', []);
  return bump(job, { publication: { key: publicationKey, state: 'publishing', url: url ? text(url, 300) : null, at: iso(now) }, publicationKey, currentStage: 'publication' }, now);
}

export function finishPublication(job: JobLedgerRecord, token: string, generation: number, state: 'published' | 'rejected', url: string | null, now: Date): JobLedgerRecord {
  requireWorker(job, token, generation, now);
  if (!job.publication) throw new ConflictError('No publication is in progress');
  return bump(job, { publication: { ...job.publication, state, url: url ? text(url, 300) : job.publication.url, at: iso(now) } }, now);
}

export class EditorialJobLedger {
  constructor(private readonly repo: JobLedgerRepository = new MongoJobLedgerRepository(), private readonly clock: () => Date = () => new Date()) {}

  private async save(next: JobLedgerRecord): Promise<JobLedgerRecord> {
    if (!(await this.repo.replace(next))) throw new ConflictError('The job changed while this request ran; read it again');
    return next;
  }
  private async required(jobId: string): Promise<JobLedgerRecord> {
    const job = await this.repo.get(jobId);
    if (!job) throw new NotFoundError('Editorial job not found');
    return job;
  }

  async register(input: RegisterJobInput): Promise<JobLedgerRecord> {
    const job = createJob(input, this.clock());
    try { await this.repo.insert(job); return job; }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.repo.get(job.jobId);
      if (existing && existing.slug === job.slug) return existing;
      throw new ConflictError(`Job ${job.jobId} already exists`);
    }
  }

  async get(jobId: string): Promise<JobLedgerRecord> { return this.required(jobId); }

  async claim(jobId: string, worker: JobWorker, leaseDurationMs?: number): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    const next = claimJob(current, worker, this.clock(), leaseDurationMs);
    return this.save(next);
  }

  async heartbeat(jobId: string, token: string, generation: number, progress?: string, leaseDurationMs?: number): Promise<{ job: JobLedgerRecord; cancelRequested: boolean; pauseRequested: boolean }> {
    const current = await this.required(jobId);
    const next = heartbeatJob(current, token, generation, this.clock(), progress, leaseDurationMs);
    const saved = await this.save(next);
    return { job: saved, cancelRequested: saved.cancelRequested, pauseRequested: saved.pauseRequested };
  }

  async startStage(jobId: string, token: string, generation: number, name: StageName, detail?: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(startStage(current, token, generation, name, this.clock(), detail));
  }

  async finishStage(jobId: string, token: string, generation: number, name: StageName, state: Exclude<StageState, 'pending' | 'running'>, error?: { classification: ErrorClass; message: string }, detail?: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(finishStage(current, token, generation, name, state, this.clock(), error, detail));
  }

  async checkpoint(jobId: string, token: string, generation: number, checkpoint: Omit<JobCheckpoint, 'at'>): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(addCheckpoint(current, token, generation, checkpoint, this.clock()));
  }

  async finish(jobId: string, token: string | null, generation: number | null, state: 'completed' | 'failed' | 'cancelled' | 'blocked' | 'paused', error?: { classification: ErrorClass; message: string }, usage?: Partial<JobUsage>): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(finishJob(current, token, generation, state, this.clock(), error, usage));
  }

  async pause(jobId: string, actor: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(requestPause(current, actor, this.clock()));
  }
  async resume(jobId: string, actor: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(resumeJob(current, actor, this.clock()));
  }
  async cancel(jobId: string, actor: string, reason: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(requestCancel(current, actor, reason, this.clock()));
  }
  async retry(jobId: string, actor: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(retryJob(current, actor, this.clock()));
  }
  async recover(jobId: string, force = false): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(recoverJob(current, this.clock(), force));
  }
  async archive(jobId: string, actor: string): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(archiveJob(current, actor, this.clock()));
  }
  async beginPublication(jobId: string, token: string, generation: number, key: string, url: string | null): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    const duplicate = await this.repo.getByPublicationKey(key);
    if (duplicate && duplicate.jobId !== jobId) {
      // The idempotency key is the fence: a key held by another job — completed or in flight — is never reused.
      if (duplicate.publication?.state === 'published') throw new ConflictError(`Publication already completed by job ${duplicate.jobId}`);
      if (duplicate.publication?.state === 'publishing') throw new ConflictError(`Publication already in progress by job ${duplicate.jobId}`);
    }
    const next = beginPublication(current, token, generation, key, url, this.clock());
    try { return await this.save(next); }
    catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // The pre-check above is a read; a concurrent begin with the same key wins the race at the unique
      // publicationKey index, so the loser is reported as a conflict (409), never as an unknown error.
      const winner = await this.repo.getByPublicationKey(key);
      if (winner && winner.jobId !== jobId) throw new ConflictError(`Publication already in progress by job ${winner.jobId}`);
      throw new ConflictError('The job changed while this request ran; read it again');
    }
  }
  async finishPublication(jobId: string, token: string, generation: number, state: 'published' | 'rejected', url: string | null): Promise<JobLedgerRecord> {
    const current = await this.required(jobId);
    return this.save(finishPublication(current, token, generation, state, url, this.clock()));
  }

  async list(query: LedgerQuery = {}): Promise<LedgerPage> { return this.repo.list(query, this.clock()); }

  /** Terminal and archived metadata may be deleted; a live or unarchived execution may not. */
  async deleteMetadata(jobId: string): Promise<void> {
    const current = await this.required(jobId);
    requireTerminal(current);
    if (!current.archivedAt) throw new ConflictError('Archive the job before deleting its execution metadata');
    await this.repo.remove(jobId);
  }

  /** Reconcile every expired lease, oldest first. Used by the admin recovery control and by the runner at boot. */
  async recoverStale(limit = 20): Promise<JobLedgerRecord[]> {
    const page = await this.repo.list({ staleOnly: true, limit }, this.clock());
    const result: JobLedgerRecord[] = [];
    for (const job of page.items) {
      try { result.push(await this.save(recoverJob(job, this.clock()))); } catch { /* a competing recovery won */ }
    }
    return result;
  }
}

interface LedgerDocument extends JobLedgerRecord { _id: string }

/** MongoDB adapter: every write is a compare-and-set on `revision`, which is the fence a stale worker loses. */
export class MongoJobLedgerRepository implements JobLedgerRepository {
  private ready: Promise<unknown> | null = null;
  private collection() { return BlogPostModel.db.collection<LedgerDocument>('editorial_job_ledger'); }
  private indexes(): Promise<unknown> {
    this.ready ??= Promise.all([
      this.collection().createIndex({ jobId: 1 }, { unique: true }),
      this.collection().createIndex({ state: 1, updatedAt: -1 }),
      this.collection().createIndex({ 'lease.expiresAt': 1 }),
      this.collection().createIndex({ publicationKey: 1 }, { unique: true, partialFilterExpression: { publicationKey: { $type: 'string' } } }),
      this.collection().createIndex({ slug: 1, createdAt: -1 }),
    ]).catch((error) => { this.ready = null; throw error; });
    return this.ready;
  }
  async insert(job: JobLedgerRecord): Promise<void> {
    await this.indexes();
    await this.collection().insertOne({ ...job, _id: job.jobId });
  }
  async get(jobId: string): Promise<JobLedgerRecord | null> {
    const doc = await this.collection().findOne({ jobId });
    return doc ? this.strip(doc) : null;
  }
  async getByPublicationKey(key: string): Promise<JobLedgerRecord | null> {
    const doc = await this.collection().findOne({ publicationKey: key });
    return doc ? this.strip(doc) : null;
  }
  async replace(job: JobLedgerRecord): Promise<boolean> {
    const result = await this.collection().findOneAndUpdate(
      { jobId: job.jobId, revision: job.revision - 1 },
      { $set: { ...job } },
      { returnDocument: 'after' },
    );
    return Boolean(result);
  }
  async list(query: LedgerQuery, now: Date): Promise<LedgerPage> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 25), 1), MAX_LIMIT);
    const skip = Math.max(Math.trunc(query.skip ?? 0), 0);
    const filter: Record<string, unknown> = {};
    if (query.states?.length) filter.state = { $in: query.states };
    if (query.kind) filter.kind = query.kind;
    if (query.slug) filter.slug = query.slug;
    if (query.archived !== undefined) filter.archivedAt = query.archived ? { $ne: null } : null;
    if (query.q) {
      const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80);
      filter.$or = [{ jobId: new RegExp(safe, 'i') }, { slug: new RegExp(safe, 'i') }];
    }
    if (query.staleOnly) Object.assign(filter, { state: { $in: ['running', 'cancelling'] }, 'lease.expiresAt': { $lte: now.toISOString() } });
    const [docs, total] = await Promise.all([
      this.collection().find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection().countDocuments(filter),
    ]);
    return { items: docs.map((doc) => this.strip(doc)), total, limit, skip };
  }
  async remove(jobId: string): Promise<boolean> {
    const result = await this.collection().deleteOne({ jobId });
    return result.deletedCount === 1;
  }
  private strip(doc: LedgerDocument): JobLedgerRecord {
    const rest = { ...doc } as Partial<LedgerDocument>;
    delete rest._id;
    return rest as JobLedgerRecord;
  }
}
