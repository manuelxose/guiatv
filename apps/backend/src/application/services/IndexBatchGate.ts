/**
 * M12-G1: the index-level gate for programmatic URLs (docs/roadmap/M12-G0-READINESS-20261103.md G-01, G-02, G-05).
 * A URL is indexable through this gate only if it is on a signed allowlist AND the gate is enabled AND not killed.
 * Everything else answers `noindex`; the family-agnostic sitemap child lists exactly the allowlisted paths.
 *
 *   INDEX_BATCH_ENABLED=true             master switch (default off: nothing is indexable through the gate)
 *   INDEX_BATCH_KILL=true | INDEX_BATCH_KILL_FILE=<path that exists>   instant stop, no restart (re-read every 5 s)
 *   INDEX_BATCH_ALLOWLIST_FILE=<path>    {version:1,batchId,policyVersion,entries:[{path,approvedBy,approvedAt,evidenceHash}],signature}
 *   INDEX_BATCH_SIGNING_KEY=<secret>     HMAC-SHA256 over the document without `signature`; absent or wrong = nothing indexable
 *   INDEX_BATCH_LEDGER_FILE=<path>       append-only JSONL of every state change (active / killed / invalid) and its signature
 *
 * Bounds enforced here, on the server: BATCH_HARD_CAP entries per batchId and CUMULATIVE_HARD_CAP entries in the file.
 */
import fs from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@/shared/utils/logger';

export const BATCH_HARD_CAP = 25;
export const CUMULATIVE_HARD_CAP = 100;
const RECHECK_MS = 5_000;
const PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const HASH = /^[a-f0-9]{16,64}$/;

export interface BatchEntry { path: string; approvedBy: string; approvedAt: string; evidenceHash: string; batchId: string; policyVersion: string }
export type GateState = 'disabled' | 'killed' | 'invalid' | 'active';
export interface GateDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  read?: (file: string) => string | null;
  exists?: (file: string) => boolean;
  append?: (file: string, line: string) => void;
}

const defaultRead = (file: string) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const defaultAppend = (file: string, line: string) => fs.appendFileSync(file, `${line}\n`);

export const signBatchDocument = (doc: { version: number; batchId: string; policyVersion: string; entries: unknown[] }, key: string): string =>
  createHmac('sha256', key).update(JSON.stringify({ version: doc.version, batchId: doc.batchId, policyVersion: doc.policyVersion, entries: doc.entries })).digest('hex');

