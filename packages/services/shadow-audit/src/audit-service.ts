/**
 * SDD §2/§4 — AuditService (the orchestration core).
 *
 * Composes mode + roles + ownership + score + eligibility into an AuditOutput.
 * HEXAGONAL: the service depends only on the ports below; concrete adapters
 * (SonarClient, ScoreProxy, role loader) are injected at the gateway. PURE
 * compute — it persists NOTHING (NFR-1); the run-event append is the gateway's
 * job. Any ownership-reconstruction failure becomes a typed refusal, never a
 * silently-wrong result.
 */

import {
  AuditOutputSchema,
  computeInputsHash,
  type AccessDecisionRecord,
  type AuditAggregate,
  type AuditOutput,
  type Cta,
  type Order,
  type Refusal,
} from '@freeside/shadow-audit-protocol';
import { classifyBand } from './eligibility-resolver.js';
import { resolveMode } from './mode-resolver.js';
import { resolveRoles, type RoleSnapshot } from './role-snapshot.js';
import { DEFAULT_K, holderTurnover, kAnonCohort, staleRiskBand } from './metrics.js';

/** Holder balances @ a block: lowercased address → total units held. */
export type Balances = Map<string, bigint>;

/** Ownership port — reconstructs holder balances (SonarClient satisfies this). */
export interface OwnershipSource {
  resolveSnapshotBlock(snapshotDate: string): Promise<number>;
  balancesAt(snapshotBlock: number): Promise<Balances>;
  currentBalances(): Promise<Balances>;
}

/** Whale/concentration port (ScoreProxy-backed). Best-effort. */
export interface WhaleSource {
  /** Top-holder concentration in [0,1] for a holder set. */
  concentration(balances: Balances): Promise<number>;
}

/** Role-snapshot port. */
export interface RoleSource {
  load(): Promise<RoleSnapshot | undefined>;
}

export interface AuditRequest {
  order: Order;
  /** YYYY-MM-DD (UTC). */
  snapshotDate: string;
  isOperatedCommunity: boolean;
  /** Injected clock (deterministic). */
  nowUnixSeconds: number;
  /** Authed + community-bound callers get per-member records; anon does not. */
  includeRecords: boolean;
  cta: Cta;
}

export interface AuditDeps {
  ownership: OwnershipSource;
  whale: WhaleSource;
  roles: RoleSource;
  /** k-anonymity threshold (default 5). */
  k?: number;
}

export type AuditServiceResult =
  | { ok: true; output: AuditOutput; uncertain: boolean; unmatchedRoleHolders: number }
  | { ok: false; refusal: Refusal };

function isoFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export async function runAudit(
  req: AuditRequest,
  deps: AuditDeps,
): Promise<AuditServiceResult> {
  const k = deps.k ?? DEFAULT_K;

  // 1. Mode — dogfood-full or refuse (external / no snapshot).
  const roleSnapshot = await deps.roles.load();
  const mode = resolveMode({
    isOperatedCommunity: req.isOperatedCommunity,
    roleSnapshot,
    nowUnixSeconds: req.nowUnixSeconds,
  });
  if (!mode.ok) return { ok: false, refusal: mode.refusal };
  // mode.ok guarantees roleSnapshot is present.
  const snapshot = roleSnapshot as RoleSnapshot;
  const { roleWallets, unmatched } = resolveRoles(snapshot);

  const threshold = BigInt(req.order.gating_rule.threshold);

  // 2. Ownership reconstruction (any failure → typed refusal, never silently wrong).
  let snapshotBlock: number;
  let snapBal: Balances;
  let curBal: Balances;
  try {
    snapshotBlock = await deps.ownership.resolveSnapshotBlock(req.snapshotDate);
    [snapBal, curBal] = await Promise.all([
      deps.ownership.balancesAt(snapshotBlock),
      deps.ownership.currentBalances(),
    ]);
  } catch (e) {
    return {
      ok: false,
      refusal: {
        code: 'reconstruction-failed',
        reason: `ownership reconstruction failed: ${(e as Error).message}`,
        retryable: true,
      },
    };
  }

  const qualifies = (m: Balances, w: string): boolean => (m.get(w) ?? 0n) >= threshold;

  // 3. Cohorts.
  const qualifiedSnapshot = [...snapBal.keys()].filter((w) => qualifies(snapBal, w));
  const soldLapsed = qualifiedSnapshot.filter((w) => !qualifies(curBal, w));
  const staleAccess = [...roleWallets].filter((w) => !qualifies(curBal, w)); // role, not currently qualified
  const newlyEligible = [...curBal.keys()].filter(
    (w) => qualifies(curBal, w) && !roleWallets.has(w),
  );

  // 4. Whale concentration (best-effort; clamped to [0,1]).
  let whale = 0;
  try {
    whale = await deps.whale.concentration(curBal);
  } catch {
    whale = 0;
  }
  whale = Math.min(1, Math.max(0, whale));

  // 5. Aggregate (k-anonymized cohorts + deterministic metrics).
  const aggregate: AuditAggregate = {
    holder_turnover: holderTurnover(soldLapsed.length, qualifiedSnapshot.length),
    sold_lapsed: kAnonCohort(soldLapsed.length, k),
    newly_eligible: kAnonCohort(newlyEligible.length, k),
    stale_access: kAnonCohort(staleAccess.length, k),
    whale_concentration: whale,
    stale_access_risk_band: staleRiskBand(staleAccess.length, roleWallets.size),
  };

  // 6. Determinism fingerprint → run_id (IMP-001/007).
  const inputs_hash = computeInputsHash({
    chain: req.order.source.chain,
    contract: req.order.source.contract_address,
    snapshot_block: snapshotBlock,
    rule: req.order.gating_rule,
  });
  const run_id = `run_${inputs_hash.slice(0, 24)}`;

  // 7. Per-member records (authed only).
  let records: AccessDecisionRecord[] | undefined;
  if (req.includeRecords) {
    const computed_at = isoFromUnix(req.nowUnixSeconds);
    const rule_id = `${req.order.gating_rule.kind}:${req.order.gating_rule.threshold}`;
    const mk = (wallet: string, holds_role: boolean): AccessDecisionRecord => ({
      wallet,
      community: req.order.community.name,
      holds_role,
      qualifies: qualifies(curBal, wallet),
      band: classifyBand(holds_role, qualifies(curBal, wallet)),
      evidence: { balance_at_snapshot: Number(snapBal.get(wallet) ?? 0n) },
      provenance: {
        rule_id,
        snapshot_block: snapshotBlock,
        computed_at,
        sources: ['sonar', 'role-snapshot'],
      },
    });
    records = [
      ...[...roleWallets].map((w) => mk(w, true)),
      ...newlyEligible.map((w) => mk(w, false)),
    ];
  }

  const output = AuditOutputSchema.parse({
    run_id,
    mode: 'dogfood-full',
    inputs_hash,
    aggregate,
    ...(records ? { records } : {}),
    cta: req.cta,
  });

  return { ok: true, output, uncertain: mode.uncertain, unmatchedRoleHolders: unmatched.length };
}
