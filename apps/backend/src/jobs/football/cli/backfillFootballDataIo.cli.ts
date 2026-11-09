#!/usr/bin/env node
/**
 * M07 one-off: backfill footballdata.io season results (with statistics) that the
 * community provider is missing, then refresh the provider tables.
 * Run once after deploy: `npm run job:football:backfill -- 2026-08-01 2026-11-09`.
 * Spends at most FOOTBALLDATA_IO_BACKFILL_BUDGET requests (durable, fail-closed).
 */

import '@/config/bootstrap';

import { connectMongoDB, disconnectMongoDB } from '@/config/mongodb';
import { createFootballIndexes } from '@/infrastructure/sports/persistence/createFootballIndexes';
import {
  backfillFootballDataIoResults,
  backfillFootballDataOrgSeasons,
  refreshFootballDataIoTables,
  refreshFootballDataOrgTables,
  refreshStandingsTables,
} from '../footballIngestionLoop';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<void> {
  const [from, to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
  if (!from || !DAY.test(from) || !DAY.test(to)) {
    console.error('Uso: backfillFootballDataIo.cli <desde YYYY-MM-DD> [hasta YYYY-MM-DD]');
    process.exit(2);
  }
  try {
    await connectMongoDB();
    await createFootballIndexes();
    const result = await backfillFootballDataIoResults(from, to);
    if (!result) throw new Error('FOOTBALLDATA_IO_API_KEY no configurada o MongoDB no disponible');
    console.log(JSON.stringify({ from, to, ...result }));
    // football-data.org: whole current season per competition (≈10 requests, spaced 6.5 s).
    const fdorg = await backfillFootballDataOrgSeasons();
    console.log(JSON.stringify({ footballDataOrg: fdorg }));
    if (fdorg?.failed.length) console.error(`football-data.org incompleto: ${fdorg.failed.join(', ')} (vuelve a ejecutar la carga)`);
    await refreshStandingsTables();
    await refreshFootballDataIoTables();
    await refreshFootballDataOrgTables();
    await disconnectMongoDB();
    // 3 = something is missing and must be re-run; never report success on a partial load.
    process.exit(result.complete && !fdorg?.failed.length ? 0 : 3);
  } catch (error) {
    console.error('Error en el backfill de footballdata.io:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