/** Throws on anything that is not a clean, bounded, signed list of named approvals. Multi-batch files use `batches`. */
export function parseBatchAllowlist(text: string, key: string): BatchEntry[] {
  if (!key) throw new Error('INDEX_BATCH_SIGNING_KEY is not set');
  const root = JSON.parse(text) as { version?: number; batches?: unknown };
  if (root.version !== 1 || !Array.isArray(root.batches)) throw new Error('allowlist must be {version:1, batches:[…]}');
  const out: BatchEntry[] = [];
  const seenBatch = new Set<string>();
  const paths = new Set<string>();
  for (const b of root.batches as Array<Record<string, any>>) {
    const { batchId, policyVersion, entries, signature } = b;
    if (typeof batchId !== 'string' || !batchId || typeof policyVersion !== 'string' || !policyVersion || !Array.isArray(entries) || typeof signature !== 'string') throw new Error('invalid batch');
    if (seenBatch.has(batchId)) throw new Error(`duplicate batch ${batchId}`);
    seenBatch.add(batchId);
    if (entries.length > BATCH_HARD_CAP) throw new Error(`batch ${batchId} has ${entries.length} entries, ceiling is ${BATCH_HARD_CAP}`);
    const expected = Buffer.from(signBatchDocument({ version: 1, batchId, policyVersion, entries }, key), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error(`batch ${batchId} signature invalid`);
    for (const e of entries as Array<Record<string, string>>) {
      if (typeof e.path !== 'string' || !PATH.test(e.path)) throw new Error('invalid entry path');
      if (typeof e.approvedBy !== 'string' || !e.approvedBy.trim() || Number.isNaN(Date.parse(e.approvedAt))) throw new Error(`entry ${e.path} lacks approver or date`);
      if (typeof e.evidenceHash !== 'string' || !HASH.test(e.evidenceHash)) throw new Error(`entry ${e.path} lacks evidenceHash`);
      if (paths.has(e.path)) throw new Error(`duplicate path ${e.path}`);
      paths.add(e.path);
      out.push({ path: e.path, approvedBy: e.approvedBy.trim(), approvedAt: e.approvedAt, evidenceHash: e.evidenceHash, batchId, policyVersion });
    }
    if (out.length > CUMULATIVE_HARD_CAP) throw new Error(`allowlist exceeds the cumulative ceiling of ${CUMULATIVE_HARD_CAP}`);
  }
  return out;
}

const logger = new Logger('IndexBatchGate');

export class IndexBatchGate {
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly read: NonNullable<GateDeps['read']>;
  private readonly exists: NonNullable<GateDeps['exists']>;
  private readonly append: NonNullable<GateDeps['append']>;
  private snap: { at: number; state: GateState; entries: Map<string, BatchEntry>; reason?: string } | null = null;
  private lastLogged: string | null = null;

  constructor(deps: GateDeps = {}) {
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? Date.now;
    this.read = deps.read ?? defaultRead;
    this.exists = deps.exists ?? ((f) => defaultRead(f) !== null);
    this.append = deps.append ?? defaultAppend;
  }

  private compute(): NonNullable<IndexBatchGate['snap']> {
    const at = this.now();
    const none = new Map<string, BatchEntry>();
    if (this.env.INDEX_BATCH_ENABLED !== 'true') return { at, state: 'disabled', entries: none };
    const killFile = this.env.INDEX_BATCH_KILL_FILE;
    if (this.env.INDEX_BATCH_KILL === 'true' || (killFile && this.exists(killFile))) return { at, state: 'killed', entries: none };
    const file = this.env.INDEX_BATCH_ALLOWLIST_FILE;
    const text = file ? this.read(file) : null;
    if (text === null) return { at, state: 'invalid', entries: none, reason: 'allowlist unreadable' };
    try {
      const entries = parseBatchAllowlist(text, this.env.INDEX_BATCH_SIGNING_KEY ?? '');
      return { at, state: 'active', entries: new Map(entries.map((e) => [e.path, e])) };
    } catch (err) {
      return { at, state: 'invalid', entries: none, reason: (err as Error).message };
    }
  }

  private snapshot() {
    if (this.snap && this.now() - this.snap.at < RECHECK_MS) return this.snap;
    this.snap = this.compute();
    const fingerprint = `${this.snap.state}:${[...this.snap.entries.keys()].sort().join(',')}`;
    if (fingerprint !== this.lastLogged) {
      this.lastLogged = fingerprint;
      const line = JSON.stringify({ at: new Date(this.now()).toISOString(), event: this.snap.state, paths: this.snap.entries.size, reason: this.snap.reason ?? null });
      logger.warn(`index batch gate: ${line}`);
      const ledger = this.env.INDEX_BATCH_LEDGER_FILE;
      if (ledger) { try { this.append(ledger, line); } catch (err) { logger.error('index batch ledger write failed', { error: err }); } }
    }
    return this.snap;
  }

  state(): GateState { return this.snapshot().state; }

  /** True only for an allowlisted path while the gate is active. Everything else must be served `noindex, follow`. */
  isIndexable(path: string): boolean {
    return this.snapshot().entries.has(path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);
  }

  /** The exact set the sitemap child lists; empty unless active. */
  paths(): string[] { return [...this.snapshot().entries.keys()].sort(); }

  entry(path: string): BatchEntry | undefined { return this.snapshot().entries.get(path); }

  /** Changes whenever the visible set may have changed: part of the sitemap cache key, so a kill rebuilds at once. */
  partition(): string {
    const s = this.snapshot();
    return `batch:${s.state}:${createHash('sha256').update([...s.entries.values()].map((e) => e.path + e.evidenceHash).sort().join('|')).digest('hex').slice(0, 12)}`;
  }
}

let shared: IndexBatchGate | null = null;
export const indexBatchGate = (): IndexBatchGate => (shared ??= new IndexBatchGate());
