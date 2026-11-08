/**
 * Experimental status normalization for provider status strings the existing
 * `FOOTBALL_STATUS_MAP` does not cover (OpenLigaDB German surface strings and
 * other obscure codes). Falls back to `normalizeMatchStatus` for the known set.
 */

import { FootballMatchStatus, normalizeMatchStatus } from '../types';

const OBSCURE_STATUS_MAP: Record<string, FootballMatchStatus> = {
  ns: 'scheduled',
  not_started: 'scheduled',
  '1h': 'live',
  '2h': 'live',
  et: 'live',
  extra_time: 'live',
  ht: 'halftime',
  half: 'halftime',
  ft: 'finished',
  aet: 'finished',
  pen: 'finished',
  penalties: 'finished',
  abd: 'suspended',
  abandoned: 'suspended',
  awd: 'cancelled',
  awarded: 'cancelled',
  wo: 'cancelled',
  walkover: 'cancelled',
  pst: 'postponed',
  ppd: 'postponed',
  susp: 'suspended',
  int: 'suspended',
  interrupted: 'suspended',
  canc: 'cancelled',
  can: 'cancelled',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  // German (OpenLigaDB) surface strings.
  beendet: 'finished',
  abgebrochen: 'suspended',
  verschoben: 'postponed',
  'läuft': 'live',
  laeuft: 'live',
  halbzeit: 'halftime',
  'verlängert': 'live',
  verlaengert: 'live',
};

export function normalizeProviderStatus(raw: unknown): FootballMatchStatus {
  const key = String(raw ?? '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(OBSCURE_STATUS_MAP, key)) {
    return OBSCURE_STATUS_MAP[key];
  }
  return normalizeMatchStatus(raw);
}
