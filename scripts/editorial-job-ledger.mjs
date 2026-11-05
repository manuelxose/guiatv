import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * M14-B runner side of the durable job ledger.
 *
 * One session per article: register → claim (lease + generation) → stage events and heartbeats → finish.
 * The server is the fence: a stale token or generation is rejected, so a worker that lost its lease cannot
 * report a stage, publish or complete the job. The runner also aborts the in-flight provider stream when a
 * cancel/pause is requested or a stage/article deadline passes.
 */

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'blocked', 'paused']);

function classify(reason, abortReason) {
  const text = String(reason ?? '').toLowerCase();
  if (abortReason === 'cancelled' || /cancel|abort/.test(text)) return 'cancelled';
  if (abortReason === 'deadline' || abortReason === 'stage-deadline' || /deadline|plazo|tiempo m[áa]ximo/.test(text)) return 'deadline-exceeded';
  if (/timeout|timed out|exceeded .*ms/.test(text)) return 'provider-timeout';
  if (/too large|exceeded .*bytes/.test(text)) return 'provider-response-too-large';
  if (/connection|fetch failed|unavailable|econn|429|5[0-9][0-9]/.test(text)) return 'provider-unavailable';
  if (/no devolvi[oó] afirmaciones|solo \d+ afirmaciones|shape|esquema|l[íi]mite/.test(text)) return 'validation';
  if (/source|fuente|seed|semilla/.test(text)) return 'source-gate';
  if (/publicaci[oó]n|publication/.test(text)) return 'publication';
  return 'unknown';
}

export class LedgerSession {
  constructor(options, topic) {
    this.api = options.api;
    this.key = options.key;
    this.slug = topic.slug;
    this.kind = options.kind ?? 'article';
    this.stageMs = options.stageMs ?? 10 * 60_000;
    this.articleMs = options.articleMs ?? 30 * 60_000;
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.leaseMs = options.leaseMs ?? 90_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.providerModels = options.providerModels ?? [];
    this.logger = options.logger ?? console;
    this.topic = topic;
    this.jobId = `${new Date().toISOString()}-${topic.slug}`;
    this.workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.abortReason = null;
    this.run = null;
    this.publication = null;
    this.closed = false;
    this.lease = null;
    this.stageTimer = null;
    this.articleTimer = null;
    this.heartbeatTimer = null;
  }

  get headers() { return { 'content-type': 'application/json', 'x-admin-key': this.key }; }

