import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ClaudeCodeEditorialModel, parseClaudeCodeResult } from './ClaudeCodeEditorialModel';
import { ModelCallFailed, type ModelCall } from '../../application/services/EditorialAgentPipeline';
import { CostLedger, DEFAULT_EDITORIAL_LIMITS } from '../../application/services/EditorialEvidence';

const request: ModelCall = { role: 'editorial', provider: 'claude-code', model: 'claude-sonnet-5-5', effort: 'low', system: 'system', prompt: 'prompt', schema: { type: 'object' } };
const usage = { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 5, cacheCreationInputTokens: 2, webSearchRequests: 0, costUSD: 0.001, costBasis: 'list' };
const output = (over: Record<string, unknown> = {}) => JSON.stringify({ is_error: false, structured_output: { title: 'test' }, modelUsage: { 'claude-sonnet-5-5': usage }, ...over });

test('Claude Code records per-model estimated usage and accepts only verifiable no-tools output', () => {
  const result = parseClaudeCodeResult(output(), request);
  assert.deepEqual(result.json, { title: 'test' });
  assert.deepEqual(result.usage, { input_tokens: 17, output_tokens: 4 });
  const ledger = new CostLedger({ ...DEFAULT_EDITORIAL_LIMITS, maxArticleUsd: Infinity });
  ledger.chargeReported('editorial', result.usageBreakdown!);
  assert.equal(ledger.summary.entries[0].costBasis, 'estimated-list');
  assert.equal(ledger.summary.entries[0].cacheReadInputTokens, 5);
  assert.equal(ledger.summary.usd, 0.001);
  const extra = { 'claude-sonnet-5-5': usage, 'claude-haiku-4-5': { ...usage, inputTokens: 20 } };
  assert.throws(() => parseClaudeCodeResult(output({ modelUsage: extra }), request), (e: unknown) => e instanceof ModelCallFailed && e.usageBreakdown?.length === 2);
  assert.throws(() => parseClaudeCodeResult(output({ modelUsage: { 'other-model': usage } }), request), /model identity/);
  assert.throws(() => parseClaudeCodeResult(output({ modelUsage: { 'claude-sonnet-5-5': { ...usage, webSearchRequests: 1 } } }), request), /unexpected web search/);
  assert.throws(() => parseClaudeCodeResult(output({ is_error: true }), request), /missing valid structured output/);
  assert.throws(() => parseClaudeCodeResult(output({ structured_output: null }), request), /missing valid structured output/);
  assert.throws(() => parseClaudeCodeResult(output({ modelUsage: { 'claude-sonnet-5-5': { ...usage, costBasis: 'unknown' } } }), request), /unknown cost basis/);
  assert.throws(() => parseClaudeCodeResult(output({ modelUsage: { 'claude-sonnet-5-5': { ...usage, inputTokens: -1 } } }), request), /invalid inputTokens/);
  const capped = new CostLedger({ ...DEFAULT_EDITORIAL_LIMITS, maxArticleUsd: 0 });
  assert.throws(() => capped.chargeReported('editorial', [result.usageBreakdown![0], { ...result.usageBreakdown![0], model: 'auxiliary' }]), /coste/);
  assert.equal(capped.summary.entries.length, 2, 'record all model usage even when the first entry exceeds the limit');
  const invalid = new CostLedger();
  assert.throws(() => invalid.chargeReported('editorial', [{ ...result.usageBreakdown![0], inputTokens: NaN }]));
  assert.equal(invalid.summary.unresolved, true);
  const requested = new CostLedger();
  requested.chargeReported('editorial', [{ model: 'requested-model', modelIdentity: 'requested', inputTokens: 7, cacheReadInputTokens: 3, outputTokens: 2, searches: 0, estimatedUsd: 0.01 }]);
  assert.equal(requested.summary.entries[0].inputTokens, 10);
  assert.equal(requested.summary.entries[0].modelIdentity, 'requested');
  assert.equal('cacheCreationInputTokens' in requested.summary.entries[0], false, 'unknown cache writes are not reported as zero');
});

test('Claude Code refuses research and relative profile paths before starting a process', async () => {
  assert.throws(() => new ClaudeCodeEditorialModel({ executable: 'claude', home: 'home', configDir: 'config' }), /absolute/);
  const model = new ClaudeCodeEditorialModel({ executable: resolve('missing-claude'), home: resolve('.'), configDir: resolve('.') });
  await assert.rejects(model.call({ ...request, role: 'research', webSearches: 1 }), /no verified web research/);
  await assert.rejects(model.call({ ...request, role: 'research' }), /no verified web research/);
  await assert.rejects(model.call({ ...request, provider: 'anthropic' }), /routed to/);
  await assert.rejects(model.call(request), /Could not start Claude Code/);
});
