import { OrderSchema, type Order, type Cta } from '@freeside/shadow-audit-protocol';
import type { AuditRequest, AuditServiceResult } from '@freeside/shadow-audit-service';
import type { AccessRiskAuditInputs, OrderRefusal } from '@freeside/ordering-protocol';

/**
 * The audit ACL — the anti-corruption layer (SDD §3) and the single swap point (SDD §8).
 *
 * `AuditPort` is the boundary the orchestrator depends on; the in-process `runAudit` wrapper
 * (`DeclaredLocalAuditAdapter`) and a future HTTP adapter (audit deployed near belts) both
 * satisfy it, so module→service is one adapter swap. `buildAuditRequest` is the ONLY place
 * the generic Order and the audit's sealed `Order` meet — and it validates through the audit's
 * `OrderSchema`, so a malformed audit Order fails closed here, not deep inside `runAudit`.
 */
export interface AuditPort {
  invoke(req: AuditRequest): Promise<AuditServiceResult>;
}

export interface OperatedCommunity {
  name: string;
  owner_wallet: string;
}

/**
 * Resolves which operated community owns a contract. The MVP is internal-only: the team
 * audits its OWN communities, so this is a config lookup (mirrors the audit's existing
 * `isOperatedCommunity` config). An unknown contract fails closed (`unknown-community`),
 * never a fabricated community — the audit must run against a real, owned community.
 */
export type OperatedCommunityRegistry = (contract: string) => OperatedCommunity | undefined;

export interface AuditAclOptions {
  community: OperatedCommunity;
  cta: Cta;
  /** Injected clock (deterministic). Unix seconds. */
  nowUnixSeconds: number;
  /** Anon MVP → false. Per-member records require auth + community binding (S4). */
  includeRecords: boolean;
}

export type AclResult = { ok: true; req: AuditRequest } | { ok: false; reason: string };

export function buildAuditRequest(inputs: AccessRiskAuditInputs, opts: AuditAclOptions): AclResult {
  const parsed = OrderSchema.safeParse({
    community: { name: opts.community.name, owner_wallet: opts.community.owner_wallet },
    source: { chain: inputs.chain, contract_address: inputs.contract },
    gating_rule: { kind: 'nft-balance', threshold: inputs.threshold ?? 1 },
    products: ['audit'],
    mode: 'lead-magnet',
  });
  if (!parsed.success) return { ok: false, reason: 'order failed audit OrderSchema validation' };
  const order: Order = parsed.data;
  return {
    ok: true,
    req: {
      order,
      snapshotDate: inputs.snapshot_date,
      isOperatedCommunity: true, // a resolved operated community is, by definition, operated
      nowUnixSeconds: opts.nowUnixSeconds,
      includeRecords: opts.includeRecords,
      cta: opts.cta,
    },
  };
}

/**
 * Sanitize an audit refusal into the PUBLIC failed.v1 refusal (SDD §13 M-8): keep the stable
 * code, drop the audit's raw `reason` (which can carry internal cause) in favor of a fixed
 * operator-safe line. The full diagnostic cause belongs on the private ops channel (deferred).
 */
const SAFE_REFUSAL_REASON: Record<string, string> = {
  'unsupported-gating': 'the requested gating rule is not supported',
  'unindexed-contract': 'the contract is not indexed for ownership reconstruction',
  'external-mode': 'this community cannot be served',
  'reconstruction-failed': 'ownership reconstruction could not be completed',
  'cohort-too-small': 'the result cohort is too small to report safely',
  'upstream-exhausted': 'an upstream data source was temporarily unavailable',
  'rate-limited': 'rate limit exceeded',
};

export function sanitizeRefusal(refusal: { code: string }): OrderRefusal {
  return {
    code: refusal.code,
    reason: SAFE_REFUSAL_REASON[refusal.code] ?? 'the order could not be fulfilled',
  };
}
