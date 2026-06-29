/**
 * access-decision-port.ts — the pluggable POLICY seam of the access control-plane.
 *
 * The audit produces an `AccessDecisionRecord` per subject carrying both sides — `holds_role` (actual) and
 * `qualifies` (should-be) — whose quadrant is the `band` (stale / missing / ok). Until now the should-be was
 * HARD-CODED to one policy: token-gating (`audit-service.ts:129` = `balance >= threshold`). This port
 * GENERALIZES that one step: a policy decides `qualifies` from a subject's evidence, and the SAME audit engine
 * diffs it against `holds_role` into the same band. Token-gating reads a balance; a badge policy reads
 * engagement; a score policy reads a tier — all the same interface, all producing the same record. One engine,
 * pluggable policies — the unified access control-plane (goal-tree `arrakis-access-control-plane-v1`).
 *
 * Forged via the icebreaker pilot 2026-06-29: "unify the record + generalize the engine." The record was
 * already unified here; this is the engine generalization. The badge policy
 * (`themes/sietch/src/packages/core/ports/access-decision.ts`) implements this interface as the second policy.
 */

/**
 * A pluggable access policy: decide the SHOULD-BE access (`qualifies`) for a subject from its evidence `E`.
 * The audit engine reads `holds_role` (actual) separately and bands the two — the policy owns only should-be.
 * The generator never settles its own verdict: `qualifies` is read by the engine into the record's band, not
 * asserted by the policy as a final decision.
 */
export interface AccessDecisionPort<E> {
  /** stable id recorded in the record's provenance (which policy decided this), e.g. `token-gating:5`. */
  readonly policyId: string
  /** does the subject qualify (should-be access) given its evidence? */
  qualifies(evidence: E): boolean
}

/**
 * The deployed reference policy: TOKEN-GATING. A subject qualifies iff its on-chain balance ≥ the gating
 * threshold. This is the exact rule `runAudit` hard-coded at `audit-service.ts:129`, extracted verbatim so the
 * engine can route through the port with byte-identical behavior — and so a different policy can be swapped in.
 */
export const tokenGatingPolicy = (threshold: bigint): AccessDecisionPort<bigint> => ({
  policyId: `token-gating:${threshold}`,
  qualifies: (balance) => balance >= threshold,
})

/** Engagement evidence a badge policy reads — the off-chain analogue of a balance. */
export interface BadgeEvidence {
  readonly badgeCount: number
  readonly activityBalance: number
  readonly tenureDays: number
  readonly hasHelperBadge: boolean
}

/** Community-configured role thresholds (the analogue of a gating threshold; e.g. sietch badge.ts ROLE_THRESHOLDS). */
export interface BadgeThresholds {
  readonly engaged: { readonly badgeCount: number; readonly activityBalance: number }
  readonly veteran: { readonly tenureDays: number }
  readonly trusted: { readonly badgeCount: number }
}

export type BadgeRole = 'engaged' | 'veteran' | 'trusted'

/**
 * The BADGE/engagement policy — a SECOND reference AccessDecisionPort, bound to one role. Interchangeable with
 * tokenGatingPolicy in the audit engine: it decides `qualifies` from engagement evidence instead of a balance,
 * and the engine bands it against `holds_role` the same way. Reproduces sietch badge.ts `checkRoleUpgrades`
 * rules exactly (engaged: 5+ badges OR 200+ activity · veteran: 90+ days · trusted: 10+ badges OR helper). This
 * is the badge policy WIRED into the unified seam (the second river into one engine).
 */
export const badgePolicy = (thresholds: BadgeThresholds, role: BadgeRole): AccessDecisionPort<BadgeEvidence> => ({
  policyId: `badge:${role}`,
  qualifies: (e) => {
    switch (role) {
      case 'engaged':
        return e.badgeCount >= thresholds.engaged.badgeCount || e.activityBalance >= thresholds.engaged.activityBalance
      case 'veteran':
        return e.tenureDays >= thresholds.veteran.tenureDays
      case 'trusted':
        return e.badgeCount >= thresholds.trusted.badgeCount || e.hasHelperBadge
    }
  },
})
