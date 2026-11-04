#!/usr/bin/env node
import '../../config/bootstrap';

import { archiveDay, isDayArchived, type ArchiveResult } from '../../application/services/BroadcastObservationArchiver';

/**
 * M12-G3B: archives closed Madrid days into tv_broadcast_observations.
 *   node dist/jobs/cli/archiveBroadcastHistory.cli.js [YYYYMMDD ...]   (default: the last HISTORY_CAPTURE_CATCHUP_DAYS closed days, 3)
 * Default catch-up skips days that already have observations (the first snapshot is kept; HISTORY_CAPTURE_RECAPTURE=true or naming the day re-reads it).
 * Exits 0 without touching the database unless HISTORY_CAPTURE_ENABLED=true. Safe to re-run (idempotent).
 */
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The last `count` Madrid calendar days before today, stepped by date (a 23h/25h DST day must not skip or repeat one). */
export function closedDays(now: Date, count: number): string[] {
  const today = fmt.format(now);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (i + 1));
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }).reverse();
}

/** One scheduled run: the catch-up days (or the named ones), skipping days already archived unless forced. `now` is injectable so a timer run can be simulated. */
export async function runCatchup(args: string[], env: NodeJS.ProcessEnv, now: Date, log: (day: string, line: string) => void = (d, l) => console.log(d, l)): Promise<Record<string, ArchiveResult | { status: 'skipped-already-archived' }>> {
  const days = args.length ? args : closedDays(now, Number(env.HISTORY_CAPTURE_CATCHUP_DAYS) || 3);
  const frozen = !args.length && env.HISTORY_CAPTURE_RECAPTURE !== 'true';
  const out: Record<string, ArchiveResult | { status: 'skipped-already-archived' }> = {};
  for (const day of days) {
    out[day] = frozen && (await isDayArchived(day)) ? { status: 'skipped-already-archived' } : await archiveDay(day, { env, now: () => now });
    log(day, JSON.stringify(out[day]));
  }
  return out;
}

async function main() {
  if (process.env.HISTORY_CAPTURE_ENABLED !== 'true') {
    console.log('HISTORY_CAPTURE_ENABLED is not true: nothing archived');
    return;
  }
  const args = process.argv.slice(2);
  // Only the Mongo connection: the full container also seeds unrelated collections and connects Redis (logging its URL).
  const { connectMongoDB, disconnectMongoDB } = await import('../../config/mongodb');
  await connectMongoDB();
  try {
    await runCatchup(args, process.env, new Date());
  } finally {
    await disconnectMongoDB();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0), (error) => { console.error('Error archiving broadcast history:', error); process.exit(1); });
}
