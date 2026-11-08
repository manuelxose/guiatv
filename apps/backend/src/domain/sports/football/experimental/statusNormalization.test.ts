import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProviderStatus } from './statusNormalization';

test('normalizes obscure status codes', () => {
  assert.equal(normalizeProviderStatus('HT'), 'halftime');
  assert.equal(normalizeProviderStatus('FT'), 'finished');
  assert.equal(normalizeProviderStatus('AET'), 'finished');
  assert.equal(normalizeProviderStatus('PEN'), 'finished');
  assert.equal(normalizeProviderStatus('ABD'), 'suspended');
  assert.equal(normalizeProviderStatus('PST'), 'postponed');
  assert.equal(normalizeProviderStatus('1H'), 'live');
  assert.equal(normalizeProviderStatus('NS'), 'scheduled');
  assert.equal(normalizeProviderStatus('WO'), 'cancelled');
});

test('normalizes German OpenLigaDB surface strings', () => {
  assert.equal(normalizeProviderStatus('Läuft'), 'live');
  assert.equal(normalizeProviderStatus('Beendet'), 'finished');
  assert.equal(normalizeProviderStatus('Halbzeit'), 'halftime');
  assert.equal(normalizeProviderStatus('Verschoben'), 'postponed');
  assert.equal(normalizeProviderStatus('Abgebrochen'), 'suspended');
});

test('falls back to the existing status map for known codes and unknowns', () => {
  assert.equal(normalizeProviderStatus('IN_PLAY'), 'live');
  assert.equal(normalizeProviderStatus('FINISHED'), 'finished');
  assert.equal(normalizeProviderStatus('something-weird'), 'scheduled');
});
