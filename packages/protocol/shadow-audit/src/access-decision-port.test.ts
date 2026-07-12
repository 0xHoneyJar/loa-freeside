import { describe, it, expect } from 'vitest';
import { tokenGatingPolicy, badgePolicy, type AccessDecisionPort, type BadgeThresholds, type BadgeEvidence } from './access-decision-port.js';

// the deployed sietch thresholds (badge.ts ROLE_THRESHOLDS), passed as community config.
const TH: BadgeThresholds = { engaged: { badgeCount: 5, activityBalance: 200 }, veteran: { tenureDays: 90 }, trusted: { badgeCount: 10 } };
const ev = (o: Partial<BadgeEvidence> = {}): BadgeEvidence => ({ badgeCount: 0, activityBalance: 0, tenureDays: 0, hasHelperBadge: false, ...o });

describe('AccessDecisionPort — the pluggable policy seam (one engine, many policies)', () => {
  it('tokenGatingPolicy: qualifies iff balance >= threshold — byte-identical to the old hard-coded rule (audit-service:129)', () => {
    const p = tokenGatingPolicy(5n);
    expect(p.qualifies(5n)).toBe(true); // >= boundary, exactly as before
    expect(p.qualifies(6n)).toBe(true);
    expect(p.qualifies(4n)).toBe(false);
    expect(p.qualifies(0n)).toBe(false);
    expect(p.policyId).toBe('token-gating:5');
  });

  it('a BADGE policy fits the SAME interface — proving the engine generalizes, not just token-gating', () => {
    // A different policy reads different evidence (engagement, not balance) but is the same AccessDecisionPort:
    // the audit engine bands its `qualifies` against `holds_role` exactly the same way.
    type Engagement = { badgeCount: number };
    const badgeEngagedPolicy: AccessDecisionPort<Engagement> = {
      policyId: 'badge:engaged',
      qualifies: (e) => e.badgeCount >= 5,
    };
    expect(badgeEngagedPolicy.qualifies({ badgeCount: 5 })).toBe(true);
    expect(badgeEngagedPolicy.qualifies({ badgeCount: 4 })).toBe(false);
  });

  it('both policies are interchangeable AccessDecisionPorts — the unified seam', () => {
    const policies: AccessDecisionPort<any>[] = [tokenGatingPolicy(10n), { policyId: 'badge:trusted', qualifies: (e: { badgeCount: number }) => e.badgeCount >= 10 }];
    expect(policies.every((p) => typeof p.qualifies === 'function' && p.policyId.length > 0)).toBe(true);
    // the engine swaps policy without changing how it bands the result — that is the generalization.
    expect(policies[0]!.qualifies(10n)).toBe(true);
    expect(policies[1]!.qualifies({ badgeCount: 10 })).toBe(true);
  });
});

describe('badgePolicy — the SECOND policy, wired into the same seam (reproduces badge.ts checkRoleUpgrades)', () => {
  it('engaged: 5+ badges OR 200+ activity (not below)', () => {
    expect(badgePolicy(TH, 'engaged').qualifies(ev({ badgeCount: 5 }))).toBe(true);
    expect(badgePolicy(TH, 'engaged').qualifies(ev({ activityBalance: 200 }))).toBe(true);
    expect(badgePolicy(TH, 'engaged').qualifies(ev({ badgeCount: 4, activityBalance: 199 }))).toBe(false);
  });

  it('veteran: 90+ days tenure (not below)', () => {
    expect(badgePolicy(TH, 'veteran').qualifies(ev({ tenureDays: 90 }))).toBe(true);
    expect(badgePolicy(TH, 'veteran').qualifies(ev({ tenureDays: 89 }))).toBe(false);
  });

  it('trusted: 10+ badges OR a helper badge (not below)', () => {
    expect(badgePolicy(TH, 'trusted').qualifies(ev({ badgeCount: 10 }))).toBe(true);
    expect(badgePolicy(TH, 'trusted').qualifies(ev({ hasHelperBadge: true }))).toBe(true);
    expect(badgePolicy(TH, 'trusted').qualifies(ev({ badgeCount: 9, hasHelperBadge: false }))).toBe(false);
  });

  it('policyId carries the role (recorded in the record provenance — which policy decided)', () => {
    expect(badgePolicy(TH, 'engaged').policyId).toBe('badge:engaged');
  });

  it('badge + token-gating are interchangeable AccessDecisionPorts — one engine, two rivers', () => {
    const ports: AccessDecisionPort<any>[] = [tokenGatingPolicy(5n), badgePolicy(TH, 'engaged'), badgePolicy(TH, 'trusted')];
    expect(ports.every((p) => typeof p.qualifies === 'function' && p.policyId.length > 0)).toBe(true);
  });
});
