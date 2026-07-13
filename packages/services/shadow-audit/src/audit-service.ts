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
  sha256Hex,
  type AccessDecisionRecord,
  tokenGatingPolicy,
  type AuditAggregate,
  type AuditOutput,
  type Cta,
  type Order,
  type Refusal,
  diffShadow,
  type DiscrepancyReport,
} from '@freeside/shadow-audit-protocol';
import { classifyBand } from './eligibility-resolver.js';
import { resolveMode, type UncertaintyReason } from './mode-resolver.js';
import { collectionKey, resolveRoles, type RoleSnapshot } from './role-snapshot.js';
import { DEFAULT_K, holderTurnover, kAnonCohort, staleRiskBand } from './metrics.js';
import {
  maxBalanceAcross,
  qualifiesAnySource,
  reconstructUnion,
  sumAcross,
  UNION_SEMANTICS,
  walletsAcross,
  type SourceResolver,
} from './collection-union.js';

/** Holder balances @ a block: lowercased address → total units held. */
export type Balances = Map<string, bigint>;

/** Ownership port — reconstructs holder balances (SonarClient satisfies this). */
export interface OwnershipSource {
  resolveSnapshotBlock(args: { chain: string; contract: string; snapshotDate: string }): Promise<number>;
  balancesAt(args: { chain: string; contract: string; snapshotBlock: number }): Promise<Balances>;
  currentBalances(args: { chain: string; contract: string }): Promise<Balances>;
}

/** Whale/concentration port (ScoreProxy-backed). Best-effort. */
export interface WhaleSource {
  /** Top-holder concentration in [0,1] for a holder set. */
  concentration(balances: Balances): Promise<number>;
}

/** Role-snapshot port. */
export interface RoleSource {
  /**
   * The LATEST snapshot for `collection` (a `collectionKey()` string), or undefined when none is held.
   *
   * KEYED BY COLLECTION, not by community (S5-T1): a community gates several collections, each behind its
   * own Discord role. A source that ignores this argument and serves "the community's snapshot" would let
   * collection A's audit compute stale-access against collection B's role-holders.
   */
  load(collection: string): Promise<RoleSnapshot | undefined>;
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
  /**
   * S5-T3 — resolves the ADDRESSED deployment to the collection's FULL source set (the union).
   *
   * REQUIRED, deliberately: an optional resolver with a "just audit the one contract" default would
   * silently reinstate the single-source bug for any composition root that forgot to wire it — and
   * that bug's failure mode is branding every holder on the other chain as stale. No resolver ⇒ no
   * audit (`unindexed-contract`).
   */
  sources: SourceResolver;
  /** k-anonymity threshold (default 5). */
  k?: number;
}

export type AuditServiceResult =
  | {
      ok: true;
      output: AuditOutput;
      uncertain: boolean;
      /** WHY it is uncertain (stale export? unseeable members?) — so the reader is told which. */
      uncertainReasons: UncertaintyReason[];
      unmatchedRoleHolders: number;
    }
  | { ok: false; refusal: Refusal };

function isoFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

/** Clamp a bigint balance into the safe-integer range (MED-2): a huge ERC-1155
 *  balance must not silently lose precision when narrowed for evidence. */
function clampToSafe(b: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(b > max ? max : b);
}

