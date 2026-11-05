import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ModelCallFailed, type EditorialModel, type ModelCall, type ModelResult } from '../../application/services/EditorialAgentPipeline';
import { MODEL_PRICES } from '../../application/services/EditorialEvidence';

/** Codex subscription adapter. Research is deliberately unavailable: its web calls are not bounded here. */
export class CodexEditorialModel implements EditorialModel {
  readonly provider = 'codex';
  readonly webSearch = false;
  readonly maxOutputTokens = 128000;

  constructor(private readonly command = process.env.EDITORIAL_CODEX_COMMAND || '/usr/local/bin/codex') {
    if (!isAbsolute(command)) throw new Error('EDITORIAL_CODEX_COMMAND must be an absolute path');
  }

  async call(request: ModelCall): Promise<ModelResult> {
    if (request.provider !== this.provider || request.webSearches) throw new Error('Codex cannot run this route');
    const dir = await mkdtemp(join(tmpdir(), 'guiatv-codex-'));
    try {
      const schema = join(dir, 'schema.json');
      await writeFile(schema, JSON.stringify(request.schema), { mode: 0o600 });
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'HOME', 'CODEX_HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP']) {
        if (process.env[key]) env[key] = process.env[key];
      }
      const args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps',
        '--disable', 'multi_agent', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'remote_plugin',
        '--disable', 'skill_mcp_dependency_install', '--disable', 'tool_suggest', '--config', 'web_search="disabled"',
        '--config', `model_reasoning_effort="${request.effort}"`, '--config', `developer_instructions=${JSON.stringify(request.system)}`,
        '--model', request.model, '--output-schema', schema, '-'];
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(this.command, args, { cwd: dir, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] });
        let data = '';
        let failure: string | undefined;
        const stop = () => {
          try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
          catch { child.kill('SIGKILL'); }
        };
        const timer = setTimeout(() => { failure = 'Codex timed out'; stop(); }, 180000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          data += chunk;
          if (data.length > 2_000_000 && !failure) { failure = 'Codex output exceeded limit'; stop(); }
        });
        child.on('error', () => { clearTimeout(timer); reject(new Error('Cannot start Codex')); });
        child.on('close', (code) => { clearTimeout(timer); code === 0 && !failure ? resolve(data) : reject(new Error(failure || 'Codex did not complete')); });
        child.stdin.on('error', () => undefined);
        child.stdin.end(request.prompt);
      });
      return parseCodexOutput(output, request.model);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** A successful exit alone is insufficient: reject failed turns, tools and missing usage. */
export function parseCodexOutput(output: string, requestedModel: string): ModelResult {
  let answer: string | undefined;
  let usage: ModelResult['usage'] | undefined;
  let cached: number | undefined;
  for (const line of output.split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'error' || event.type === 'turn.failed') throw new Error('Codex turn failed');
    if (event.type === 'item.started' || event.type === 'item.completed') {
      const type = event.item?.type;
      if (type === 'agent_message' && event.type === 'item.completed') {
        if (answer !== undefined) throw new Error('Codex returned multiple answers');
        answer = event.item.text;
      }
      else if (type !== 'agent_message' && type !== 'reasoning') throw new Error('Codex used an unexpected tool');
    }
    if (event.type === 'turn.completed') {
      if (usage) throw new Error('Codex returned multiple completed turns');
      const { input_tokens, output_tokens, cached_input_tokens } = event.usage || {};
      if (!Number.isSafeInteger(input_tokens) || input_tokens < 0 || !Number.isSafeInteger(output_tokens) || output_tokens < 0 ||
        !Number.isSafeInteger(cached_input_tokens) || cached_input_tokens < 0 || cached_input_tokens > input_tokens) throw new Error('Codex returned invalid usage');
      usage = { input_tokens, output_tokens };
      cached = cached_input_tokens;
    }
  }
  if (!usage || cached === undefined || typeof answer !== 'string') throw new Error('Codex returned incomplete output');
  const price = MODEL_PRICES[requestedModel];
  if (!price || !['gpt-5.6-terra', 'gpt-5.6-luna'].includes(requestedModel)) throw new Error('Codex model has no verified estimate');
  const long = usage.input_tokens > 272000;
  const estimatedUsd = +(((usage.input_tokens - cached + cached * 0.1) * price[0] * (long ? 2 : 1) + usage.output_tokens * price[1] * (long ? 1.5 : 1)) / 1e6).toFixed(6);
  const usageBreakdown = [{ model: requestedModel, modelIdentity: 'requested' as const, inputTokens: usage.input_tokens - cached, cacheReadInputTokens: cached, outputTokens: usage.output_tokens, searches: 0, estimatedUsd }];
  try { return { json: JSON.parse(answer), usage, searches: 0, usageBreakdown }; }
  catch { throw new ModelCallFailed('Codex returned invalid JSON', usage, 0, usageBreakdown); }
}
