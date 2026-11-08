import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminAccessGuard } from './adminAccessGuard';
import { UnauthorizedError } from '../../shared/errors';

function fakeReq(headers: Record<string, string> = {}) {
  return {
    headers,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function fakeAuthService(user: { id: string; role: string } | null) {
  return {
    getSession: async (_token: string) => {
      if (!user) throw new UnauthorizedError('invalid session');
      return user;
    },
  };
}

async function runGuard(
  authService: unknown,
  req: unknown,
  envKey: string | undefined
): Promise<{ error?: { name?: string; message?: string }; nextCalled: boolean }> {
  const previous = process.env.ANALYTICS_ADMIN_KEY;
  if (envKey === undefined) delete process.env.ANALYTICS_ADMIN_KEY;
  else process.env.ANALYTICS_ADMIN_KEY = envKey;
  try {
    const guard = createAdminAccessGuard(authService as never);
    let passed: unknown = 'not-called';
    let nextCalled = false;
    await guard(req as never, {} as never, (err?: unknown) => {
      if (err) {
        passed = err;
      } else {
        nextCalled = true;
      }
    });
    if (nextCalled) return { nextCalled: true };
    return { error: passed as { name?: string; message?: string }, nextCalled: false };
  } finally {
    if (previous === undefined) delete process.env.ANALYTICS_ADMIN_KEY;
    else process.env.ANALYTICS_ADMIN_KEY = previous;
  }
}

/**
 * The single shared admin boundary (`createAdminAccessGuard`) must:
 *  - accept the shared key via `x-admin-key` OR `Bearer` (constant-time path),
 *  - accept an authenticated admin session,
 *  - reject non-admin sessions, missing credentials and near-miss keys,
 *  - fail closed when no key is configured AND no usable auth service exists.
 */

test('createAdminAccessGuard denies a request with no token and no admin key', async () => {
  const outcome = await runGuard(fakeAuthService(null), fakeReq(), undefined);
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.error?.name, 'UnauthorizedError');
});

test('createAdminAccessGuard denies an authenticated non-admin user', async () => {
  const outcome = await runGuard(
    fakeAuthService({ id: 'user-1', role: 'user' }),
    fakeReq({ authorization: 'Bearer token-123' }),
    undefined
  );
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.error?.name, 'ForbiddenError');
});

test('createAdminAccessGuard allows an authenticated admin user through', async () => {
  const outcome = await runGuard(
    fakeAuthService({ id: 'admin-1', role: 'admin' }),
    fakeReq({ authorization: 'Bearer token-123' }),
    undefined
  );
  assert.equal(outcome.nextCalled, true);
});

test('createAdminAccessGuard fails closed when no key and no usable auth service', async () => {
  // A request that carries a bearer token, but the auth service is missing —
  // must never be admitted.
  const outcome = await runGuard(undefined, fakeReq({ authorization: 'Bearer token-123' }), undefined);
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.error?.name, 'ForbiddenError');
});

test('createAdminAccessGuard accepts the exact key through either header', async () => {
  const viaHeader = await runGuard(
    fakeAuthService(null),
    fakeReq({ 'x-admin-key': 'secret-key' }),
    'secret-key'
  );
  assert.equal(viaHeader.nextCalled, true);

  const viaBearer = await runGuard(
    fakeAuthService(null),
    fakeReq({ authorization: 'Bearer secret-key' }),
    'secret-key'
  );
  assert.equal(viaBearer.nextCalled, true);
});

test('createAdminAccessGuard rejects every near-miss key', async () => {
  const cases: Array<Record<string, string>> = [
    { 'x-admin-key': 'secret-ke' }, // prefix of the real key
    { 'x-admin-key': 'secret-keyy' }, // real key plus one char
    { 'x-admin-key': 'Secret-Key' }, // case change
    { 'x-admin-key': '' }, // empty
    { 'x-admin-key': 'totally-different-key' }, // same length, different content
  ];
  for (const headers of cases) {
    const outcome = await runGuard(fakeAuthService(null), fakeReq(headers), 'secret-key');
    assert.equal(outcome.nextCalled, false, `must reject ${JSON.stringify(headers)}`);
  }
});

test('createAdminAccessGuard still verifies a session when a wrong key header is present', async () => {
  // A wrong x-admin-key must not block a valid admin session bearer token.
  const outcome = await runGuard(
    fakeAuthService({ id: 'admin-1', role: 'admin' }),
    fakeReq({ 'x-admin-key': 'wrong-key', authorization: 'Bearer token-123' }),
    'secret-key'
  );
  assert.equal(outcome.nextCalled, true);
});
