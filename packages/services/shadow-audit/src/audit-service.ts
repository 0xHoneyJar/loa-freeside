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
  type CohortCount,
  type Cta,
  type Order,
  type Refusal,
  diffShadow,
  type DiscrepancyReport,
  type DriftReport,
  SHADOW_AUDIT_PROTOCOL_VERSION,
} from '@freeside/shadow-audit-protocol';
import { classifyBand } from './eligibility-resolver.js';
import { resolveMode, type UncertaintyReason } from './mode-resolver.js';
import { resolveRoles, type RoleSnapshot } from './role-snapshot.js';
import { DEFAULT_K, holderTurnover, kAnonCohort, staleRiskBand } from './metrics.js';
import { redactEndpoints } from './rpc-pool.js';
import { computeDrift, countQualifying, roleMemberCount } from './drift-floors.js';
import {
  canonicalCollectionKey,
  maxBalanceAcross,
  qualifiesAnySource,
  reconstructUnion,
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

/** Persisted role data exists but cannot satisfy the current wire schema. Retrying cannot repair it. */
export class RoleSourceDataError extends Error {
  constructor() {
    super('role snapshot is incompatible with the current schema');
    this.name = 'RoleSourceDataError';
  }
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
      /**
       * The DRIFT REPORT (S5-T4) — always computed, because it needs ZERO identity data and is therefore the
       * only honest answer we have for a community with no wallet map (thj: ~0% coverage).
       *
       * Returned OUT OF BAND as well as on `output.drift`, because `output.drift` is emitted only with the
       * AUTHED delta: freeside-dashboard strict-decodes the anon GET with `onExcessProperty: error` at any
       * depth, so an anon-visible field would make it reject every 200. The anon HTML view renders from
       * THIS field instead — same report, no strict decoder to break.
       */
      drift: DriftReport;
    }
  | {
      ok: false;
      refusal: Refusal;
      /**
       * Present ONLY on `role-coverage-too-low`: the counts-only drift board, which needs ZERO identity
       * data and is therefore the one honest answer for a community with no wallet map. The aggregate is
       * refused; the drift still travels. (Every other refusal has nothing to compute a board from.)
       */
      drift?: DriftReport;
    };

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

  // 1. Resolve the COLLECTION first (review BLOCKING-1). The order names ONE deployment; it merely
  //    ADDRESSES the collection. The role snapshot must be keyed on the COLLECTION, not on the addressed
  //    deployment — otherwise a snapshot POSTed naming the berachain contract cannot be found by an audit
  //    addressed via the ethereum contract, and the audit refuses a community whose data is sitting right
  //    there under a sibling key. An undeclared contract is REFUSED, never audited as if it stood alone
  //    (that assumption IS the single-source bug).
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
  const collectionId = canonicalCollectionKey(sources);

  // 2. Mode — dogfood-full or refuse (external / no snapshot). A community gates SEVERAL collections;
  //    the Honeycomb audit must read the Honeycomb gate's role-holders, never a sibling's.
  let loaded: RoleSnapshot | undefined;
  try {
    loaded = await deps.roles.load(collectionId);
  } catch (error) {
    const corrupt = error instanceof RoleSourceDataError;
    return {
      ok: false,
      refusal: {
        code: corrupt ? 'reconstruction-failed' : 'upstream-exhausted',
        reason: corrupt ? 'role snapshot is invalid and must be re-ingested' : 'role snapshot source unavailable',
        retryable: !corrupt,
      },
    };
  }
  // Belt and braces: a source that ignores the key (and hands back some OTHER collection's snapshot)
  // must not produce an audit. The loaded snapshot names a DEPLOYMENT, so canonicalize it through the
  // SAME registry before comparing — comparing deployment keys is exactly the bug this fixes.
  const loadedSources = loaded ? deps.sources(loaded.collection) : undefined;
  const roleSnapshot =
    loaded && loadedSources && canonicalCollectionKey(loadedSources) === collectionId
      ? loaded
      : undefined;
  const mode = resolveMode({
    isOperatedCommunity: req.isOperatedCommunity,
    roleSnapshot,
    nowUnixSeconds: req.nowUnixSeconds,
    // The SAME k the aggregate k-anonymizes with — so the refusal cannot disclose a cohort the
    // success path suppresses (HIGH-1).
    k,
  });
  /**
   * A coverage refusal must STILL CARRY THE DRIFT (found by the first live settle probe, 2026-07-13).
   *
   * `role-coverage-too-low` refuses the WALLET-derived cohorts, and rightly so: at 1 resolvable wallet in
   * 515 they would be computed over a matched set the unmatched set dwarfs. But the DRIFT REPORT is
   * counts-only — role-member counts x on-chain holder counts, ZERO identity data — and it is precisely
   * what S5 built so that a community with NO wallet map could see its drift. Refusing before computing it
   * would deny the report to the exact community it exists for. thj (~0% coverage) is that community.
   *
   * So: the refusal stands (the aggregate is not served), and the drift board travels WITH it. The reader
   * gets the honest answer — "we cannot see your members, and here is your drift anyway".
   *
   * Every OTHER refusal returns immediately: without a role snapshot there are no role counts to compare,
   * and an unreconstructable union has no holder counts. Only this one has both halves in hand.
   */
  const coverageRefusal = !mode.ok && mode.refusal.code === 'role-coverage-too-low';
  if (!mode.ok && !coverageRefusal) return { ok: false, refusal: mode.refusal };
  // Present in both branches: the coverage refusal only fires when a snapshot was LOADED.
  const snapshot = roleSnapshot as RoleSnapshot;
  const { roleWallets, unmatched } = resolveRoles(snapshot);

  const threshold = BigInt(req.order.gating_rule.threshold);
  const policy = tokenGatingPolicy(threshold);

  // A coverage refusal needs the counts-only drift board, not historical cohorts. Read CURRENT holder
  // counts directly and skip block-at-date resolution plus historical transfer replay entirely. This is
  // the common thj path; making a polling 422 reconstruct history was an avoidable cost multiplier.
  if (coverageRefusal) {
    let currentBySource: { source: (typeof sources)[number]; balances: Balances }[];
    try {
      currentBySource = await Promise.all(
        sources.map(async (source) => ({
          source,
          balances: await deps.ownership.currentBalances(source),
        })),
      );
    } catch (error) {
      return {
        ok: false,
        refusal: {
          code: 'reconstruction-failed',
          reason: `ownership reconstruction failed: ${redactEndpoints((error as Error).message)}`,
          retryable: true,
        },
      };
    }
    return {
      ok: false,
      refusal: mode.refusal,
      drift: computeDrift({
        roleMembers: roleMemberCount(snapshot),
        perSource: currentBySource.map(({ source, balances }) => ({
          chain: source.chain,
          holders: countQualifying(policy, balances),
        })),
        k,
      }),
    };
  }

  // 3. THE UNION (S5-T3) — `sources` was resolved above. Reconstruct EVERY declared deployment:
  //    Honeycomb lives on ethereum AND berachain, and auditing one of them brands the other chain's
  //    holders as stale.
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
        // The message is SCRUBBED of any URL before it reaches the caller: this refusal is returned
        // verbatim (and access-risk is the ANONYMOUS teaser), and RPC endpoint URLs carry provider API
        // keys in the path (arrakis-qf5kc).
        reason: `ownership reconstruction failed: ${redactEndpoints((e as Error).message)}`,
        retryable: true,
      },
    };
  }
  const snapBals = perSource.map((p) => p.snapshot);
  const curBals = perSource.map((p) => p.current);

  // The should-be access is decided by a pluggable AccessDecisionPort — the engine no longer hard-codes the
  // policy. tokenGatingPolicy is the deployed default (balance >= threshold), byte-identical to before; a
  // badge or score policy is a drop-in swap (the unification: arrakis-access-control-plane-v1).
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

  // 4. Whale concentration. Match the public teaser's epistemic contract: without collection-specific
  // economic-supply reconciliation, a multi-source sum may count bridge escrow plus represented supply.
  // A failed source is equally unknown. Both are NULL, never 0 ("no whale risk").
  let whale: number | null = null;
  if (perSource.length === 1) {
    try {
      whale = await deps.whale.concentration(curBals[0]!);
      whale = Math.min(1, Math.max(0, whale));
    } catch {
      whale = null;
    }
  }

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
  const unmatchedCohort: CohortCount =
    unmatched.length === 0 ? { kind: 'exact', value: 0 } : kAnonCohort(unmatched.length, k);
  const coverageRatioIsSafe = unmatchedCohort.kind === 'exact';

  // 5b. THE DRIFT REPORT (S5-T4) — the answer that needs NO wallet map.
  //
  // Every cohort above is computed over the role-holders we could RESOLVE to a wallet. For thj that set is
  // ~0% of the role. This report is computed over COUNTS — role members vs on-chain holders — so it needs no
  // identity data at all, and the assumption-free side-by-side it leads with IS the drift the community needs
  // to see. Holder counts are per-source and CURRENT (drift against today's chain state — the same basis
  // `staleAccess` uses).
  //
  // Every count in it is k-anonymized, and when the role set is sub-k the FLOORS are suppressed (null) while
  // the audit still serves. Suppressing a field is not the same as refusing an answer: refusal is for a
  // MEANINGLESS answer (`role-coverage-too-low`), suppression is for an unsafe-to-publish derived field.
  const drift = computeDrift({
    roleMembers: roleMemberCount(snapshot),
    perSource: perSource.map((p) => ({
      chain: p.source.chain,
      holders: countQualifying(policy, p.current),
    })),
    k,
  });

  // THE COVERAGE REFUSAL, now carrying the drift (see the long note at the mode check). The aggregate is
  // NOT served — its cohorts would be computed over a matched set the unmatched set dwarfs — but the
  // counts-only board needs no wallet map, so the community still SEES its drift. That is the DoD.
  if (!mode.ok) {
    return { ok: false, refusal: mode.refusal, drift };
  }

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
  /**
   * The deployment a wallet's SNAPSHOT evidence was actually READ FROM — the one it held the MOST on at
   * the snapshot. This is deliberately not described as the source that decided CURRENT qualification:
   * a wallet may bridge between the snapshot and now, while this record's checkable evidence remains the
   * historical balance named by `evidence_source` + `snapshot_block`.
   *
   * This used to be the block of the CALLER-ADDRESSED deployment, which made the evidence
   * UNVERIFIABLE: the balance came from wherever the wallet held most, but the block cited a different
   * chain. A buyer re-deriving it would query the wrong chain at the wrong block and find a number that
   * does not match. This service's contract is settle-by-recompute — never trust the stored number — so
   * the evidence MUST name the source and block it can be recomputed against.
   */
  const evidenceRunFor = (wallet: string) => {
    let best = perSource[0]!;
    let bestBal = -1n;
    for (const p of perSource) {
      const bal = p.snapshot.get(wallet) ?? 0n;
      if (bal > bestBal) {
        bestBal = bal;
        best = p;
      }
    }
    return best;
  };
  let records: AccessDecisionRecord[] | undefined;
  if (req.includeRecords) {
    const computed_at = isoFromUnix(req.nowUnixSeconds);
    const mk = (wallet: string, holds_role: boolean): AccessDecisionRecord => {
      const run = evidenceRunFor(wallet);
      return {
        wallet,
        community: req.order.community.name,
        holds_role,
        qualifies: qualifies(curBals, wallet),
        band: classifyBand(holds_role, qualifies(curBals, wallet)),
        // The SNAPSHOT balance on the deployment where the wallet held the MOST. NOT a cross-chain sum:
        // evidence must be checkable against one chain at one block, and a summed number is a holding the
        // wallet has nowhere. Current qualification is evaluated separately across `curBals`.
        evidence: { balance_at_snapshot: clampToSafe(maxBalanceAcross(snapBals, wallet)) },
        provenance: {
          rule_id,
          // The block OF THE SOURCE the balance was read from — so `evidence_source` + `snapshot_block`
          // together re-derive `balance_at_snapshot` exactly.
          snapshot_block: run.snapshot_block,
          evidence_source: { chain: run.source.chain, contract: run.source.contract },
          computed_at,
          sources: ['sonar', 'role-snapshot'],
        },
      };
    };
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
  // The ADDRESSED deployment's block — the anchor for the historical `sold_lapsed` metric, which is
  // computed over the addressed source. It is NOT the per-member evidence anchor: each record now names
  // its own `evidence_source` + block (review BLOCKING-2), because a wallet's balance comes from
  // whichever deployment it holds most on.
  const addressedRun =
    perSource.find(
      (p) =>
        p.source.chain === addressed.chain &&
        p.source.contract.toLowerCase() === addressed.contract.toLowerCase(),
    ) ?? perSource[0]!;
  const methodology = {
    rule_id,
    role_snapshot_at: snapshot.captured_at,
    evidence_block: addressedRun.snapshot_block,
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

  // `drift` travels with the AUTHED delta, NOT the anon aggregate — the same constraint that keeps
  // `methodology` out of it: freeside-dashboard strict-decodes GET /v1/audit with `onExcessProperty: error`
  // AT ANY DEPTH, so ANY new anon-visible field (top-level or inside `aggregate`) makes it reject every 200
  // and render empty. That exact break already happened once (see audit-router.ts's GET handler). The anon
  // HUMAN surface renders the report from the out-of-band `drift` below, where nothing strict-decodes it.
  // Surfacing it in the anon JSON is a coordinated change with the dashboard, not a unilateral one.
  const output = AuditOutputSchema.parse({
    run_id,
    mode: 'dogfood-full',
    inputs_hash,
    protocol_version: SHADOW_AUDIT_PROTOCOL_VERSION,
    aggregate,
    ...(records ? { records, methodology, drift } : {}),
    ...(comparison ? { comparison } : {}),
    cta: req.cta,
  });

  return {
    ok: true,
    output,
    uncertain: mode.uncertain,
    uncertainReasons: mode.uncertainReasons,
    unmatchedRoleHolders: unmatched.length,
    drift,
  };
}
