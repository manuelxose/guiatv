#!/usr/bin/env node
/**
 * CLI entry for the football ingestion tick — same style as `syncEPG.cli.ts`.
 * Connects Mongo, ensures the football indexes, runs one lock-guarded tick,
 * then disconnects. Run: `npm run job:football:ingestion` (add to package.json).
 */

import '@/config/bootstrap';

import { connectMongoDB, disconnectMongoDB } from '@/config/mongodb';
import { createFootballIndexes } from '@/infrastructure/sports/persistence/createFootballIndexes';
import { buildFootballIngestionService } from '../factory';
import { runFootballIngestionTick } from '../runIngestionTick';

async function main(): Promise<void> {
  try {
    console.log('Ejecutando tick de ingestión de fútbol');
    await connectMongoDB();
    await createFootballIndexes();

    const service = buildFootballIngestionService();
    const result = await runFootballIngestionTick(service);
    console.log(JSON.stringify(result));

    await disconnectMongoDB();
    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando tick de ingestión:', error);
    process.exit(1);
  }
}

void main();
