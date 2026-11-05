import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { ConflictError, ValidationError } from '../../shared/errors';

export interface EditorialRunnerProcessState {
  configured: boolean;
  managed: boolean;
  running: boolean;
  pid: number | null;
  command: string | null;
  cwd: string | null;
  envKeys: string[];
  logPath: string | null;
}

interface RunnerServiceOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  stateDir?: string;
  envKeys?: string[];
}

const DEFAULT_STATE_DIR = '/var/lib/guiatv/editorial-runner';
const pidAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

export class EditorialRunnerService {
  private readonly options: RunnerServiceOptions;

  constructor(options: RunnerServiceOptions = {}) {
    this.options = {
      command: options.command ?? process.env.EDITORIAL_RUNNER_COMMAND,
      args: options.args ?? this.jsonArray(process.env.EDITORIAL_RUNNER_ARGS),
      cwd: options.cwd ?? process.env.EDITORIAL_RUNNER_CWD ?? process.cwd(),
      stateDir: options.stateDir ?? process.env.EDITORIAL_RUNNER_STATE_DIR ?? DEFAULT_STATE_DIR,
      envKeys: options.envKeys ?? (process.env.EDITORIAL_RUNNER_ENV_KEYS || 'PATH,HOME,NODE_ENV,OPENAI_API_KEY,ANTHROPIC_API_KEY,DEEPSEEK_API_KEY,DEEPSEEK_BASE_URL,ANALYTICS_ADMIN_KEY,EDITORIAL_PIPELINE_SIGNING_KEY,EDITORIAL_POLICY_KEY,EDITORIAL_BUDGET,EDITORIAL_MAX_ARTICLE_USD,EDITORIAL_MAX_DAILY_USD,EDITORIAL_MAX_REVISIONS,EDITORIAL_MAX_DAILY_ATTEMPTS').split(',').map((key) => key.trim()).filter(Boolean),
    };
  }

  state(): EditorialRunnerProcessState {
    const pid = this.readPid();
    const running = pid !== null && pidAlive(pid);
    return {
      configured: Boolean(this.options.command),
      managed: Boolean(this.options.command),
      running,
      pid: running ? pid : null,
      command: this.options.command ? basename(this.options.command) : null,
      cwd: this.options.cwd ?? null,
      envKeys: this.options.envKeys?.filter((key) => Boolean(process.env[key])) ?? [],
      logPath: this.options.command ? this.logPath() : null,
    };
  }

  async start(): Promise<EditorialRunnerProcessState> {
    const command = this.validCommand();
    const current = this.state();
    if (current.running) return current;
    mkdirSync(this.options.stateDir!, { recursive: true });
    const child: ChildProcess = spawn(command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: this.filteredEnv(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => this.appendLog(chunk));
    child.stderr?.on('data', (chunk) => this.appendLog(chunk));
    child.on('exit', (code, signal) => {
      this.appendLog(`\n[editorial-runner] exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
      if (this.readPid() === child.pid) writeFileSync(this.pidPath(), '', 'utf8');
    });
    child.on('error', (error) => this.appendLog(`\n[editorial-runner] failed to start: ${error.message}\n`));
    if (!child.pid) throw new ValidationError('The editorial runner process could not be started', []);
    writeFileSync(this.pidPath(), String(child.pid), 'utf8');
    child.unref();
    return this.state();
  }

  async stop(): Promise<EditorialRunnerProcessState> {
    const pid = this.readPid();
    if (!pid || !pidAlive(pid)) {
      writeFileSync(this.pidPath(), '', 'utf8');
      return this.state();
    }
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && pidAlive(pid)) await new Promise((resolve) => setTimeout(resolve, 100));
    if (pidAlive(pid)) process.kill(pid, 'SIGKILL');
    writeFileSync(this.pidPath(), '', 'utf8');
    return this.state();
  }

  async restart(): Promise<EditorialRunnerProcessState> {
    await this.stop();
    return this.start();
  }

  logs(lines = 120): { configured: boolean; path: string | null; lines: string[] } {
    const count = Math.min(Math.max(Math.trunc(lines) || 120, 1), 500);
    const path = this.logPath();
    if (!this.options.command || !existsSync(path)) return { configured: Boolean(this.options.command), path: this.options.command ? path : null, lines: [] };
    const output = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(-count);
    return { configured: true, path, lines: output.map((line) => line.slice(0, 1000)) };
  }

  private validCommand(): string {
    const command = String(this.options.command || '').trim();
    if (!command) throw new ConflictError('Runner management is not configured on this server (EDITORIAL_RUNNER_COMMAND)');
    if (!isAbsolute(command)) throw new ValidationError('EDITORIAL_RUNNER_COMMAND must be an absolute executable path', []);
    return command;
  }

  private filteredEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of this.options.envKeys ?? []) if (process.env[key] !== undefined) env[key] = process.env[key];
    return env;
  }

  private readPid(): number | null {
    const path = this.pidPath();
    if (!existsSync(path)) return null;
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  private pidPath(): string { return join(this.options.stateDir ?? DEFAULT_STATE_DIR, 'editorial-runner.pid'); }
  private logPath(): string { return join(this.options.stateDir ?? DEFAULT_STATE_DIR, 'editorial-runner.log'); }
  private appendLog(chunk: Buffer | string): void {
    mkdirSync(dirname(this.logPath()), { recursive: true });
    appendFileSync(this.logPath(), chunk);
  }

  private jsonArray(value: string | undefined): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
    } catch {
      throw new ValidationError('EDITORIAL_RUNNER_ARGS must be a JSON array', []);
    }
  }
}