  async call(path, body, method = 'POST') {
    const response = await fetch(`${this.api}/v2/admin/editorial/ledger/${path}`, {
      method,
      headers: this.headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ledger ${path}: ${response.status} ${text.slice(0, 300)}`);
    return JSON.parse(text).data;
  }

  async open() {
    await this.call('register', {
      jobId: this.jobId, slug: this.slug, kind: this.kind, maxAttempts: this.maxAttempts,
      stageMs: this.stageMs, articleMs: this.articleMs,
      providerModels: this.providerModels,
    });
    const claimed = await this.call(`${encodeURIComponent(this.jobId)}/claim`, {
      worker: { id: this.workerId, host: hostname(), pid: process.pid }, leaseMs: this.leaseMs,
    });
    this.lease = { token: claimed.lease?.token, generation: claimed.lease?.generation };
    if (!this.lease.token || !this.lease.generation) throw new Error('ledger claim returned no lease');
    // Stages decided before the pipeline starts are recorded as skipped with their reason, never invented as completed.
    for (const [name, detail] of [
      ['topic-selection', 'tema ya seleccionado por la cola'],
      ['source-discovery', 'semillas verificadas antes del trabajo'],
      ['editorial-outline', 'el esquema va en el brief del redactor'],
    ]) {
      await this.startStage(name, detail);
      await this.finishStage(name, 'skipped', undefined, detail);
    }
    this.heartbeatTimer = setInterval(() => { this.heartbeat().catch((error) => this.logger.warn?.(`ledger heartbeat: ${error.message}`)); }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
    this.articleTimer = setTimeout(() => this.abort('deadline'), this.articleMs);
    this.articleTimer.unref?.();
    return this;
  }

  async heartbeat(progress) {
    if (this.closed || !this.lease) return null;
    const data = await this.call(`${encodeURIComponent(this.jobId)}/heartbeat`, {
      ...this.lease, progress: progress ?? null, leaseMs: this.leaseMs,
    });
    if (data.cancelRequested) this.abort('cancelled');
    else if (data.pauseRequested) this.abort('paused');
    else if (data.job?.state === 'failed') this.abort(data.job.error?.classification ?? 'failed');
    return data;
  }

  abort(reason) {
    if (this.abortReason) return;
    this.abortReason = reason;
    try { this.controller.abort(new Error(`editorial job aborted: ${reason}`)); } catch { this.controller.abort(); }
  }

  armStage(name) {
    clearTimeout(this.stageTimer);
    this.stageTimer = setTimeout(() => { this.logger.warn?.(`ledger stage deadline exceeded: ${name}`); this.abort('stage-deadline'); }, this.stageMs);
    this.stageTimer.unref?.();
  }

  async stage({ name, phase, status = 'completed', detail, error }) {
    if (this.closed) return;
    if (phase === 'start') {
      await this.call(`${encodeURIComponent(this.jobId)}/stage/start`, { ...this.lease, name, detail: detail ?? null });
      this.armStage(name);
    } else {
      clearTimeout(this.stageTimer);
      await this.call(`${encodeURIComponent(this.jobId)}/stage/finish`, {
        ...this.lease, name, state: status, detail: detail ?? null, error: error ?? null,
      });
    }
  }

  async startStage(name, detail) {
    await this.call(`${encodeURIComponent(this.jobId)}/stage/start`, { ...this.lease, name, detail: detail ?? null });
  }

  async finishStage(name, status = 'completed', error, detail) {
    await this.call(`${encodeURIComponent(this.jobId)}/stage/finish`, { ...this.lease, name, state: status, error: error ?? null, detail: detail ?? null });
  }

  async checkpoint(ref, hash, stage = null) {
    await this.call(`${encodeURIComponent(this.jobId)}/checkpoint`, { ...this.lease, ref, hash: hash ?? null, stage });
  }

  async publicationBegin(key) {
    const data = await this.call(`${encodeURIComponent(this.jobId)}/publication`, { ...this.lease, phase: 'begin', key });
    this.publication = { key, state: 'publishing' };
    return data;
  }

  async publicationFinish(state, url) {
    await this.call(`${encodeURIComponent(this.jobId)}/publication`, { ...this.lease, phase: 'finish', state, url: url ?? null });
    this.publication = { ...(this.publication ?? {}), state, url: url ?? null };
  }

  record(run) { this.run = run; }

  usage() {
    const entries = this.run?.cost?.entries ?? [];
    return {
      modelCalls: entries.length,
      inputTokens: entries.reduce((sum, e) => sum + (Number(e.inputTokens) || 0), 0),
      outputTokens: entries.reduce((sum, e) => sum + (Number(e.outputTokens) || 0), 0),
      usd: Number(this.run?.cost?.usd) || 0,
    };
  }

  async close(run) {
    if (this.closed) return;
    const result = run ?? this.run;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.stageTimer);
    clearTimeout(this.articleTimer);
    if (!this.lease) return;
    const reason = result?.reason ?? '';
    let state;
    if (this.abortReason === 'cancelled') state = 'cancelled';
    else if (this.abortReason === 'paused') state = 'paused';
    else if (this.publication?.state === 'rejected') state = 'failed';
    else if (['published', 'updated'].includes(result?.state)) state = 'completed';
    else if (result?.state === 'approved-by-policy') state = 'completed';
    else if (['blocked', 'verified', 'draft', 'requires-update'].includes(result?.state)) state = 'blocked';
    else state = 'failed';
    const error = state === 'completed' ? undefined : {
      classification: this.publication?.state === 'rejected' ? 'publication' : classify(reason, this.abortReason),
      message: (this.publication?.state === 'rejected' ? reason || 'publication rejected' : reason || this.abortReason || `job ended ${result?.state ?? 'unknown'}`).slice(0, 500),
    };
    try {
      await this.call(`${encodeURIComponent(this.jobId)}/finish`, { ...this.lease, state, error: error ?? null, usage: this.usage() });
    } catch (closeError) {
      this.logger.warn?.(`ledger finish failed for ${this.slug}: ${closeError.message}`);
    }
  }

  async cancelStages(reason = 'cancelled') {
    // The server reconciles every still-running stage when the job finishes; no extra call is required.
    this.abort(reason);
  }
}

export function createLedgerLifecycle(options) {
  const sessions = new Map();
  const lifecycle = {
    async start(topic) {
      const session = new LedgerSession(options, topic);
      await session.open();
      sessions.set(topic.slug, session);
      return session;
    },
    async finish(session, run) {
      if (session && typeof session.record === 'function') session.record(run);
    },
  };
  return {
    lifecycle,
    session: (slug) => sessions.get(slug),
    async close(slug, run) {
      const session = sessions.get(slug);
      if (!session) return;
      await session.close(run);
      sessions.delete(slug);
    },
    async abortAll(reason = 'cancelled') {
      for (const session of sessions.values()) await session.cancelStages(reason);
    },
    get size() { return sessions.size; },
  };
}

export function ledgerEnabled(report) {
  return Boolean(report) && process.env.EDITORIAL_JOB_LEDGER !== 'off';
}

export function ledgerOptions(report) {
  const positive = (name, fallback) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    api: report,
    key: process.env.ANALYTICS_ADMIN_KEY || '',
    stageMs: positive('EDITORIAL_STAGE_DEADLINE_MS', 10 * 60_000),
    articleMs: positive('EDITORIAL_ARTICLE_DEADLINE_MS', 30 * 60_000),
    heartbeatMs: positive('EDITORIAL_JOB_HEARTBEAT_MS', 20_000),
    leaseMs: positive('EDITORIAL_JOB_LEASE_MS', 90_000),
    maxAttempts: Math.min(Math.max(Number(process.env.EDITORIAL_JOB_MAX_ATTEMPTS) || 3, 1), 10),
  };
}
