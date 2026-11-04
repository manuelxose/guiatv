import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { envNumber } from './diagnosticsCommon';
import { logger } from './logger';

/**
 * M13-B1: optional one-shot CPU profile of the first seconds after process start, to name the function behind a start-up
 * stall. Off by default: it needs BOTH `DIAG_CPU_PROFILE=startup` and an explicit `DIAG_CPU_PROFILE_DIR`; nothing is
 * written anywhere else, only one file per process, and the duration is clamped (5-300 s, default 60). A `.cpuprofile`
 * holds function names, source locations and timings (no request data, no environment); open it in Chrome DevTools.
 * The write is synchronous (a one-off stall of a few hundred ms at the deadline; the profiler itself adds sampling overhead
 * while it runs). Any failure (inspector unavailable, directory not writable) is logged and swallowed.
 */
export interface CpuProfileHandle {
  /** Stops early (or at the deadline) and writes the file; resolves to its path, or undefined on failure. */
  stop(): Promise<string | undefined>;
}

const log = logger.child('CpuProfile');

export function startStartupCpuProfile(env: NodeJS.ProcessEnv = process.env): CpuProfileHandle | null {
  if (env.DIAG_CPU_PROFILE !== 'startup') return null;
  const dir = env.DIAG_CPU_PROFILE_DIR;
  if (!dir) {
    log.warn('DIAG_CPU_PROFILE=startup ignored: DIAG_CPU_PROFILE_DIR is not set');
    return null;
  }
  const seconds = envNumber(env, 'DIAG_CPU_PROFILE_SECONDS', 60, 5, 300);
  let session: import('node:inspector').Session | undefined;
  let finished: Promise<string | undefined> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const post = (method: string, params?: object) =>
    new Promise<any>((resolve, reject) => {
      session!.post(method, params as any, (error, result) => (error ? reject(error) : resolve(result)));
    });

  const ready = (async () => {
    try {
      const { Session } = await import('node:inspector');
      session = new Session();
      session.connect();
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: 1_000 });
      await post('Profiler.start');
      log.warn('Startup CPU profile started', { seconds });
      return true;
    } catch (error) {
      log.warn('Startup CPU profile unavailable', { reason: (error as Error).name });
      return false;
    }
  })();

  const stop = (): Promise<string | undefined> => {
    finished ??= (async () => {
      if (timer) clearTimeout(timer);
      if (!(await ready)) return undefined;
      try {
        const { profile } = await post('Profiler.stop');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = join(dir, `guiatv-api-startup-${process.pid}-${Date.now()}.cpuprofile`);
        writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
        log.warn('Startup CPU profile written', { file });
        return file;
      } catch (error) {
        log.warn('Startup CPU profile could not be written', { reason: (error as Error).name });
        return undefined;
      } finally {
        try { session?.disconnect(); } catch { /* already closed */ }
      }
    })();
    return finished;
  };

  timer = setTimeout(() => void stop(), seconds * 1_000);
  timer.unref();
  return { stop };
}
