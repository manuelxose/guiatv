/**
 * Frozen provider eligibility registry (M05-A).
 *
 * This is the single source of truth for whether a provider may be selected.
 * `assertEligible` is the ONLY gate provider selection may use: it throws for
 * every provider that is not `approved`, which means a `prototype` provider
 * (implemented + tested) and a `blocked` provider (documented, no adapter)
 * are both unreachable through ordinary fallback.
 *
 * No adapter code exists for `google-search` or `flashscore`; their entries
 * exist only to document why they are never used.
 */

import {
  FootballProviderCapability,
  ProviderEligibility,
  ProviderId,
} from '../../../../domain/sports/football/provider-types';

export type ProviderAuthMode = 'none' | 'api_key';
export type ProviderRightsState = 'verified' | 'unverified' | 'prohibited';

export interface ProviderFreeQuota {
  kind: 'rolling_window' | 'monthly' | 'none';
  limit?: number;
  windowSeconds?: number;
}

export interface ProviderEligibilityRegistryEntry {
  id: ProviderId;
  name: string;
  authMode: ProviderAuthMode;
  envVarName?: string;
  docsUrl: string;
  freeQuota: ProviderFreeQuota;
  capabilities: readonly FootballProviderCapability[];
  competitions: readonly string[];
  eligibility: ProviderEligibility;
  legalNotes: string;
  rightsState: ProviderRightsState;
  lastReviewedOn: string;
}

function freezeEntry(entry: ProviderEligibilityRegistryEntry): ProviderEligibilityRegistryEntry {
  return Object.freeze({
    ...entry,
    freeQuota: Object.freeze({ ...entry.freeQuota }),
    capabilities: Object.freeze([...entry.capabilities]),
    competitions: Object.freeze([...entry.competitions]),
    eligibility: Object.freeze({ ...entry.eligibility }),
  });
}

