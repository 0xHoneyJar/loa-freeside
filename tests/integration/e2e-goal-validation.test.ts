/**
 * E2E Goal Validation — Sprint 361, Task 4.3
 *
 * Validates all 7 PRD goals for cycle-043 (The Governance Substrate)
 * are met with evidence from code imports, test results, and structure.
 *
 * G-1: Single-source governance (no local reimplementation)
 * G-2: Full commons adoption (39+ symbols via barrel)
 * G-3: Enforcement SDK wired (evaluateGovernanceMutation + conservation factories)
 * G-4: ModelPerformanceEvent ready (4th variant in router)
 * G-5: Import discipline (ADR-001 Layer 3)
 * G-6: Safe rollout (dual-accept window)
 * G-7: Contract coverage (P0 vectors + nightly)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// ─── G-1: Single-Source Governance ──────────────────────────────────────────

describe('G-1: Single-source governance — no local reimplementation', () => {
  it('arrakis-governance.ts imports conservation factories from hounfour, not local', () => {
    const src = readFileSync(
      resolve(ROOT, 'themes/sietch/src/packages/core/protocol/arrakis-governance.ts'),
      'utf8',
    );
    expect(src).toContain("from '@0xhoneyjar/loa-hounfour/commons'");
    expect(src).not.toMatch(/function createBalanceConservation/);
    expect(src).not.toMatch(/function createNonNegativeConservation/);
  });

  it('audit-trail-service.ts imports hash functions from hounfour, not local', () => {
    const src = readFileSync(
      resolve(ROOT, 'packages/adapters/storage/audit-trail-service.ts'),
      'utf8',
    );
    expect(src).toContain("from '@0xhoneyjar/loa-hounfour/commons'");
    expect(src).not.toMatch(/function computeAuditEntryHash/);
    expect(src).not.toMatch(/function verifyAuditTrailIntegrity/);
  });

  it('governed-mutation-service.ts imports from hounfour, not local', () => {
    const src = readFileSync(
      resolve(ROOT, 'packages/adapters/storage/governed-mutation-service.ts'),
      'utf8',
    );
    expect(src).toContain("from '@0xhoneyjar/loa-hounfour/commons'");
  });
});

// ─── G-2: Full Commons Adoption ─────────────────────────────────────────────

describe('G-2: Full commons adoption — 39+ symbols accessible via barrel', () => {
  it('barrel exports foundation schemas', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.InvariantSchema).toBeDefined();
    expect(barrel.ConservationLawSchema).toBeDefined();
    expect(barrel.AuditEntrySchema).toBeDefined();
    expect(barrel.AuditTrailSchema).toBeDefined();
    expect(barrel.AUDIT_TRAIL_GENESIS_HASH).toBeDefined();
  });

  it('barrel exports governed resources', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.GovernedCreditsSchema).toBeDefined();
    expect(barrel.GovernedReputationSchema).toBeDefined();
    expect(barrel.GovernedFreshnessSchema).toBeDefined();
  });

  it('barrel exports hash chain operations', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.buildDomainTag).toBeTypeOf('function');
    expect(barrel.computeAuditEntryHash).toBeTypeOf('function');
    expect(barrel.verifyAuditTrailIntegrity).toBeTypeOf('function');
  });

  it('barrel exports enforcement SDK', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.evaluateGovernanceMutation).toBeTypeOf('function');
    expect(barrel.createBalanceConservation).toBeTypeOf('function');
    expect(barrel.createNonNegativeConservation).toBeTypeOf('function');
  });

  it('barrel exports dynamic contract', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.DynamicContractSchema).toBeDefined();
    expect(barrel.verifyMonotonicExpansion).toBeTypeOf('function');
  });

  it('barrel exports error taxonomy', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.InvariantViolationSchema).toBeDefined();
    expect(barrel.HashDiscontinuityErrorSchema).toBeDefined();
    expect(barrel.GovernanceErrorSchema).toBeDefined();
  });
});

// ─── G-3: Enforcement SDK Wired ─────────────────────────────────────────────

describe('G-3: Enforcement SDK wired — evaluateGovernanceMutation + conservation factories', () => {
  it('arrakis-governance.ts uses evaluateGovernanceMutation', () => {
    const src = readFileSync(
      resolve(ROOT, 'themes/sietch/src/packages/core/protocol/arrakis-governance.ts'),
      'utf8',
    );
    expect(src).toContain('evaluateGovernanceMutation');
  });

  it('LOT_CONSERVATION and ACCOUNT_NON_NEGATIVE are exported from barrel', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.LOT_CONSERVATION).toBeDefined();
    expect(barrel.ACCOUNT_NON_NEGATIVE).toBeDefined();
  });

  it('authorizeCreditMutation is exported from barrel', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.authorizeCreditMutation).toBeTypeOf('function');
  });
});

// ─── G-4: ModelPerformanceEvent Ready ───────────────────────────────────────

describe('G-4: ModelPerformanceEvent ready — 4th variant in router', () => {
  it('reputation-event-router.ts handles model_performance variant', () => {
    const src = readFileSync(
      resolve(ROOT, 'packages/adapters/agent/reputation-event-router.ts'),
      'utf8',
    );
    expect(src).toContain("case 'model_performance'");
    expect(src).toContain("case 'quality_signal'");
    expect(src).toContain("case 'task_completed'");
    expect(src).toContain("case 'credential_update'");
  });

  it('exhaustive switch has never type check', () => {
    const src = readFileSync(
      resolve(ROOT, 'packages/adapters/agent/reputation-event-router.ts'),
      'utf8',
    );
    expect(src).toContain('const _exhaustive: never');
  });

  it('barrel exports ModelPerformanceEventSchema', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.ModelPerformanceEventSchema).toBeDefined();
    expect(barrel.QualityObservationSchema).toBeDefined();
  });
});

// ─── G-5: Import Discipline ─────────────────────────────────────────────────

describe('G-5: Import discipline — ADR-001 Layer 3', () => {
  it('contract.json includes /commons entrypoint with 40+ symbols', () => {
    const contract = JSON.parse(
      readFileSync(resolve(ROOT, 'spec/contracts/contract.json'), 'utf8'),
    );
    // contract.json uses array format with specifier fields
    const commons = (contract.entrypoints as { specifier: string; symbols: string[] }[])
      .find((e) => e.specifier === '@0xhoneyjar/loa-hounfour/commons');
    expect(commons).toBeDefined();
    expect(commons!.symbols.length).toBeGreaterThanOrEqual(40);
  });

  it('arrakis-dynamic-contract.ts imports from hounfour/commons, not direct paths', () => {
    const src = readFileSync(
      resolve(ROOT, 'themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts'),
      'utf8',
    );
    expect(src).toContain("from '@0xhoneyjar/loa-hounfour/commons'");
  });
});

// ─── G-6: Safe Rollout ──────────────────────────────────────────────────────

describe('G-6: Safe rollout — dual-accept window', () => {
  it('arrakis-compat.ts supports dual-accept window (7.11.0 + 8.2.0)', () => {
    const src = readFileSync(
      resolve(ROOT, 'themes/sietch/src/packages/core/protocol/arrakis-compat.ts'),
      'utf8',
    );
    expect(src).toContain("'8.2.0'");
    expect(src).toContain("'7.11.0'");
  });

  it('CONTRACT_VERSION is 8.2.0', async () => {
    const barrel = await import(
      '../../themes/sietch/src/packages/core/protocol/index.js'
    );
    expect(barrel.CONTRACT_VERSION).toBe('8.2.0');
  });
});

// ─── G-7: Contract Coverage ─────────────────────────────────────────────────

describe('G-7: Contract coverage — P0 vectors exist', () => {
  it('P0 conformance vector file exists', () => {
    expect(existsSync(resolve(ROOT, 'spec/conformance/test-commons-p0.ts'))).toBe(true);
  });

  it('default dynamic contract file exists', () => {
    expect(existsSync(resolve(ROOT, 'config/dynamic-contract.json'))).toBe(true);
  });

  it('dynamic contract has 4 reputation surfaces', () => {
    const contract = JSON.parse(
      readFileSync(resolve(ROOT, 'config/dynamic-contract.json'), 'utf8'),
    );
    expect(Object.keys(contract.surfaces)).toEqual(['cold', 'warming', 'established', 'authoritative']);
  });

  it('audit trail migration file exists', () => {
    expect(existsSync(resolve(ROOT, 'packages/adapters/storage/migrations/0004_audit_trail.sql'))).toBe(true);
  });
});
