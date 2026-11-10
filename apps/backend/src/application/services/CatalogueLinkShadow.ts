/**
 * M03-L1: shadow evaluation of the strict EPG→catalogue linker at read-model build time.
 * `EPG_CATALOGUE_LINK_MODE` = off (default; anything unknown also means off, with one warning) | shadow.
 * Shadow only reads (batched, indexed `{tmdbType, tmdbId}` lookups, capped) and counts: nothing is written, the programmes
 * and the built airings are untouched, and a failure here never fails the build. Counters hold reason codes only (a fixed set).
 */
import { performance } from 'node:perf_hooks';
import { MediaCatalogModel } from '@/infrastructure/database/models/MediaCatalogEntry.model';
import { buildLinkContext, linkCatalogueRow, LINK_REASONS, LinkProgram, LinkRow } from '@/domain/services/catalogueLinker';
import { logger } from '@/shared/utils/logger';

export type CatalogueLinkMode = 'off' | 'shadow';

const log = logger.child('CatalogueLinkShadow');
const BATCH = 500;
const MAX_TMDB_IDS = 5_000;
const MAX_SAMPLES = 200;
const READ_MAX_MS = 5_000;
const RUN_MAX_MS = 10_000;

let warnedValue: string | undefined;

export function resolveCatalogueLinkMode(env: NodeJS.ProcessEnv = process.env): CatalogueLinkMode {
  const raw = env.EPG_CATALOGUE_LINK_MODE?.trim().toLowerCase();
  if (!raw || raw === 'off') return 'off';
  if (raw === 'shadow') return 'shadow';
  if (warnedValue !== raw) {
    warnedValue = raw;
    log.warn('Unknown EPG_CATALOGUE_LINK_MODE, falling back to off', { value: raw.slice(0, 32) });
  }
  return 'off';
}

interface Counts {
  evaluated: number;
  alreadyLinked: number;
  linkable: number;
  ambiguous: number;
  rejected: Record<string, number>;
}
const emptyCounts = (): Counts => ({
  evaluated: 0,
  alreadyLinked: 0,
  linkable: 0,
  ambiguous: 0,
  rejected: Object.fromEntries(LINK_REASONS.filter((r) => r !== 'strict_match' && r !== 'existing_media_id_valid').map((r) => [r, 0])),
});

let totals = emptyCounts();
let lastRun: (Counts & { tmdbIds: number; catalogueRows: number; queries: number; truncated: boolean; ms: number }) | null = null;
let runs = 0;
let errors = 0;
const durations: number[] = [];

const percentile = (sorted: number[], q: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 100) / 100 : 0);

export function catalogueLinkSnapshot() {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    mode: resolveCatalogueLinkMode(),
    runs,
    errors,
    totals,
    lastRun,
    latencyMs: { samples: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) },
    mediaIdGuard: guard,
  };
}

export function resetCatalogueLinkStats(): void {
  totals = emptyCounts();
  lastRun = null;
  runs = 0;
  errors = 0;
  durations.length = 0;
  guard = { runs: 0, errors: 0, checked: 0, kept: 0, dropped: {} };
}

export type CatalogueRowReader = (tmdbIds: number[]) => Promise<LinkRow[]>;

export const readCatalogueRows: CatalogueRowReader = async (tmdbIds) => {
  const docs = await MediaCatalogModel.find(
    { tmdbType: { $in: ['movie', 'tv'] }, tmdbId: { $in: tmdbIds } },
    { tmdbId: 1, tmdbType: 1, title: 1, originalTitle: 1, normalizedTitle: 1, backdropPath: 1 }
  )
    .maxTimeMS(READ_MAX_MS)
    .lean()
    .exec();
  return (docs as any[]).map((d) => ({ id: String(d._id), tmdbId: d.tmdbId, tmdbType: d.tmdbType, title: d.title, originalTitle: d.originalTitle, normalizedTitle: d.normalizedTitle, backdropPath: d.backdropPath }));
};

async function readInBatches(ids: number[], reader: CatalogueRowReader, started: number): Promise<{ rows: LinkRow[]; queries: number }> {
  const rows: LinkRow[] = [];
  let queries = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    if (performance.now() - started > RUN_MAX_MS) throw new Error('catalogue read deadline exceeded');
    rows.push(...(await reader(ids.slice(i, i + BATCH))));
    queries += 1;
  }
  return { rows, queries };
}

