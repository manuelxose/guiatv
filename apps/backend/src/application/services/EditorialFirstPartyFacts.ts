import { TVReadAiringModel } from '../../infrastructure/database/models/TVReadAiring.model';
import { channelPagePath, normalizeTvToken } from '../../shared/utils/tvMetadata';

/**
 * M11-G: GuíaTV's own data as citable facts for the editorial pipeline. Each fact is one human-readable statement with
 * its provenance (GuíaTV is the publisher; the upstream feeds stay named), validity and freshness. Only eligible facts
 * are printed in the text form the research agent quotes from; the rest are listed with the reason they are withheld.
 *
 * Deliberately narrow: channel line-ups (curated registry) and broadcast slots (what airs when, where). EPG film
 * metadata (year, director, cast) is never turned into a fact: it is known to be wrong for some films (M11-E).
 */

export const FACTS_TIMEZONE = 'Europe/Madrid';
/** The read model is rebuilt hourly; a slot not refreshed for this long may have been rescheduled upstream. */
export const SCHEDULE_STALE_MS = 6 * 3600e3;
const SITE = 'https://guiaprogramaciontv.com';
const GROUP_LABEL: Record<string, string> = { tdt: 'la TDT nacional', autonomico: 'las televisiones autonómicas' };

export type FactFreshness = 'fresh' | 'stale' | 'expired';
export interface EditorialFact {
  id: string;
  entityType: 'channel-lineup' | 'channel' | 'airing';
  entityId: string;
  canonicalUrl: string | null;
  statement: string;
  provenance: { publisher: 'GuíaTV'; dataset: string; upstream: string[] };
  recordedAt: string | null;
  validFrom?: string;
  validUntil?: string;
  timezone?: string;
  /** registry = curated channel record; single/multi-upstream = how many feeds carried the slot. */
  verification: 'registry' | 'heuristic' | 'single-upstream' | 'multi-upstream';
  freshness: FactFreshness;
  eligible: boolean;
  reason?: string;
  /** Only entities with a verified identity (an entityId on the airing); never guessed from a title. */
  relatedEntities: Array<{ type: string; id: string; url: string }>;
}

type Row = { channel?: Record<string, any>; program?: Record<string, any>; airing?: Record<string, any>; sourceProvenance?: Record<string, any>; trustDecision?: Record<string, any>; updatedAt?: Date | string };

