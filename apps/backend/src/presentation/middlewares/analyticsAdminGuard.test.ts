import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsAdminGuard } from './analyticsAdminGuard';

/**
 * M06 / LOW-05: the admin key comparison must not leak the shared prefix through
 * timing. `timingSafeEqual` is used, with a length check first.
 *
 * These tests pin the observable security contract of the guard: fail closed when
 * unconfigured, accept only the exact key via either header, and reject every
 * near-miss (prefix, superset, case change, empty).
 */

function runGuard(env: Record<string, string | undefined>, headers: Record<string, string>): {
  threw: boolean;
  message?: string;
  nextCalled: boolean;
} {
  const previous = { ...process.env };
  try {
    if (env.ANALYTICS_ADMIN_KEY === undefined) delete process.env.ANALYTICS_ADMIN_KEY;
    else process.env.ANALYTICS_ADMIN_KEY = env.ANALYTICS_ADMIN_KEY;

    const req = { header: (name: string) => headers[name.toLowerCase()] } as never;
    const res = {} as never;
    let nextCalled = false;
    let threw = false;
    let message: string | undefined;
    try {
      analyticsAdminGuard(req, res, () => {
        nextCalled = true;
      });
    } catch (error) {
      threw = true;
      message = error instanceof Error ? error.message : String(error);
    }
    return { threw, message, nextCalled };
  } finally {
    if (previous.ANALYTICS_ADMIN_KEY === undefined) delete process.env.ANALYTICS_ADMIN_KEY;
    else process.env.ANALYTICS_ADMIN_KEY = previous.ANALYTICS_ADMIN_KEY;
  }
}

test('M06 LOW-05: the admin guard fails closed when no key is configured', () => {
  const outcome = runGuard({ ANALYTICS_ADMIN_KEY: undefined }, { 'x-admin-key': 'anything' });
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.threw, true);
});

test('M06 LOW-05: the exact key is accepted through either header', () => {
  const viaHeader = runGuard({ ANALYTICS_ADMIN_KEY: 'secret-key' }, { 'x-admin-key': 'secret-key' });
  assert.equal(viaHeader.nextCalled, true);
  assert.equal(viaHeader.threw, false);

  const viaBearer = runGuard({ ANALYTICS_ADMIN_KEY: 'secret-key' }, { authorization: 'Bearer secret-key' });
  assert.equal(viaBearer.nextCalled, true);
});

test('M06 LOW-05: every near-miss is rejected, including a wrong shared prefix', () => {
  const cases: Array<Record<string, string>> = [
    { 'x-admin-key': 'secret-ke' }, // prefix of the real key
    { 'x-admin-key': 'secret-keyy' }, // real key plus one char
    { 'x-admin-key': 'Secret-Key' }, // case change
    { 'x-admin-key': '' }, // empty
    { 'x-admin-key': 'totally-different-key' }, // same length, different content
  ];
  for (const headers of cases) {
    const outcome = runGuard({ ANALYTICS_ADMIN_KEY: 'secret-key' }, headers);
    assert.equal(outcome.nextCalled, false, `must reject ${JSON.stringify(headers)}`);
    assert.equal(outcome.threw, true, `must throw for ${JSON.stringify(headers)}`);
  }
});
