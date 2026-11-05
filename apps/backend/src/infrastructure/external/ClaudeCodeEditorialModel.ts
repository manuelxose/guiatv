import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ModelCallFailed, type EditorialModel, type ModelCall, type ModelResult } from '../../application/services/EditorialAgentPipeline';
import type { ReportedModelUsage } from '../../application/services/EditorialEvidence';

const MAX_OUTPUT_TOKENS = 32000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Subscription-backed Claude Code without web or local tools; research still needs a separate provider. */
export class ClaudeCodeEditorialModel implements EditorialModel {
  readonly provider = 'claude-code';
  readonly webSearch = false;
  readonly maxOutputTokens = MAX_OUTPUT_TOKENS;

  constructor(private readonly options: { executable: string; home: string; configDir: string; timeoutMs?: number }) {
    if (![options.executable, options.home, options.configDir].every(isAbsolute)) throw new Error('Claude Code executable and profile paths must be absolute');
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 3600000)) throw new Error('invalid Claude Code timeout');
  }

  async call(request: ModelCall): Promise<ModelResult> {
    if (request.provider !== this.provider) throw new Error(`${request.role}: routed to ${request.provider}, not ${this.provider}`);
    if (request.role === 'research' || request.webSearches !== undefined) throw new Error('Claude Code adapter has no verified web research capability');
    const cwd = await mkdtemp(join(tmpdir(), 'guiatv-claude-'));
    try {
      const args = ['-p', '--model', request.model, '--effort', request.effort, '--max-turns', '1', '--output-format', 'json',
        '--json-schema', JSON.stringify(request.schema), '--system-prompt', request.system, '--tools', '', '--strict-mcp-config',
        '--setting-sources', '', '--no-session-persistence'];
      const env: NodeJS.ProcessEnv = { HOME: this.options.home, CLAUDE_CONFIG_DIR: this.options.configDir,
        PATH: process.env.PATH, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS), MAX_STRUCTURED_OUTPUT_RETRIES: '0',
        DISABLE_AUTOUPDATER: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } : {}) };
      const output = await invoke(this.options.executable, args, request.prompt, cwd, env, this.options.timeoutMs ?? 180000);
      return parseClaudeCodeResult(output, request);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

function invoke(executable: string, args: string[], input: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '';
    let bytes = 0;
    let failure = '';
    const stop = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { child.kill(); }
    };
    const timer = setTimeout(() => { failure = 'Claude Code timed out'; stop(); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_RESPONSE_BYTES) { failure = 'Claude Code response exceeded size limit'; stop(); }
      else stdout += chunk;
    });
    child.stdin.on('error', () => { failure ||= 'Claude Code closed its input'; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not start Claude Code')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(new Error(failure || `Claude Code exited with status ${code}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

/** Validate CLI metadata before allowing an answer into the editorial pipeline. */
export function parseClaudeCodeResult(output: string, request: ModelCall): ModelResult {
  let result: Record<string, unknown>;
  try { result = JSON.parse(output); } catch { throw new Error('Claude Code returned invalid JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Claude Code returned an invalid result');
  const raw = result.modelUsage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) throw new Error('Claude Code did not report model usage');
  const number = (entry: Record<string, unknown>, key: string, integer = true): number => {
    const n = entry[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (integer && !Number.isSafeInteger(n))) throw new Error(`Claude Code returned invalid ${key}`);
    return n;
  };
  const usageBreakdown: ReportedModelUsage[] = Object.entries(raw).map(([model, value]) => {
    if (!model || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Claude Code returned invalid per-model usage');
    const e = value as Record<string, unknown>;
    if (e.costBasis !== 'list') throw new Error('Claude Code returned an unknown cost basis');
    return { model, inputTokens: number(e, 'inputTokens'), outputTokens: number(e, 'outputTokens'),
      cacheReadInputTokens: number(e, 'cacheReadInputTokens'), cacheCreationInputTokens: number(e, 'cacheCreationInputTokens'),
      searches: number(e, 'webSearchRequests'), estimatedUsd: number(e, 'costUSD', false), modelIdentity: 'reported' };
  });
  const usage = { input_tokens: usageBreakdown.reduce((n, e) => n + e.inputTokens + e.cacheReadInputTokens + (e.cacheCreationInputTokens ?? 0), 0),
    output_tokens: usageBreakdown.reduce((n, e) => n + e.outputTokens, 0) };
  const searches = usageBreakdown.reduce((n, e) => n + e.searches, 0);
  const fail = (message: string): never => { throw new ModelCallFailed(`${request.role}: ${message}`, usage, searches, usageBreakdown); };
  // A JSON result does not identify which model produced the answer when several models were used.
  if (usageBreakdown.length !== 1 || !(usageBreakdown[0].model === request.model || usageBreakdown[0].model.startsWith(`${request.model}-`))) fail('model identity cannot be verified');
  if (searches) fail('unexpected web search in a no-tools call');
  if (result.is_error !== false || !result.structured_output || typeof result.structured_output !== 'object' || Array.isArray(result.structured_output)) fail('missing valid structured output');
  return { json: result.structured_output, usage, searches, usageBreakdown };
}