const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: FACTS_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeZone: FACTS_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: FACTS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Local calendar day in Spain (peninsular time), DST included. */
export const madridDay = (d: Date | string) => ymdFmt.format(new Date(d));
const iso = (d: unknown) => { const t = d ? new Date(d as string).getTime() : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const channelUrl = (c: Record<string, any>) => { const slug = c.normalizedName || normalizeTvToken(c.name); return slug ? `${SITE}${channelPagePath(slug)}` : null; };
const upstreamOf = (rows: Row[]) => [...new Set(rows.flatMap((r) => r.sourceProvenance?.schedule ?? []).filter((u): u is string => typeof u === 'string'))].sort();

/** One line-up fact per group plus one fact per channel. Only registry channels are eligible. */
export function buildChannelFacts(rows: Row[], group: string): EditorialFact[] {
  const byId = new Map<string, Row[]>();
  for (const r of rows) if (r.channel?.id && r.channel.group === group) byId.set(r.channel.id, [...(byId.get(r.channel.id) ?? []), r]);
  const channels = [...byId].map(([id, list]): EditorialFact => {
    const c = list[0].channel!;
    const curated = c.provenance?.classification === 'registry';
    const url = channelUrl(c);
    return {
      id: `channel:${id}`, entityType: 'channel', entityId: id, canonicalUrl: url,
      statement: `${c.name} es uno de los canales de ${GROUP_LABEL[group] ?? group} cuya programación publica GuíaTV en ${url}`,
      provenance: { publisher: 'GuíaTV', dataset: 'catálogo de canales de GuíaTV', upstream: upstreamOf(list) },
      recordedAt: iso(list.map((r) => iso(r.updatedAt)).sort().pop()), verification: curated ? 'registry' : 'heuristic', freshness: 'fresh',
      eligible: curated && Boolean(url), ...(curated ? {} : { reason: 'canal clasificado por heurística, no por el registro curado' }), relatedEntities: [],
    };
  }).sort((a, b) => a.statement.localeCompare(b.statement, 'es'));
  const eligible = channels.filter((f) => f.eligible);
  if (!eligible.length) return channels;
  const names = eligible.map((f) => byId.get(f.entityId)![0].channel!.name);
  return [{
    id: `lineup:${group}`, entityType: 'channel-lineup', entityId: group, canonicalUrl: `${SITE}/canales`,
    statement: `GuíaTV publica la programación de ${eligible.length} canales de ${GROUP_LABEL[group] ?? group}: ${names.join(', ')}`,
    provenance: { publisher: 'GuíaTV', dataset: 'catálogo de canales de GuíaTV', upstream: upstreamOf(rows) },
    recordedAt: eligible.map((f) => f.recordedAt).filter(Boolean).sort().pop() ?? null, verification: 'registry', freshness: 'fresh', eligible: true, relatedEntities: [],
  }, ...channels];
}

/**
 * Broadcast slots of one channel on one local day. A slot is withheld when it is over, not refreshed recently, below
 * high confidence, suppressed for consumers, has an unresolved title, or overlaps a different programme on the same
 * channel (contradictory feeds): an uncertain slot is never stated as a fact.
 */
export function buildScheduleFacts(rows: Row[], day: string, now: Date): EditorialFact[] {
  const slots = rows.filter((r) => r.airing?.start && iso(r.airing.start) && madridDay(r.airing.start) === day)
    .sort((a, b) => Date.parse(a.airing!.start) - Date.parse(b.airing!.start));
  const titleKey = (r: Row) => String(r.program?.normalizedTitle ?? r.program?.title ?? '').trim().toLowerCase();
  const span = (r: Row) => [Date.parse(r.airing!.start), Date.parse(r.airing!.end ?? r.airing!.start) || Date.parse(r.airing!.start)];
  return slots.map((r): EditorialFact => {
    const [start, end] = span(r);
    const conflict = slots.some((o) => o !== r && o.channel?.id === r.channel?.id && titleKey(o) !== titleKey(r)
      && (Date.parse(o.airing!.start) === start || (span(o)[0] < end && start < span(o)[1])));
    const upstream = upstreamOf([r]);
    const updated = Date.parse(String(r.updatedAt ?? ''));
    const freshness: FactFreshness = (end > start ? end : start) <= now.getTime() ? 'expired' : !Number.isFinite(updated) || now.getTime() - updated > SCHEDULE_STALE_MS ? 'stale' : 'fresh';
    const reason = freshness !== 'fresh' ? (freshness === 'expired' ? 'la emisión ya terminó' : 'dato sin refrescar en las últimas horas')
      : r.trustDecision?.consumerSuppressed ? 'emisión oculta al público por calidad del dato'
        : r.trustDecision?.confidence !== 'high' ? `confianza ${r.trustDecision?.confidence ?? 'desconocida'}`
          : r.program?.isResolvedTitle === false ? 'título sin resolver'
            : conflict ? 'otra emisión del mismo canal se solapa con un título distinto'
              : !upstream.length ? 'sin fuente de origen registrada' : undefined;
    const title = String(r.program?.title ?? '').trim();
    const hours = end > start ? `de ${timeFmt.format(start)} a ${timeFmt.format(end)}` : `a las ${timeFmt.format(start)}`;
    const entity = r.program?.entityId && r.program?.canonicalPath ? [{ type: 'content-entity', id: String(r.program.entityId), url: `${SITE}${r.program.canonicalPath}` }] : [];
    return {
      id: `airing:${r.airing!.id ?? `${r.channel?.id}:${start}`}`, entityType: 'airing' as const, entityId: String(r.airing!.id ?? ''), canonicalUrl: r.channel ? channelUrl(r.channel) : null,
      statement: `${r.channel?.name} emite «${title}» el ${dayFmt.format(start)} ${hours} (hora peninsular)`,
      provenance: { publisher: 'GuíaTV' as const, dataset: 'guía de programación de GuíaTV', upstream },
      recordedAt: iso(r.updatedAt), validFrom: new Date(start).toISOString(), validUntil: new Date(end).toISOString(), timezone: FACTS_TIMEZONE,
      verification: upstream.length > 1 ? 'multi-upstream' as const : 'single-upstream' as const, freshness,
      eligible: !reason && Boolean(title), ...(reason || !title ? { reason: reason ?? 'sin título' } : {}), relatedEntities: entity,
    };
  });
}

export type FactsQuery = { kind: 'channels'; group: 'tdt' | 'autonomico' } | { kind: 'schedule'; channel: string; day: string };

/** Strict parsing at the public boundary: unknown kinds, groups, channel ids or days outside the EPG window are refused. */
export function parseFactsQuery(q: Record<string, unknown>, now = new Date()): FactsQuery | string {
  if (q.kind === 'channels') return q.group === 'tdt' || q.group === 'autonomico' ? { kind: 'channels', group: q.group } : 'group debe ser tdt o autonomico';
  if (q.kind !== 'schedule') return 'kind debe ser channels o schedule';
  if (typeof q.channel !== 'string' || !/^[a-z0-9_-]{1,60}$/.test(q.channel)) return 'channel no válido';
  const today = madridDay(now);
  const day = typeof q.date === 'string' ? q.date : today;
  const offset = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(offset) || offset < 0 || offset > 3) return 'date debe ser hoy o uno de los tres días siguientes (AAAA-MM-DD)';
  return { kind: 'schedule', channel: q.channel, day };
}

