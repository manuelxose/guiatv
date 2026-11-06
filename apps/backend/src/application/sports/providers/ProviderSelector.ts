import {
  FootballProviderCapability,
  ProviderId,
} from '../../../domain/sports/football/provider-types';
import { assertEligible } from '../../../infrastructure/sports/providers/eligibility/providerEligibilityRegistry';

export interface SelectorCandidate {
  providerId: ProviderId;
  capabilities: FootballProviderCapability[];
  /** Declared competition coverage; empty means "unknown / all". */
  competitions: string[];
  /** Lower = preferred. */
  priority: number;
  /** 0..1, derived from circuit-breaker health. */
  reliability: number;
  /** Remaining quota; null = unlimited. */
  remainingQuota: number | null;
  /** ms since last successful update; lower = fresher. */
  freshnessMs: number;
  historicalQuality?: number;
}

export interface SelectorRequest {
  capability: FootballProviderCapability;
  competitionSlug?: string;
}

export interface CandidateDecision {
  providerId: ProviderId;
  selected: boolean;
  reasons: string[];
}

export interface SelectorDecision {
  selected: ProviderId | null;
  ordered: ProviderId[];
  candidates: CandidateDecision[];
}

/**
 * Deterministic provider selection. Order of gates and ranking:
 * legal eligibility (hard gate) -> capability -> coverage -> freshness ->
 * reliability -> remaining quota -> priority -> historical quality.
 * No randomness; every candidate carries a human-readable reason list.
 *
 * The eligibility gate is injectable for unit tests; production always uses
 * `assertEligible`, the only mechanism that admits a provider.
 */
export class ProviderSelector {
  private readonly eligibilityGate: (providerId: ProviderId) => void;

  constructor(eligibilityGate: (providerId: ProviderId) => void = assertEligible) {
    this.eligibilityGate = eligibilityGate;
  }

  select(request: SelectorRequest, candidates: SelectorCandidate[]): SelectorDecision {
    const decisions: CandidateDecision[] = [];
    const eligible: SelectorCandidate[] = [];

    for (const candidate of candidates) {
      const reasons: string[] = [];
      let ok = true;

      try {
        this.eligibilityGate(candidate.providerId);
      } catch (error) {
        reasons.push(`ineligible:${error instanceof Error ? error.message : String(error)}`);
        ok = false;
      }

      if (ok && !candidate.capabilities.includes(request.capability)) {
        reasons.push(`missing_capability:${request.capability}`);
        ok = false;
      }

      if (
        ok &&
        request.competitionSlug &&
        candidate.competitions.length > 0 &&
        !candidate.competitions.includes(request.competitionSlug)
      ) {
        reasons.push(`no_coverage:${request.competitionSlug}`);
        ok = false;
      }

      if (ok && candidate.remainingQuota !== null && candidate.remainingQuota <= 0) {
        reasons.push('quota_exhausted');
        ok = false;
      }

      if (!ok) {
        decisions.push({ providerId: candidate.providerId, selected: false, reasons });
        continue;
      }
      eligible.push(candidate);
    }

    eligible.sort((a, b) => {
      if (a.freshnessMs !== b.freshnessMs) return a.freshnessMs - b.freshnessMs;
      if (a.reliability !== b.reliability) return b.reliability - a.reliability;
      const qa = a.remainingQuota === null ? Number.POSITIVE_INFINITY : a.remainingQuota;
      const qb = b.remainingQuota === null ? Number.POSITIVE_INFINITY : b.remainingQuota;
      if (qa !== qb) return qb - qa;
      if (a.priority !== b.priority) return a.priority - b.priority;
      const hqa = a.historicalQuality ?? 0.5;
      const hqb = b.historicalQuality ?? 0.5;
      if (hqa !== hqb) return hqb - hqa;
      return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
    });

    const selected = eligible[0]?.providerId ?? null;
    const ordered = eligible.map((candidate) => candidate.providerId);
    for (const candidate of eligible) {
      decisions.push({
        providerId: candidate.providerId,
        selected: candidate.providerId === selected,
        reasons: ['eligible'],
      });
    }

    return { selected, ordered, candidates: decisions };
  }
}