export const providerEligibilityRegistry: Readonly<Record<string, ProviderEligibilityRegistryEntry>> =
  Object.freeze({
    openligadb: freezeEntry({
      id: 'openligadb',
      name: 'OpenLigaDB',
      authMode: 'none',
      docsUrl: 'https://www.openligadb.de/',
      freeQuota: { kind: 'none' },
      // Verified by probe (2026-11-06): getmatchdata returns fixtures, results,
      // goal events, venue and team metadata. NO live minute, NO lineups, NO
      // statistics, NO standings.
      capabilities: ['fixtures', 'results', 'events', 'venue', 'team_metadata'],
      competitions: ['bl1', 'bl2', 'bl3'],
      eligibility: {
        state: 'approved',
        reason: 'Free, anonymous, no-signup open data API verified by probe (2026-11-06).',
        evidenceRef: 'docs/sports-v2/m05-contract/M05-A-CONTRACT.md §Verified facts',
        approvedBy: 'owner',
      },
      legalNotes: 'Public API intended for reuse; no key, no cost, no scraping.',
      rightsState: 'verified',
      lastReviewedOn: '2026-11-06',
    }),
    'football-data-org': freezeEntry({
      id: 'football-data-org',
      name: 'football-data.org',
      authMode: 'api_key',
      envVarName: 'FOOTBALL_DATA_API_KEY',
      docsUrl: 'https://www.football-data.org/documentation/api',
      // Anonymous tier is 10 requests/minute (X-Requests-Available /
      // X-RequestCounter-Reset headers observed by probe, 2026-11-06).
      freeQuota: { kind: 'rolling_window', limit: 10, windowSeconds: 60 },
      // Capabilities are documented but tier-restricted: without a key the
      // matches/standings endpoints return 403, so this provider is a
      // prototype and never selected in ordinary fallback.
      capabilities: [
        'fixtures',
        'results',
        'live_score',
        'live_minute',
        'events',
        'lineups',
        'statistics',
        'standings',
        'team_metadata',
        'venue',
        'referee',
      ],
      // Probe 2026-11-09 with the owner's key: 13 competitions, standings and matches answer 200.
      competitions: ['SA', 'FL1', 'DED', 'PPL', 'ELC', 'BSA', 'PD', 'PL', 'BL1', 'CL'],
      eligibility: {
        state: 'approved',
        reason: 'Owner supplied the free API key and approved its use on 2026-11-09 (Serie A, Ligue 1, Eredivisie, Primeira, Championship, Brasileirão tables).',
        evidenceRef: 'docs/sports-v2/M07-UNIFIED-SOURCE.md',
        approvedBy: 'owner',
      },
      legalNotes: 'Free plan; attribution "Football data provided by the Football-Data.org API" shown on public pages.',
      rightsState: 'verified',
      lastReviewedOn: '2026-11-09',
    }),
    'footballdata-io': freezeEntry({
      id: 'footballdata-io',
      name: 'footballdata.io',
      authMode: 'api_key',
      envVarName: 'FOOTBALLDATA_IO_API_KEY',
      docsUrl: 'https://footballdata.io/documentation/endpoints/',
      // Probe 2026-11-09 (/account/usage): plan "free", 1000 requests, limit_type "monthly", league_limit 5.
      freeQuota: { kind: 'monthly', limit: 1000 },
      capabilities: ['fixtures', 'results', 'live_score', 'live_minute', 'statistics', 'standings', 'team_metadata', 'venue'],
      // Free key: La Liga (10), Premier League (15), UCL (45), UEL (46), World Cup (50).
      competitions: ['10', '15', '45', '46', '50'],
      eligibility: {
        state: 'approved',
        reason: 'Owner supplied the free API key and approved its use, including crests, on 2026-11-09.',
        evidenceRef: 'docs/sports-v2/M07-UNIFIED-SOURCE.md',
        approvedBy: 'owner',
      },
      legalNotes: 'Free plan, monthly quota; owner authorised use of crests and logos.',
      rightsState: 'verified',
      lastReviewedOn: '2026-11-09',
    }),
    'google-search': freezeEntry({
      id: 'google-search',
      name: 'Google Search',
      authMode: 'none',
      docsUrl: 'https://policies.google.com/terms',
      freeQuota: { kind: 'none' },
      capabilities: [],
      competitions: [],
      eligibility: {
        state: 'blocked',
        reason: 'Scraping Google Search results violates its ToS; reuse rights unverified. No adapter.',
        evidenceRef: 'docs/sports-v2/m05-contract/M05-A-CONTRACT.md §Absolute constraints (4)',
      },
      legalNotes: 'No scraping, no CAPTCHA/anti-bot bypass, no proxy rotation.',
      rightsState: 'prohibited',
      lastReviewedOn: '2026-11-06',
    }),
    flashscore: freezeEntry({
      id: 'flashscore',
      name: 'Flashscore',
      authMode: 'none',
      docsUrl: 'https://www.flashscore.es/',
      freeQuota: { kind: 'none' },
      capabilities: [],
      competitions: [],
      eligibility: {
        state: 'blocked',
        reason: 'Reuse rights unverified and no published API terms; scraping prohibited. No adapter.',
        evidenceRef: 'docs/sports-v2/m05-contract/M05-A-CONTRACT.md §Absolute constraints (4)',
      },
      legalNotes: 'No scraping of any site whose reuse rights are unverified.',
      rightsState: 'unverified',
      lastReviewedOn: '2026-11-06',
    }),
  });

export function getProviderEligibility(providerId: ProviderId): ProviderEligibilityRegistryEntry | undefined {
  return providerEligibilityRegistry[providerId];
}

export class ProviderNotEligibleError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly state: ProviderEligibility['state'],
    reason: string
  ) {
    super(`Provider "${providerId}" is not eligible (${state}): ${reason}`);
    this.name = 'ProviderNotEligibleError';
  }
}

/**
 * The ONLY way provider selection may admit a provider. Throws unless the
 * registry entry's state is `'approved'`.
 */
export function assertEligible(providerId: ProviderId): ProviderEligibilityRegistryEntry {
  const entry = getProviderEligibility(providerId);
  if (!entry) {
    throw new ProviderNotEligibleError(providerId, 'blocked', 'provider is not registered');
  }
  if (entry.eligibility.state !== 'approved') {
    throw new ProviderNotEligibleError(providerId, entry.eligibility.state, entry.eligibility.reason);
  }
  return entry;
}
