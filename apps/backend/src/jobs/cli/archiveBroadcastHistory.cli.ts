#!/usr/bin/env node
import '../../config/bootstrap';

import { archiveDay, isDayArchived } from '../../application/services/BroadcastObservationArchiver';

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

async function main() {
  if (process.env.HISTORY_CAPTURE_ENABLED !== 'true') {
    console.log('HISTORY_CAPTURE_ENABLED is not true: nothing archived');
    return;
  }
  const args = process.argv.slice(2);
  const days = args.length ? args : closedDays(new Date(), Number(process.env.HISTORY_CAPTURE_CATCHUP_DAYS) || 3);
  // Only the Mongo connection: the full container also seeds unrelated collections and connects Redis (logging its URL).
  const { connectMongoDB, disconnectMongoDB } = await import('../../config/mongodb');
  await connectMongoDB();
  try {
    const frozen = !args.length && process.env.HISTORY_CAPTURE_RECAPTURE !== 'true';
    for (const day of days) {
      if (frozen && (await isDayArchived(day))) { console.log(day, JSON.stringify({ status: 'skipped-already-archived' })); continue; }
      console.log(day, JSON.stringify(await archiveDay(day)));
    }
  } finally {
    await disconnectMongoDB();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0), (error) => { console.error('Error archiving broadcast history:', error); process.exit(1); });
}
