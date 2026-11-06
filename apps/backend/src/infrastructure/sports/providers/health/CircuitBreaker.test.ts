import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from './CircuitBreaker';

test('transitions closed -> open -> half-open -> closed', () => {
  let t = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => t });

  assert.equal(breaker.currentState, 'closed');
  assert.equal(breaker.canAttempt(), true);

  breaker.recordFailure();
  assert.equal(breaker.currentState, 'closed');
  breaker.recordFailure();
  assert.equal(breaker.currentState, 'open');
  assert.equal(breaker.canAttempt(), false);

  t += 1000; // cooldown elapsed
  assert.equal(breaker.canAttempt(), true);
  assert.equal(breaker.currentState, 'half-open');

  breaker.recordSuccess();
  assert.equal(breaker.currentState, 'closed');
  assert.equal(breaker.canAttempt(), true);
});

test('half-open allows exactly one probe', () => {
  let t = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  breaker.recordFailure();
  assert.equal(breaker.currentState, 'open');
  t += 1000;
  assert.equal(breaker.canAttempt(), true); // probe reserved
  assert.equal(breaker.canAttempt(), false); // second probe blocked
  assert.equal(breaker.snapshot().halfOpenProbeInFlight, true);
});

test('a failed half-open probe re-opens the circuit', () => {
  let t = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => t });
  breaker.recordFailure();
  t += 1000;
  assert.equal(breaker.canAttempt(), true);
  breaker.recordFailure();
  assert.equal(breaker.currentState, 'open');
  assert.equal(breaker.canAttempt(), false);
});
