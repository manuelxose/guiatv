#!/usr/bin/env node
import '../../config/bootstrap';

import { archiveDay } from '../../application/services/BroadcastObservationArchiver';

/**
 * M12-G3B: archives closed Madrid days into tv_broadcast_observations.
 *   node dist/jobs/cli/archiveBroadcastHistory.cli.js [YYYYMMDD ...]   (default: the last HISTORY_CAPTURE_CATCHUP_DAYS closed days, 3)
 * Exits 0 without touching the database unless HISTORY_CAPTURE_ENABLED=true. Safe to re-run (idempotent).
 */
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

export function closedDays(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => fmt.format(new Date(now.getTime() - (i + 1) * 86_400_000)).replace(/-/g, '')).reverse();
}

async function main() {
  if (process.env.HISTORY_CAPTURE_ENABLED !== 'true') {
    console.log('HISTORY_CAPTURE_ENABLED is not true: nothing archived');
    return;
  }
  const args = process.argv.slice(2);
  const days = args.length ? args : closedDays(new Date(), Number(process.env.HISTORY_CAPTURE_CATCHUP_DAYS) || 3);
  const { createContainer } = await import('../../config/container');
  const container = createContainer();
  await container.initialize();
  try {
    for (const day of days) console.log(day, JSON.stringify(await archiveDay(day)));
  } finally {
    await container.cleanup();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0), (error) => { console.error('Error archiving broadcast history:', error); process.exit(1); });
}
