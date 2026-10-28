#!/usr/bin/env node
import '../config/bootstrap';

import { connectMongoDB, disconnectMongoDB } from '../config/mongodb';
import { runSearchConsoleMonitor } from '../application/services/SearchConsoleMonitor';
import { logger } from '../shared/utils/logger';

/** One manual read-only Search Console run; runs regardless of GSC_MONITOR_ENABLED (that flag gates the schedule). */
async function main() {
  await connectMongoDB();
  try {
    const run = await runSearchConsoleMonitor();
    logger.info('Search Console monitor run', { ...run });
    return run.status === 'ok' ? 0 : 1;
  } finally {
    await disconnectMongoDB();
  }
}

main().then((code) => process.exit(code)).catch((error) => {
  logger.error('Search Console monitor failed', error as Error);
  process.exit(1);
});