/** Catalogue rows for these TMDB ids, batched and deadline-bounded like the shadow read. Throws on read failure. */
export async function readCatalogueRowsFor(tmdbIds: number[], reader: CatalogueRowReader = readCatalogueRows): Promise<LinkRow[]> {
  return (await readInBatches([...new Set(tmdbIds)], reader, performance.now())).rows;
}

let guard = { runs: 0, errors: 0, checked: 0, kept: 0, dropped: {} as Record<string, number> };

/**
 * M03-L2: always on. Before a read model is stored, every built programme that carries a `mediaId` keeps it only when the
 * linker accepts it as already linked: the row exists, is valid, carries the programme's TMDB id and, for Cine/Series, the
 * matching kind. Anything else (a Series airing on a movie row, a dangling or foreign row, no TMDB id) loses the `mediaId`
 * in the built airing only — the stored programme is never written. A read failure keeps the airings as they are (no worse
 * than before) and is counted; the read-time joiner still refuses type mismatches.
 */
export async function guardExistingMediaIds(programs: LinkProgram[], options: { reader?: CatalogueRowReader } = {}): Promise<void> {
  const linked = programs.filter((p) => p.mediaId);
  guard.runs += 1;
  if (!linked.length) return;
  let rows: LinkRow[];
  try {
    rows = await readCatalogueRowsFor(linked.map((p) => p.tmdbId).filter((v): v is number => Number.isInteger(v) && (v as number) > 0), options.reader);
  } catch (error) {
    guard.errors += 1;
    log.warn('Existing mediaId guard could not read the catalogue; airings left unchanged', { error: (error as Error).message });
    return;
  }
  const ctx = buildLinkContext(linked, rows);
  for (const program of linked) {
    guard.checked += 1;
    const d = linkCatalogueRow(program, ctx);
    if (d.decision === 'ALREADY_LINKED') guard.kept += 1;
    else {
      guard.dropped[d.reason] = (guard.dropped[d.reason] ?? 0) + 1;
      delete program.mediaId;
    }
  }
}

/** No-op in `off` mode. In `shadow`, evaluates `programs` and records aggregate counters; never throws and never mutates. */
export async function runCatalogueLinkShadow(
  programs: readonly LinkProgram[],
  options: { mode?: CatalogueLinkMode; reader?: CatalogueRowReader } = {}
): Promise<void> {
  if ((options.mode ?? resolveCatalogueLinkMode()) !== 'shadow') return;
  const started = performance.now();
  try {
    const ids = [...new Set(programs.map((p) => p.tmdbId).filter((v): v is number => Number.isInteger(v) && (v as number) > 0))];
    const truncated = ids.length > MAX_TMDB_IDS;
    const wanted = truncated ? ids.slice(0, MAX_TMDB_IDS) : ids;
    const reader = options.reader ?? readCatalogueRows;
    const { rows, queries } = await readInBatches(wanted, reader, started);
    // ponytail: programmes whose TMDB id was cut by MAX_TMDB_IDS are skipped, not rejected; raise the cap or chunk builds if `truncated` is ever true.
    const covered = truncated ? new Set(wanted) : null;
    const scope = covered ? programs.filter((p) => !p.tmdbId || covered.has(p.tmdbId)) : programs;
    const ctx = buildLinkContext(scope, rows);
    const run = emptyCounts();
    for (const program of scope) {
      const d = linkCatalogueRow(program, ctx);
      run.evaluated += 1;
      if (d.decision === 'ALREADY_LINKED') run.alreadyLinked += 1;
      else if (d.decision === 'LINKABLE') run.linkable += 1;
      else {
        if (d.decision === 'AMBIGUOUS') run.ambiguous += 1;
        run.rejected[d.reason] += 1;
      }
    }
    const ms = Math.round((performance.now() - started) * 100) / 100;
    totals.evaluated += run.evaluated;
    totals.alreadyLinked += run.alreadyLinked;
    totals.linkable += run.linkable;
    totals.ambiguous += run.ambiguous;
    for (const k of Object.keys(run.rejected)) totals.rejected[k] += run.rejected[k];
    lastRun = { ...run, tmdbIds: wanted.length, catalogueRows: rows.length, queries, truncated, ms };
    runs += 1;
    durations.push(ms);
    if (durations.length > MAX_SAMPLES) durations.shift();
  } catch (error) {
    errors += 1;
    log.warn('Catalogue link shadow evaluation failed', { error: (error as Error).message });
  }
}
