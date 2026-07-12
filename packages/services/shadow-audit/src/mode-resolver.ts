/**
 * SDD §2 — ModeResolver (AC-5).
 *
 * `dogfood-full` iff the community is one we operate AND a role snapshot
 * exists; otherwise `external` → REFUSE with the conversation hook (v1 cannot
 * serve external communities; no silent degradation). A stale snapshot does NOT
 * refuse — it serves `dogfood-full` with an uncertainty label so the confront
 * number is never presented as hard fact.
 *
 * This module OWNS the `uncertain` semantics. TWO things can cost us confidence,
 * and they are named separately so the caller can tell the reader WHICH
 * (bug 20260712-486383):
 *
 *   • `stale-snapshot`    — the export is older than its freshness threshold.
 *   • `low-role-coverage` — too few role-holders resolved to a wallet for the
 *     aggregate to mean anything. Below `ROLE_COVERAGE_FLOOR` this is not a
 *     label but a REFUSAL: every cohort would be computed over a matched set
 *     that the unmatched set dwarfs. Be honest about what we cannot see.
 */

import type { Refusal } from '@freeside/shadow-audit-protocol';
import { isSnapshotFresh, type RoleSnapshot } from './role-snapshot.js';
import {
  DEFAULT_K,
  ROLE_COVERAGE_CONFIDENT,
  ROLE_COVERAGE_FLOOR,
  kAnonCohort,
  roleCoverage,
} from './metrics.js';

export interface ModeContext {
  /** Is this a community we operate (a dogfood community)? */
  isOperatedCommunity: boolean;
  /** The role snapshot for the community, if one is available. */
  roleSnapshot?: RoleSnapshot;
  /** Injected clock (deterministic; no wall-clock in the resolver). */
  nowUnixSeconds: number;
  /**
   * k-anonymity threshold (default {@link DEFAULT_K}). The REFUSAL this resolver emits is returned
   * verbatim to callers, so it must suppress sub-k cohorts to the SAME k the aggregate uses —
   * otherwise the failure channel leaks what the success channel hides.
   */
  k?: number;
}

/** Why the audit is not fully confident. Empty ⇒ confident. */
export type UncertaintyReason = 'stale-snapshot' | 'low-role-coverage';

export type ModeResult =
  | {
      ok: true;
      mode: 'dogfood-full';
      snapshotFresh: boolean;
      uncertain: boolean;
      /** The named causes, in a stable order — so a reader is told WHICH, not just "directional". */
      uncertainReasons: UncertaintyReason[];
      /** matched / total role-holders, in [0,1]. */
      roleCoverage: number;
    }
  | { ok: false; refusal: Refusal };

const CONVERSATION_HOOK =
  "v1 audits only communities we operate — let's talk about running this for yours";

export function resolveMode(ctx: ModeContext): ModeResult {
  const k = ctx.k ?? DEFAULT_K;

  if (!ctx.isOperatedCommunity) {
    return {
      ok: false,
      refusal: {
        code: 'external-mode',
        reason: `community is not operated by us; ${CONVERSATION_HOOK}`,
        retryable: false,
      },
    };
  }
  if (!ctx.roleSnapshot) {
    return {
      ok: false,
      refusal: {
        code: 'external-mode',
        reason: `no role snapshot available; dogfood-full requires a role export`,
        retryable: false,
      },
    };
  }

  // Coverage is measured over ENTRIES (role-holders), not distinct wallets: two discord ids sharing a
  // wallet are two role-holders, and the question this answers is "how many of your people can we see?".
  const total = ctx.roleSnapshot.entries.length;
  const matched = ctx.roleSnapshot.entries.filter((e) => e.wallet).length;
  const coverage = roleCoverage(matched, total);

  // Below the floor the aggregate is MEANINGLESS, not merely uncertain → refuse, and NAME what we
  // cannot see. Not retryable: re-running changes nothing — the missing identity links do.
  if (coverage < ROLE_COVERAGE_FLOOR) {
    if (total === 0) {
      return {
        ok: false,
        refusal: {
          code: 'role-coverage-too-low',
          reason: 'the role snapshot contains no role-holders — there is nothing to audit',
          retryable: false,
        },
      };
    }

    // ── The REFUSAL must honor the SAME k-anonymity as the success path (HIGH-1) ──────────────
    // The reason string is returned VERBATIM to callers (audit-router: `c.json({ error: refusal })`).
    // Naming exact counts here would leak precisely what the aggregate suppresses: with total=6 and
    // matched=2, `unmatched = 6 - 2 = 4` — an EXACT sub-k cohort the success path publishes only as
    // `{bucketed '<5'}`. A rounded percentage is no safer: with an exact denominator it re-derives the
    // numerator. "Rounding is not suppression" (access-risk.ts) — and a failure channel that discloses
    // what the success channel hides is not a smaller leak, just a quieter one.
    //
    // A role set smaller than k cannot be reported on at all: publishing the denominator would itself
    // expose a sub-k cohort. That is what `cohort-too-small` already exists for.
    if (total < k) {
      return {
        ok: false,
        refusal: {
          code: 'cohort-too-small',
          reason:
            'the role set is too small to report on without identifying its members ' +
            `(k-anonymity, k=${k}). No audit can be served safely at this size.`,
          retryable: false,
        },
      };
    }

    // The denominator is safe to state exactly (total >= k) — it is a role-size, and access-risk.ts
    // publishes its denominator exactly for the same reason. The NUMERATOR is k-anonymized, and the
    // true coverage ratio is emitted ONLY when that numerator is exact; otherwise the reader gets the
    // floor comparison and no true-ratio-derived number at all.
    const matchedCohort = kAnonCohort(matched, k);
    const seen =
      matchedCohort.kind === 'exact'
        ? `only ${matchedCohort.value} of ${total} role-holders could be resolved to a wallet ` +
          `(${Math.round(coverage * 100)}% coverage; the floor is ${Math.round(ROLE_COVERAGE_FLOOR * 100)}%)`
        : `fewer than ${k} of your ${total} role-holders could be resolved to a wallet ` +
          `(below the ${Math.round(ROLE_COVERAGE_FLOOR * 100)}% coverage floor)`;

    return {
      ok: false,
      refusal: {
        code: 'role-coverage-too-low',
        reason:
          `${seen}. Every cohort would be computed over a matched set that the unmatched set dwarfs, ` +
          'so the audit would be confidently wrong. Link the missing members — or import them from ' +
          'your incumbent — and re-export.',
        retryable: false,
      },
    };
  }

  const fresh = isSnapshotFresh(ctx.roleSnapshot, ctx.nowUnixSeconds);
  const uncertainReasons: UncertaintyReason[] = [];
  if (!fresh) uncertainReasons.push('stale-snapshot');
  if (coverage < ROLE_COVERAGE_CONFIDENT) uncertainReasons.push('low-role-coverage');

  return {
    ok: true,
    mode: 'dogfood-full',
    snapshotFresh: fresh,
    uncertain: uncertainReasons.length > 0,
    uncertainReasons,
    roleCoverage: coverage,
  };
}
