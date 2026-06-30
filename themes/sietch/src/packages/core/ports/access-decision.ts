/**
 * access-decision.ts — the hexagonal CORE of the access control-plane (the AccessDecisionRecord port).
 *
 * The missing center of the Shadow Mode / access region: given a member's intel (badges, activity, tenure),
 * what Discord roles SHOULD they hold? Today that policy lives IMPURE inside `themes/sietch/src/services/
 * badge.ts` `checkRoleUpgrades(memberId)` — tangled with I/O (`getMemberProfileById`, `getMemberBadgeCount`,
 * `getMemberActivity`, `memberHasBadge`). That tangle is why the policy is not composable: the AUDIT layer
 * can't diff "should-be vs actual" without a DB, the ENFORCE layer can't reuse the decision, and the rules
 * can't be unit-tested in isolation.
 *
 * This port is the PURE form of that same policy (rules unchanged, verbatim from `ROLE_THRESHOLDS` +
 * `checkRoleUpgrades`). I/O moves to the boundary: READ gathers `MemberIntel`, this port DECIDES the
 * should-be grants, AUDIT diffs them against actual roles (observe-before-enforce), ENFORCE applies them.
 * One pure function the whole control-plane composes around. Forged via the icebreaker pilot (2026-06-29);
 * goal-tree root: `arrakis-access-control-plane-v1-svv0`, this bead `arrakis-access-decision-port-k6ya`.
 */

/** What the policy reads about a member. Gathered by READ at the I/O boundary — NEVER fetched inside the port. */
export interface MemberIntel {
  readonly identityId: string
  /** policy short-circuits to no grants until onboarding completes (matches checkRoleUpgrades:340). */
  readonly onboardingComplete: boolean
  readonly badgeCount: number
  readonly activityBalance: number
  /** days since the member joined (membershipDays in checkRoleUpgrades:346). */
  readonly tenureDays: number
  readonly hasHelperBadge: boolean
}

/** One should-be access grant + WHY (auditable — the AUDIT layer surfaces the reason on a diff). */
export interface AccessGrant {
  readonly role: string
  readonly reason: string
}

/** The should-be access for a member — the port's pure output, the ground truth AUDIT/ENFORCE settle against. */
export interface AccessDecisionRecord {
  readonly identityId: string
  readonly grants: readonly AccessGrant[]
  readonly policyVersion: string
}

/** The hexagonal port — pure, no I/O. A different policy (score-tier, NFT-inventory) is a different impl. */
export interface AccessDecisionPort {
  decide(member: MemberIntel): AccessDecisionRecord
}

/** Canonical thresholds — verbatim from badge.ts `ROLE_THRESHOLDS` (the deployed policy). */
export const ROLE_THRESHOLDS = {
  engaged: { badgeCount: 5, activityBalance: 200 },
  veteran: { tenureDays: 90 },
  trusted: { badgeCount: 10 },
} as const

export const ACCESS_POLICY_VERSION = "badge-v1"

/**
 * The reference policy — the PURE form of `checkRoleUpgrades` (badge.ts:338-376). Same rules, no I/O, fully
 * testable. A member not yet onboarded gets no grants. Then: engaged (5+ badges OR 200+ activity), veteran
 * (90+ days), trusted (10+ badges OR a helper badge).
 */
export const badgeBasedPolicy: AccessDecisionPort = {
  decide(m: MemberIntel): AccessDecisionRecord {
    const grants: AccessGrant[] = []
    if (!m.onboardingComplete) {
      return { identityId: m.identityId, grants, policyVersion: ACCESS_POLICY_VERSION }
    }
    if (m.badgeCount >= ROLE_THRESHOLDS.engaged.badgeCount || m.activityBalance >= ROLE_THRESHOLDS.engaged.activityBalance) {
      grants.push({ role: "engaged", reason: `${m.badgeCount} badges / ${m.activityBalance} activity` })
    }
    if (m.tenureDays >= ROLE_THRESHOLDS.veteran.tenureDays) {
      grants.push({ role: "veteran", reason: `${m.tenureDays}d tenure` })
    }
    if (m.badgeCount >= ROLE_THRESHOLDS.trusted.badgeCount || m.hasHelperBadge) {
      grants.push({ role: "trusted", reason: m.hasHelperBadge ? "helper badge" : `${m.badgeCount} badges` })
    }
    return { identityId: m.identityId, grants, policyVersion: ACCESS_POLICY_VERSION }
  },
}

/** The set of role names this policy can grant — the AUDIT layer uses it to scope "actual roles" diffs to
 *  policy-managed roles only (a manually-assigned role outside this set is not a divergence). */
export const POLICY_MANAGED_ROLES: readonly string[] = ["engaged", "veteran", "trusted"]
