/**
 * FR-2 / SDD §2 — EligibilityResolver (AC-3).
 *
 * v1 supports EXACTLY ONE sealed rule: single-contract NFT balance threshold
 * (`qualifies = balance@snapshot >= threshold`). Every other gating intent
 * (erc20-balance, LP/staked, multi-contract, allowlist, …) is REFUSED with a
 * typed `unsupported-gating` Refusal — never approximated.
 */

import { SUPPORTED_GATING_KIND } from '@freeside/shadow-audit-protocol';
import type { Band, Refusal } from '@freeside/shadow-audit-protocol';

/** A gating rule as *requested* (kind is open — may be out of scope). */
export interface RequestedGating {
  kind: string;
  threshold: number;
}

export type EligibilityResult =
  | { ok: true; qualifies: boolean }
  | { ok: false; refusal: Refusal };

/**
 * Resolve whether a wallet qualifies under the requested gating, or refuse if
 * the gating is out of v1 scope.
 */
export function resolveEligibility(
  gating: RequestedGating,
  balanceAtSnapshot: bigint,
): EligibilityResult {
  if (gating.kind !== SUPPORTED_GATING_KIND) {
    return {
      ok: false,
      refusal: {
        code: 'unsupported-gating',
        reason: `gating kind "${gating.kind}" is not supported (v1: single-contract ${SUPPORTED_GATING_KIND} only)`,
        retryable: false,
      },
    };
  }
  if (!Number.isInteger(gating.threshold) || gating.threshold <= 0) {
    return {
      ok: false,
      refusal: {
        code: 'unsupported-gating',
        reason: `invalid ${SUPPORTED_GATING_KIND} threshold: ${gating.threshold}`,
        retryable: false,
      },
    };
  }
  return { ok: true, qualifies: balanceAtSnapshot >= BigInt(gating.threshold) };
}

/**
 * Classify a member's access band from role vs qualification. Bands only — no
 * numeric score (SDD §3.2):
 *   ok      — role and qualification agree
 *   stale   — has role but no longer qualifies (the confront set)
 *   missing — qualifies but has no role (newly eligible)
 */
export function classifyBand(holdsRole: boolean, qualifies: boolean): Band {
  if (holdsRole === qualifies) return 'ok';
  return holdsRole ? 'stale' : 'missing';
}