export async function runAudit(
  req: AuditRequest,
  deps: AuditDeps,
): Promise<AuditServiceResult> {
  const k = deps.k ?? DEFAULT_K;

  // 1. Mode — dogfood-full or refuse (external / no snapshot).
  // The role snapshot is fetched for THIS audit's collection (S5-T1). A community gates several
  // collections; the Honeycomb audit must read the Honeycomb gate's role-holders, never a sibling's.
  const collectionId = collectionKey({
    chain: req.order.source.chain,
    contract: req.order.source.contract_address,
  });
  const loaded = await deps.roles.load(collectionId);
  // Belt and braces: a source that ignores the key (and hands back some OTHER collection's snapshot)
  // must not produce an audit. Treat it as "no snapshot for this collection" → the existing refusal
  // path. A refusal is recoverable; a wrong stale-access set presented as fact is not.
  const roleSnapshot =
    loaded && collectionKey(loaded.collection) === collectionId ? loaded : undefined;
  const mode = resolveMode({
    isOperatedCommunity: req.isOperatedCommunity,
    roleSnapshot,
    nowUnixSeconds: req.nowUnixSeconds,
    // The SAME k the aggregate k-anonymizes with — so the refusal cannot disclose a cohort the
    // success path suppresses (HIGH-1).
    k,
  });
  if (!mode.ok) return { ok: false, refusal: mode.refusal };
  // mode.ok guarantees roleSnapshot is present.
  const snapshot = roleSnapshot as RoleSnapshot;
  const { roleWallets, unmatched } = resolveRoles(snapshot);

  const threshold = BigInt(req.order.gating_rule.threshold);

  // 2. THE UNION (S5-T3). The order names ONE deployment; it merely ADDRESSES the collection. Reconstruct
  //    EVERY declared deployment — Honeycomb lives on ethereum AND berachain, and auditing one of them
  //    brands the other chain's holders as stale. An undeclared contract is REFUSED, never audited as if it
  //    stood alone (that assumption IS the bug).
  const addressed = {
    chain: req.order.source.chain,
    contract: req.order.source.contract_address,
  };
  const sources = deps.sources(addressed);
  if (!sources || sources.length === 0) {
    return {
      ok: false,
      refusal: {
        code: 'unindexed-contract',
        reason: `${addressed.chain}/${addressed.contract} is not a declared collection source — refusing rather than auditing it as a standalone collection`,
        retryable: false,
      },
    };
  }

  // Ownership reconstruction (any failure → typed refusal, never silently wrong). FAIL-CLOSED across the
  // union: if ANY declared source is unreachable we refuse the whole audit. A partial union is worse than no
  // audit — a holder present only on the missing chain reads as not-qualifying, which OVERSTATES stale access
  // in exactly the direction that revokes somebody's access.
  let perSource: Awaited<ReturnType<typeof reconstructUnion>>;
  try {
    perSource = await reconstructUnion(deps.ownership, sources, req.snapshotDate);
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
  const snapBals = perSource.map((p) => p.snapshot);
  const curBals = perSource.map((p) => p.current);

  // The should-be access is decided by a pluggable AccessDecisionPort — the engine no longer hard-codes the
  // policy. tokenGatingPolicy is the deployed default (balance >= threshold), byte-identical to before; a
  // badge or score policy is a drop-in swap (the unification: arrakis-access-control-plane-v1).
  const policy = tokenGatingPolicy(threshold);
  // `any-source` (UNION_SEMANTICS): qualified iff the threshold is met on AT LEAST ONE deployment. The
  // threshold is applied PER-SOURCE — never to a cross-chain sum, which would double-count a bridging token.
  const qualifies = (maps: readonly Balances[], w: string): boolean => qualifiesAnySource(policy, maps, w);

  // 3. Cohorts — every one of them now computed over the union.
  const qualifiedSnapshot = walletsAcross(snapBals).filter((w) => qualifies(snapBals, w));
  const soldLapsed = qualifiedSnapshot.filter((w) => !qualifies(curBals, w));
  const staleAccess = [...roleWallets].filter((w) => !qualifies(curBals, w)); // role, not currently qualified anywhere
  const newlyEligible = walletsAcross(curBals).filter(
    (w) => qualifies(curBals, w) && !roleWallets.has(w),
  );

  // 4. Whale concentration (best-effort; clamped to [0,1]) — over the SUMMED cross-chain supply.
  //    Summing is correct HERE and wrong for qualification: concentration is a share-of-supply metric, and a
  //    token exists on exactly one chain at a time, so a per-wallet cross-chain sum counts each live token
  //    once. Qualification stays `any-source` (see UNION_SEMANTICS). Summing here is also what makes the
  //    number DETERMINISTIC: computing it on "the deployment the caller happened to address" would give two
  //    different outputs for one `inputs_hash` (which fingerprints the whole source set, not the addressing).
  let whale = 0;
  try {
    whale = await deps.whale.concentration(sumAcross(curBals));
  } catch {
    whale = 0;
  }
  whale = Math.min(1, Math.max(0, whale));

  // 5. Aggregate (k-anonymized cohorts + deterministic metrics).
  const soldLapsedCohort = kAnonCohort(soldLapsed.length, k);
  let holder_turnover = holderTurnover(soldLapsed.length, qualifiedSnapshot.length);
  // BB-4: when the cohort is k-anon-suppressed, coarsen the ratio so it can't
  // back-compute the suppressed numerator from a known denominator.
  if (soldLapsedCohort.kind === 'bucketed') {
    holder_turnover = Math.round(holder_turnover * 10) / 10;
  }
  // Role coverage — the blind spot, stated (486383). The unmatched cohort is k-anon'd like every other
  // cohort; the RATIO is published only when it cannot back-compute a suppressed numerator: either the
  // cohort is exact (>= k), or it is empty (zero identifies nobody). "Rounding is not suppression."
  const unmatchedCohort = kAnonCohort(unmatched.length, k);
  const coverageRatioIsSafe = unmatchedCohort.kind === 'exact' || unmatched.length === 0;

  const aggregate: AuditAggregate = {
    holder_turnover,
    sold_lapsed: soldLapsedCohort,
    newly_eligible: kAnonCohort(newlyEligible.length, k),
    stale_access: kAnonCohort(staleAccess.length, k),
    whale_concentration: whale,
    stale_access_risk_band: staleRiskBand(staleAccess.length, roleWallets.size),
    unmatched_role_holders: unmatchedCohort,
    role_coverage: coverageRatioIsSafe ? mode.roleCoverage : null,
    coverage_uncertain: mode.uncertainReasons.includes('low-role-coverage'),
  };

  // 6. Determinism fingerprint → run_id (IMP-001/007). It covers the FULL source set + each source's
  //    snapshot block (S5-T3): a union of eth+bera and a bera-only run are DIFFERENT computations and must
  //    not collide on one run_id. ⚠ This CHANGES every inputs_hash/run_id, including single-source ones —
  //    a disclosed break (see computeInputsHash's header).
  const inputs_hash = computeInputsHash({
    sources: perSource.map((p) => ({
      chain: p.source.chain,
      contract: p.source.contract,
      snapshot_block: p.snapshot_block,
    })),
    rule: req.order.gating_rule,
  });
  const run_id = `run_${sha256Hex(`${inputs_hash}:${req.nowUnixSeconds}`).slice(0, 24)}`;

  // 7. The methodology settle-context (always present) + per-member records (authed only). rule_id is hoisted
  //    so the rule a buyer audits the delta against is the SAME rule the records were decided under.
  const rule_id = `${req.order.gating_rule.kind}:${req.order.gating_rule.threshold}`;
  // The block of the deployment the ORDER addressed — the anchor for the per-member evidence. The union's
  // OTHER blocks travel in `methodology.collection_sources`, so nothing is hidden: a reader can check a
  // wallet's evidence against the chain it actually holds on.
  const addressedRun =
    perSource.find(
      (p) =>
        p.source.chain === addressed.chain &&
        p.source.contract.toLowerCase() === addressed.contract.toLowerCase(),
    ) ?? perSource[0]!;
  const snapshotBlock = addressedRun.snapshot_block;
  let records: AccessDecisionRecord[] | undefined;
  if (req.includeRecords) {
    const computed_at = isoFromUnix(req.nowUnixSeconds);
    const mk = (wallet: string, holds_role: boolean): AccessDecisionRecord => ({
      wallet,
      community: req.order.community.name,
      holds_role,
      qualifies: qualifies(curBals, wallet),
      band: classifyBand(holds_role, qualifies(curBals, wallet)),
      // The balance on the deployment where the wallet holds the MOST — the one that decided its
      // qualification under `any-source`. NOT a cross-chain sum: evidence must be checkable against one
      // chain at one block, and a summed number is a holding the wallet has nowhere.
      evidence: { balance_at_snapshot: clampToSafe(maxBalanceAcross(snapBals, wallet)) },
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

  // The Comparison View — the migration delta (promotion/demotion/no_change), derived from the SAME records.
  // diffShadow was built-but-unconsumed; this is its first consumer (the buying-event report). Authed-only by
  // construction (it carries per-member wallets), so it travels with `records`.
  const comparison: DiscrepancyReport | undefined = records ? diffShadow(records) : undefined;
  // The methodology travels with the AUTHED delta only — NOT in the anon aggregate response, which must stay
  // byte-stable for freeside-dashboard's strict GET decode (onExcessProperty: error). It states the delta's TRUE
  // basis: the incumbent's roles @ snapshot.captured_at × CURRENT on-chain qualification (NOT evidence_block).
  const methodology = {
    rule_id,
    role_snapshot_at: snapshot.captured_at,
    evidence_block: snapshotBlock,
    sources: ['sonar', 'role-snapshot'],
    // S5-T3: the union is NAMED, never left for the reader to assume — and the exact deployments +
    // blocks it was computed over travel with it, so the run can be re-derived.
    union_semantics: UNION_SEMANTICS,
    collection_sources: perSource.map((p) => ({
      chain: p.source.chain,
      contract: p.source.contract,
      snapshot_block: p.snapshot_block,
    })),
  };

  const output = AuditOutputSchema.parse({
    run_id,
    mode: 'dogfood-full',
    inputs_hash,
    aggregate,
    ...(records ? { records, methodology } : {}),
    ...(comparison ? { comparison } : {}),
    cta: req.cta,
  });

  return {
    ok: true,
    output,
    uncertain: mode.uncertain,
    uncertainReasons: mode.uncertainReasons,
    unmatchedRoleHolders: unmatched.length,
  };
}
