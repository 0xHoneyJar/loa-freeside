/**
 * Access-audit report builder (SDD §6, AC-6).
 *
 * REUSES the sealed `@freeside/shadow-audit-protocol` vocabulary (bands,
 * RiskBand) rather than inventing a parallel one. The report is read-only and
 * carries MANDATORY caveats. The ledger is the durable backing the in-memory
 * audit-service lacked.
 */

import { RiskBandSchema, type RiskBand } from '@freeside/shadow-audit-protocol';
import type { ShadowReport, MemberGraphProjection } from '@freeside/shadow-mode-protocol';

/** Stale-access risk band from the divergence rate — bands, never a raw score. */
export function staleRiskBand(divergentRatio: number): RiskBand {
  // mirrors shadow-audit metrics: <5% low, <20% elevated, else high
  const band = divergentRatio < 0.05 ? 'low' : divergentRatio < 0.2 ? 'elevated' : 'high';
  return RiskBandSchema.parse(band);
}

const MANDATORY_CAVEATS = [
  'Shadow Mode is read-only — this report mutates no Discord roles.',
  'Wallet-only subjects are NOT person-level identities.',
  'Only identity-api verified links merge subjects.',
] as const;

export function buildAccessAuditReport(
  communityId: string,
  graph: MemberGraphProjection,
  generatedAt: string = new Date().toISOString(),
): ShadowReport {
  const nonMatch = graph.divergences.filter((d) => d.kind !== 'match');
  const total = graph.summary.total_subjects;
  const divergentRatio = total > 0 ? nonMatch.length / total : 0;

  return {
    report_id: `report:${communityId}:${generatedAt}`,
    community_id: communityId,
    report_kind: 'access_audit',
    generated_at: generatedAt,
    summary: {
      total_subjects: total,
      verified_subjects: graph.summary.identity_users,
      unresolved_subjects: graph.summary.unresolved,
      discord_members: graph.summary.discord_members,
      wallet_only_subjects: graph.summary.wallet_only,
      divergence_count: nonMatch.length,
      match_count: graph.divergences.filter((d) => d.kind === 'match').length,
      freeside_higher_count: graph.divergences.filter((d) => d.kind === 'freeside_higher').length,
      incumbent_higher_count: graph.divergences.filter((d) => d.kind === 'incumbent_higher').length,
      mismatch_count: graph.divergences.filter((d) => d.kind === 'mismatch').length,
      stale_access_risk_band: staleRiskBand(divergentRatio),
    },
    caveats: [...MANDATORY_CAVEATS],
  };
}