const PROJECTION = { channel: 1, program: 1, airing: 1, sourceProvenance: 1, trustDecision: 1, updatedAt: 1 } as const;
const compact = (ymd: string, add = 0) => new Date(Date.parse(`${ymd}T00:00:00Z`) + add * 864e5).toISOString().slice(0, 10).replace(/-/g, '');

export async function loadEditorialFacts(query: FactsQuery, now = new Date()): Promise<{ query: FactsQuery; generatedAt: string; facts: EditorialFact[] }> {
  const today = madridDay(now);
  const facts = query.kind === 'channels'
    ? buildChannelFacts(await TVReadAiringModel.find({ date: compact(today), 'channel.group': query.group }, PROJECTION).lean().exec() as Row[], query.group)
    // Rows are stored per UTC-ish feed day: read the neighbours and keep the slots whose local day matches.
    : buildScheduleFacts(await TVReadAiringModel.find({ 'channel.id': query.channel, date: { $in: [compact(query.day, -1), compact(query.day), compact(query.day, 1)] } }, PROJECTION).lean().exec() as Row[], query.day, now);
  return { query, generatedAt: now.toISOString(), facts };
}

/** Text the research agent reads and quotes from: provenance header, then one eligible statement per line. */
export function factsAsText(result: { query: FactsQuery; generatedAt: string; facts: EditorialFact[] }): string {
  const ok = result.facts.filter((f) => f.eligible);
  const upstream = [...new Set(ok.flatMap((f) => f.provenance.upstream))].map((u) => new URL(u).hostname);
  return [
    `Datos propios de GuíaTV (${result.query.kind === 'channels' ? 'catálogo de canales' : 'guía de programación'}), generados el ${result.generatedAt}. Horas en hora peninsular española (${FACTS_TIMEZONE}).`,
    `Origen de la programación: guías XMLTV de ${upstream.join(', ') || 'ninguna'}; GuíaTV las agrega, no las produce la cadena. Solo se listan datos vigentes, refrescados y sin contradicción.`,
    '',
    ...(ok.length ? ok.map((f) => `${f.statement}.`) : ['(ningún dato vigente)']),
    '',
  ].join('\n');
}
