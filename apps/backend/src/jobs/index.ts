import cron from 'node-cron';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join } from 'node:path';

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

/**
 * Runs a heavy maintenance job in a separate Node process so XML parsing,
 * image work and garbage collection cannot block the API event loop.
 */
export function createIsolatedJobRunner(
  scriptPath: string,
  spawnProcess: SpawnProcess = spawn
): () => Promise<boolean> {
  let running = false;

  return async () => {
    if (running) return false;
    running = true;

    return new Promise<boolean>((resolve, reject) => {
      const child = spawnProcess(process.execPath, [scriptPath], {
        env: process.env,
        stdio: 'inherit',
      });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        running = false;
        if (error) reject(error);
        else resolve(true);
      };

      child.once('error', (error) => finish(error));
      child.once('exit', (code, signal) => {
        if (code === 0) finish();
        else finish(new Error(`Job ${scriptPath} exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
      });
    });
  };
}

export interface ScheduledJobInfo { name: string; label: string; schedule: string; runnable: boolean }
interface ScheduledJobEntry extends ScheduledJobInfo { run: () => Promise<unknown> }
const registry = new Map<string, ScheduledJobEntry>();
export const listScheduledJobs = (): ScheduledJobInfo[] => [...registry.values()].map(({ run: _run, ...info }) => info);
/** Runs a registered job now through the same runner as the cron trigger (so an overlapping run is refused, not stacked). */
export async function runScheduledJob(name: string): Promise<boolean> {
  const job = registry.get(name);
  if (!job || !job.runnable) throw new Error(`Unknown or non-runnable scheduled job: ${name}`);
  return (await job.run()) !== false;
}

/**
 * Inicializar todos los jobs programados usando node-cron
 * `track` records each run (cron or manual) as an admin operation so it shows in Background jobs.
 */
export function initializeJobs(options: {
  refreshFootballHome?: () => Promise<unknown>;
  /** Clears the public editorial caches of the running process (and of Redis, when configured). */
  invalidateEditorialReads?: () => Promise<void>;
  track?: (type: string, triggeredBy: string, task: () => Promise<unknown>) => Promise<unknown>;
} = {}): void {
  const tracked = (name: string, run: () => Promise<unknown>) => (triggeredBy: string) => (options.track ? options.track(name, triggeredBy, run) : run());
  const register = (name: string, label: string, schedule: string, run: () => Promise<unknown>, runnable = true) => {
    const runTracked = tracked(name, run);
    registry.set(name, { name, label, schedule, runnable, run: () => runTracked('admin') });
    return () => runTracked('cron');
  };
  console.log('[Jobs] Configurando jobs programados...');
  const runSyncEpg = createIsolatedJobRunner(join(__dirname, 'cli/syncEPG.cli.js'));
  const runPrecompute = createIsolatedJobRunner(join(__dirname, 'cli/precomputeSchedules.cli.js'));
  const runCleanup = createIsolatedJobRunner(join(__dirname, 'cli/cleanOldPrograms.cli.js'));

  // Sincronizar EPG cada 6 horas (00:00, 06:00, 12:00, 18:00)
  const cronSyncEpg = register('syncEPG', 'Sincronización de EPG', '0 */6 * * *', runSyncEpg);
  cron.schedule(
    '0 */6 * * *',
    async () => {
      try {
        await cronSyncEpg();
      } catch (error) {
        console.error('Error ejecutando syncEPGJob:', error);
      }
    },
    {
      timezone: 'Europe/Madrid',
    }
  );
  console.log('  - syncEPG: cada 6 horas (0 */6 * * *)');

  // Precomputar horarios cada 6 horas (00:00, 06:00, 12:00, 18:00)
  const cronPrecompute = register('precomputeSchedules', 'Precálculo de horarios', '15 */6 * * *', runPrecompute);
  cron.schedule(
    '15 */6 * * *',
    async () => {
      try {
        await cronPrecompute();
      } catch (error) {
        console.error('Error ejecutando precomputeSchedulesJob:', error);
      }
    },
    {
      timezone: 'Europe/Madrid',
    }
  );
  console.log('  - precomputeSchedules: cada 6 horas (15 */6 * * *)');

  // Limpiar programas antiguos cada 24 horas a las 3:00 AM
  const cronCleanup = register('cleanOldPrograms', 'Limpieza de programas antiguos', '0 3 * * *', runCleanup);
  cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        await cronCleanup();
      } catch (error) {
        console.error('Error ejecutando cleanOldProgramsJob:', error);
      }
    },
    {
      timezone: 'Europe/Madrid',
    }
  );
  console.log('  - cleanOldPrograms: cada dia a las 3:00 AM (0 3 * * *)');

  // Producers publish on their own schedule: check hourly rather than on page views (their APIs are rate limited).
  // Runs in-process (it is HTTP + Mongo I/O) so a publish drops this process's editorial caches immediately.
  const runArticleFeeds = async () => {
    const { syncArticleFeedsJob } = await import('./syncArticleFeeds');
    return syncArticleFeedsJob({ invalidateEditorialReads: options.invalidateEditorialReads });
  };
  const cronArticleFeeds = register('syncArticleFeeds', 'Sincronización de artículos (BabyLoveGrowth / Auctorio)', '20 * * * *', runArticleFeeds);
  cron.schedule(
    '20 * * * *',
    async () => {
      try {
        await cronArticleFeeds();
      } catch (error) {
        console.error('Error ejecutando syncArticleFeedsJob:', error);
      }
    },
    {
      timezone: 'Europe/Madrid',
    }
  );
  console.log('  - syncArticleFeeds: cada hora en el minuto 20 (20 * * * *)');

  if (options.refreshFootballHome) {
    register('footballHomeReadModel', 'Modelo de portada de fútbol', '* * * * *', async () => options.refreshFootballHome?.(), false);
    const refresh = async () => {
      try {
        await options.refreshFootballHome?.();
      } catch (error) {
        console.error('Error refrescando football home read model:', error);
      }
    };
    // A one-minute trigger is inexpensive on a fresh cache and guarantees
    // provider/reconciliation work happens outside visitor requests.
    cron.schedule('* * * * *', refresh, { timezone: 'Europe/Madrid' });
    setImmediate(() => void refresh());
    console.log('  - footballHomeReadModel: cada minuto (* * * * *)');
  }

  console.log('[Jobs] Jobs programados configurados correctamente');
}
