import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorialReviewGuard, humanEditorialReviewGuard, policyApprovalGuard } from './editorialReviewGuard';

const ENV_KEYS = ['EDITORIAL_REVIEW_KEY', 'AUCTORIO_EDITORIAL_REVIEW_KEY', 'AUCTORIO_EDITORIAL_REVIEWER', 'EDITORIAL_POLICY_KEY', 'ANALYTICS_ADMIN_KEY'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function request(headers: Record<string, string>) {
  return { header: (name: string) => headers[name.toLowerCase()] } as never;
}

test.afterEach(restoreEnv);

test('accepts the dedicated Autorio key only for its configured reviewer', () => {
  process.env.EDITORIAL_REVIEW_KEY = 'human-review-key';
  process.env.AUCTORIO_EDITORIAL_REVIEW_KEY = 'auctorio-review-key';
  process.env.AUCTORIO_EDITORIAL_REVIEWER = 'auctorio-quality-gate';

  let called = false;
  editorialReviewGuard(
    request({ 'x-editorial-review-key': 'auctorio-review-key', 'x-editorial-reviewer': 'auctorio-quality-gate' }),
    {} as never,
    () => { called = true; }
  );
  assert.equal(called, true);
});

test('rejects the Autorio key when the reviewer identity does not match', () => {
  process.env.AUCTORIO_EDITORIAL_REVIEW_KEY = 'auctorio-review-key';
  process.env.AUCTORIO_EDITORIAL_REVIEWER = 'auctorio-quality-gate';

  assert.throws(
    () => editorialReviewGuard(
      request({ 'x-editorial-review-key': 'auctorio-review-key', 'x-editorial-reviewer': 'someone-else' }),
      {} as never,
      () => undefined
    ),
    /Invalid editorial review key/
  );
});

test('M11-D: the runner policy key cannot approve as a person, roll back, or lift the emergency stop', () => {
  process.env.EDITORIAL_REVIEW_KEY = 'human-review-key';
  process.env.EDITORIAL_POLICY_KEY = 'runner-policy-key';
  const runner = request({ 'x-editorial-review-key': 'runner-policy-key', 'x-editorial-policy-key': 'runner-policy-key', 'x-editorial-reviewer': 'Ana' });
  assert.throws(() => editorialReviewGuard(runner, {} as never, () => undefined), /policy key cannot review/);
  assert.throws(() => humanEditorialReviewGuard(runner, {} as never, () => undefined), /human editorial review key/);
  let called = 0;
  policyApprovalGuard(runner, {} as never, () => { called++; });
  assert.equal(called, 1, 'its one right: approve-by-policy');
  // The human key is not a policy key: a person approves through `approve`, never as the automation.
  assert.throws(() => policyApprovalGuard(request({ 'x-editorial-policy-key': 'human-review-key' }), {} as never, () => undefined), /Invalid editorial policy key/);
  assert.throws(() => policyApprovalGuard(request({ 'x-editorial-review-key': 'runner-policy-key' }), {} as never, () => undefined), /Invalid editorial policy key/);
});

test('M11-D: a policy key equal to a reviewer key, or none, closes policy approval', () => {
  process.env.EDITORIAL_REVIEW_KEY = 'same-key';
  process.env.EDITORIAL_POLICY_KEY = 'same-key';
  const req = request({ 'x-editorial-policy-key': 'same-key', 'x-editorial-review-key': 'same-key' });
  assert.throws(() => policyApprovalGuard(req, {} as never, () => undefined), /not configured/);
  assert.throws(() => humanEditorialReviewGuard(req, {} as never, () => undefined), /human editorial review key/);
  delete process.env.EDITORIAL_POLICY_KEY;
  assert.throws(() => policyApprovalGuard(req, {} as never, () => undefined), /not configured/);
  // The runner holds the admin key: a human key equal to it cannot lift the stop.
  process.env.ANALYTICS_ADMIN_KEY = 'same-key';
  delete process.env.EDITORIAL_POLICY_KEY;
  assert.throws(() => humanEditorialReviewGuard(request({ 'x-editorial-review-key': 'same-key' }), {} as never, () => undefined), /human editorial review key/);
});
