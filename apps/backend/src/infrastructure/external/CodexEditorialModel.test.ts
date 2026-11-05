import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexEditorialModel, parseCodexOutput } from './CodexEditorialModel';

const event = (value: unknown) => JSON.stringify(value);
const message = event({ type: 'item.completed', item: { type: 'agent_message', text: '{"verdict":"pass"}' } });
const complete = event({ type: 'turn.completed', usage: { input_tokens: 123, cached_input_tokens: 100, output_tokens: 12 } });
const parse = (output: string) => parseCodexOutput(output, 'gpt-5.6-terra');

test('Codex output requires a completed turn, valid usage and a structured answer', () => {
  const result = parse([message, complete].join('\n'));
  assert.deepEqual(result.json, { verdict: 'pass' });
  assert.deepEqual(result.usageBreakdown, [{ model: 'gpt-5.6-terra', modelIdentity: 'requested', inputTokens: 23, cacheReadInputTokens: 100, outputTokens: 12, searches: 0, estimatedUsd: 0.00021 }]);
  assert.throws(() => parse(message), /incomplete/);
  assert.throws(() => parse([message, event({ type: 'turn.failed' }), complete].join('\n')), /failed/);
  assert.throws(() => parse([message, event({ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 1 } })].join('\n')), /invalid usage/);
  assert.throws(() => parse([message, event({ type: 'item.started', item: { type: 'command_execution' } }), complete].join('\n')), /unexpected tool/);
  assert.throws(() => parse([event({ type: 'item.completed', item: { type: 'agent_message', text: 'not json' } }), complete].join('\n')), /invalid JSON/);
});

test('Codex rejects research and non-Codex routes before starting a process', async () => {
  const model = new CodexEditorialModel('/does-not-need-to-exist');
  const call = { role: 'research' as const, provider: 'codex', model: 'gpt-5.6-terra', effort: 'low' as const, system: '', prompt: '', schema: {} };
  await assert.rejects(model.call({ ...call, webSearches: 1 }), /cannot run/);
  await assert.rejects(model.call({ ...call, provider: 'openai' }), /cannot run/);
});
