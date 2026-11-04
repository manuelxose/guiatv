/**
 * M12-G3B: the compact, factual history record of an ANNOUNCED broadcast (never proof that it aired).
 * Pure: maps one tv_read_airings row to an observation or a named rejection. Identity is
 * (channel, start) so a title/end correction is a revision of the same observation, not a new one.
 */
import { createHash } from 'node:crypto';
import { ENTITY_ID_PATTERN } from './contentIdentity';

export const OBSERVATION_VERSION = 1;

export interface BroadcastObservation {
  _id: string;
  channelId: string;
  startUtc: Date;
  endUtc: Date;
  madridDate: string;
  title: string;
  titleKey: string;
  /** Present only when the read model already carries a verified entity; never derived from the title. */
  workRef?: string;
  sources: string[];
  contentHash: string;
  state: 'scheduled';
  rev: number;
  seenCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  prev?: { title: string; endUtc: Date; contentHash: string };
}

export type RejectReason = 'no-channel' | 'invalid-time' | 'no-title' | 'no-source';

const madridFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Madrid-local calendar date (YYYY-MM-DD); independent of the process TZ, correct across DST and midnight. */
export const madridDate = (d: Date): string => madridFmt.format(d);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Archival identity contract: (channel, start instant in UTC ms). Local display time never enters the key. */
export const observationId = (channelId: string, startUtc: Date): string => sha(`${channelId}|${startUtc.getTime()}`).slice(0, 24);
const normSource = (s: unknown): string => {
  const v = String(s ?? '').trim();
  try { return new URL(v).host.toLowerCase(); } catch { return v.toLowerCase(); }
};

/** `airing` is a tv_read_airings document (lean). */
export function toObservation(airing: any, now: Date): { ok: true; obs: BroadcastObservation } | { ok: false; reason: RejectReason } {
  const channelId = String(airing?.channel?.id ?? '').trim();
  if (!channelId) return { ok: false, reason: 'no-channel' };
  const startUtc = new Date(airing?.airing?.start);
  const endUtc = new Date(airing?.airing?.end);
  if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime()) || endUtc <= startUtc) return { ok: false, reason: 'invalid-time' };
  const title = String(airing?.program?.title ?? '').trim();
  if (!title) return { ok: false, reason: 'no-title' };
  const sources = [...new Set(((airing?.sourceProvenance?.schedule ?? []) as unknown[]).map(normSource).filter(Boolean))].sort();
  if (!sources.length) return { ok: false, reason: 'no-source' };
  const entityId = airing?.program?.entityId;
  const titleKey = String(airing?.program?.normalizedTitle ?? '').trim() || title.toLowerCase();
  const contentHash = sha(JSON.stringify([title, endUtc.getTime(), sources, entityId ?? null])).slice(0, 32);
  return {
    ok: true,
    obs: {
      _id: observationId(channelId, startUtc),
      channelId, startUtc, endUtc, madridDate: madridDate(startUtc), title, titleKey,
      ...(typeof entityId === 'string' && ENTITY_ID_PATTERN.test(entityId) ? { workRef: entityId } : {}),
      sources, contentHash, state: 'scheduled', rev: 1, seenCount: 1, firstSeenAt: now, lastSeenAt: now,
    },
  };
}

/** What to do with an observation given what is stored: insert, revise (content changed), or leave alone. */
export function plan(incoming: BroadcastObservation, stored?: { rev: number; contentHash: string; title: string; endUtc: Date }): 'insert' | 'revise' | 'unchanged' {
  if (!stored) return 'insert';
  return stored.contentHash === incoming.contentHash ? 'unchanged' : 'revise';
}
