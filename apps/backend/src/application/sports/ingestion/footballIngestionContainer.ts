/**
 * Football ingestion wiring (M05 captain-owned).
 *
 * Holds the single ingestion service instance shared by the admin diagnostics
 * endpoint and the scheduled ingestion job, so there is exactly one quota
 * accounting authority per process.
 *
 * Enable/disable with `FOOTBALL_INGESTION_ENABLED` (default: enabled, `0` disables).
 * No visitor request ever triggers an upstream call: only the scheduled tick does.
 */

import type { FootballIngestionService } from './FootballIngestionService';

let service: FootballIngestionService | null = null;
let loading: Promise<FootballIngestionService | null> | null = null;

export const isFootballIngestionEnabled = (): boolean => process.env.FOOTBALL_INGESTION_ENABLED !== '0';

/** Synchronous read of the already-built instance (null until `getFootballIngestionService` resolves). */
export function sharedFootballIngestionService(): FootballIngestionService | null {
  return service;
}

/** Builds the service once per process. Returns null when ingestion is disabled. */
export async function getFootballIngestionService(): Promise<FootballIngestionService | null> {
  if (service) return service;
  if (!isFootballIngestionEnabled()) return null;
  if (loading) return loading;
  loading = (async () => {
    const { buildFootballIngestionService } = await import('../../../jobs/football/factory');
    service = buildFootballIngestionService();
    return service;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

let extraServices: FootballIngestionService[] | null = null;

/**
 * M07: every ingestion provider (OpenLigaDB first, then the keyed ones that are
 * configured). Each has its own lock and durable quota; the admin endpoints keep
 * using the primary (`getFootballIngestionService`).
 */
export async function getFootballIngestionServices(): Promise<FootballIngestionService[]> {
  const primary = await getFootballIngestionService();
  if (!primary) return [];
  if (!extraServices) {
    const { buildFootballDataIoIngestionService, buildFootballDataOrgIngestionService } = await import('../../../jobs/football/factory');
    extraServices = [];
    // Each keyed provider fails closed on its own: the others keep ingesting.
    for (const [name, build] of [['footballdata.io', buildFootballDataIoIngestionService], ['football-data.org', buildFootballDataOrgIngestionService]] as const) {
      try {
        const service = build();
        if (service) extraServices.push(service);
      } catch (error) {
        console.error(`[FootballIngestion] ${name} disabled:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return [primary, ...extraServices];
}

/** Test seam: replace or clear the shared instance. */
export function setFootballIngestionServiceForTests(next: FootballIngestionService | null): void {
  service = next;
  extraServices = null;
}
