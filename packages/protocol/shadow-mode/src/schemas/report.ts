/**
 * ShadowReport — a generated, read-only artifact (the access-audit report).
 *
 * The report REUSES the sealed `@freeside/shadow-audit-protocol` vocabulary
 * (bands, evidence, caveats) rather than inventing a parallel one (SDD §6,
 * PRD G-5). The `summary` is a loose record (the handoff shape); `records` is
 * the optional conformant `AccessDecisionRecord[]` for EVM-wallet subjects with
 * evidence. Caveats are mandatory.
 */

export interface ShadowReport {
  report_id: string;
  community_id: string;
  report_kind: 'access_audit';
  generated_at: string;
  summary: Record<string, unknown>;
  /** Optional per-wallet access decisions (shadow-audit AccessDecisionRecord shape). */
  records?: unknown[];
  caveats: string[];
}
