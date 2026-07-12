/**
 * SDD §2 — ModeResolver (AC-5).
 *
 * `dogfood-full` iff the community is one we operate AND a role snapshot
 * exists; otherwise `external` → REFUSE with the conversation hook (v1 cannot
 * serve external communities; no silent degradation). A stale snapshot does NOT
 * refuse — it serves `dogfood-full` with an uncertainty label so the confront
 * number is never presented as hard fact.
 */

import type { Refusal } from '@freeside/shadow-audit-protocol';
import { isSnapshotFresh, type RoleSnapshot } from './role-snapshot.js';

export interface ModeContext {
  /** Is this a community we operate (a dogfood community)? */
  isOperatedCommunity: boolean;
  /** The role snapshot for the community, if one is available. */
  roleSnapshot?: RoleSnapshot;
  /** Injected clock (deterministic; no wall-clock in the resolver). */
  nowUnixSeconds: number;
}

export type ModeResult =
  | { ok: true; mode: 'dogfood-full'; snapshotFresh: boolean; uncertain: boolean }
  | { ok: false; refusal: Refusal };

const CONVERSATION_HOOK =
  "v1 audits only communities we operate — let's talk about running this for yours";

export function resolveMode(ctx: ModeContext): ModeResult {
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
  const fresh = isSnapshotFresh(ctx.roleSnapshot, ctx.nowUnixSeconds);
  return { ok: true, mode: 'dogfood-full', snapshotFresh: fresh, uncertain: !fresh };
}
