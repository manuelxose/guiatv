#!/usr/bin/env node
import '../../config/bootstrap';

async function main() {
  try {
    console.log('Ejecutando sincronización de artículos (BabyLoveGrowth / Auctorio) desde CLI');

    const { createContainer } = await import('../../config/container');
    const container = createContainer();
    await container.initialize();

    const { syncArticleFeedsJob } = await import('../syncArticleFeeds');
    await syncArticleFeedsJob({
      invalidateEditorialReads: () => container.get<{ clear(pattern: string): Promise<void> }>('cacheRepository').clear('v2:editorial:*'),
    });

    await container.cleanup();
    console.log('Job completado exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('Error ejecutando job:', error);
    process.exit(1);
  }
}

main();
