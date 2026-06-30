/**
 * AccessDecisionRecord port tests — the pure policy reproduces badge.ts checkRoleUpgrades exactly.
 * Goal-tree: arrakis-access-control-plane-v1-svv0 · bead: arrakis-access-decision-port-k6ya (the pilot).
 */
import { describe, it, expect } from 'vitest';
import {
  badgeBasedPolicy,
  POLICY_MANAGED_ROLES,
  ACCESS_POLICY_VERSION,
  type MemberIntel,
} from '../access-decision';

const base: MemberIntel = {
  identityId: 'm1',
  onboardingComplete: true,
  badgeCount: 0,
  activityBalance: 0,
  tenureDays: 0,
  hasHelperBadge: false,
};
const roles = (m: Partial<MemberIntel>): string[] =>
  badgeBasedPolicy.decide({ ...base, ...m }).grants.map((g) => g.role);

describe('badgeBasedPolicy.decide — pure form of checkRoleUpgrades', () => {
  it('grants nothing until onboarding completes (checkRoleUpgrades:340)', () => {
    expect(roles({ onboardingComplete: false, badgeCount: 99, tenureDays: 999 })).toEqual([]);
  });

  it('engaged on 5+ badges OR 200+ activity (not below)', () => {
    expect(roles({ badgeCount: 5 })).toContain('engaged');
    expect(roles({ activityBalance: 200 })).toContain('engaged');
    expect(roles({ badgeCount: 4, activityBalance: 199 })).not.toContain('engaged');
  });

  it('veteran on 90+ days tenure (not below)', () => {
    expect(roles({ tenureDays: 90 })).toContain('veteran');
    expect(roles({ tenureDays: 89 })).not.toContain('veteran');
  });

  it('trusted on 10+ badges OR a helper badge (not below)', () => {
    expect(roles({ badgeCount: 10 })).toContain('trusted');
    expect(roles({ hasHelperBadge: true })).toContain('trusted');
    expect(roles({ badgeCount: 9, hasHelperBadge: false })).not.toContain('trusted');
  });

  it('a fully-qualified veteran earns all three', () => {
    expect(roles({ badgeCount: 12, activityBalance: 300, tenureDays: 120, hasHelperBadge: true }).sort()).toEqual(
      ['engaged', 'trusted', 'veteran'],
    );
  });

  it('every grant carries an auditable reason + the policy version', () => {
    const d = badgeBasedPolicy.decide({ ...base, badgeCount: 10, tenureDays: 90 });
    expect(d.policyVersion).toBe(ACCESS_POLICY_VERSION);
    expect(d.grants.every((g) => g.reason.length > 0)).toBe(true);
  });

  it('the policy only ever grants policy-managed roles (AUDIT scopes diffs to these)', () => {
    const granted = roles({ badgeCount: 99, activityBalance: 999, tenureDays: 999, hasHelperBadge: true });
    expect(granted.every((r) => POLICY_MANAGED_ROLES.includes(r))).toBe(true);
  });
});
