import { describe, it, expect } from 'vitest';
import {
  ChainIdSchema,
  EligibilityRuleSchema,
  type EligibilityRule,
  EligibilityVerdictSchema,
} from '../index.js';

// =============================================================================
// (a) Canonical samples validate
// =============================================================================

describe('canonical samples', () => {
  it('a canonical EligibilityRule validates', () => {
    const rule = {
      ruleId: 'rule-1',
      communityId: 'guild-1',
      ruleType: 'token_balance',
      chainId: ChainIdSchema.parse(1),
      contractAddress: '0xabc',
      threshold: { kind: 'balance', minAmount: '1000000000000000000' },
    };
    expect(EligibilityRuleSchema.safeParse(rule).success).toBe(true);
  });

  it('the eligible / ineligible / degraded verdicts each validate', () => {
    expect(
      EligibilityVerdictSchema.safeParse({ status: 'eligible', source: 'native', tier: 'gold', score: 42 })
        .success,
    ).toBe(true);
    expect(
      EligibilityVerdictSchema.safeParse({
        status: 'ineligible',
        source: 'native',
        reason: 'below minimum balance',
        code: 'INELIGIBLE_BALANCE',
      }).success,
    ).toBe(true);
    expect(
      EligibilityVerdictSchema.safeParse({
        status: 'degraded',
        source: 'native_degraded',
        reason: 'score checker cannot evaluate token_balance',
        code: 'DEGRADED_UNSUPPORTED_RULE',
      }).success,
    ).toBe(true);
  });
});

// =============================================================================
// (b) Round-trip meter (G-1): the 3 legacy shapes adapt inward without loss
//     on chainId and threshold. Local fixtures only — the real adapters land in
//     sprints 404/405; this proves the unified noun CAN hold all three losslessly.
// =============================================================================

// --- Legacy 1: coexistence/shadow-sync-job.ts:121 (chainId string, minAmount bigint) ---
interface CoexistenceRule {
  ruleType: 'token_balance' | 'nft_ownership' | 'score_threshold';
  chainId: string;
  contractAddress: string;
  minAmount?: bigint;
  minScore?: number;
}
function coexistenceToProtocol(r: CoexistenceRule): EligibilityRule {
  const threshold =
    r.minAmount !== undefined
      ? { kind: 'balance' as const, minAmount: r.minAmount.toString() }
      : r.minScore !== undefined
        ? { kind: 'score' as const, minScore: r.minScore }
        : { kind: 'ownership' as const };
  return EligibilityRuleSchema.parse({
    ruleId: `${r.ruleType}:${r.contractAddress}`,
    ruleType: r.ruleType,
    chainId: ChainIdSchema.parse(Number(r.chainId)),
    contractAddress: r.contractAddress,
    threshold,
  });
}

// --- Legacy 2: chain/two-tier-provider.ts:41 (chainId branded number, parameters bag) ---
interface ChainRule {
  id: string;
  communityId: string;
  ruleType: 'token_balance' | 'nft_ownership' | 'score_threshold' | 'activity_check';
  chainId: number;
  contractAddress: string;
  parameters: { minAmount?: string; minActivity?: number };
}
function chainToProtocol(r: ChainRule): EligibilityRule {
  const threshold =
    r.parameters.minAmount !== undefined
      ? { kind: 'balance' as const, minAmount: r.parameters.minAmount }
      : r.parameters.minActivity !== undefined
        ? { kind: 'activity' as const, minActivity: r.parameters.minActivity }
        : { kind: 'ownership' as const };
  return EligibilityRuleSchema.parse({
    ruleId: r.id,
    communityId: r.communityId,
    ruleType: r.ruleType,
    chainId: ChainIdSchema.parse(r.chainId),
    contractAddress: r.contractAddress,
    threshold,
  });
}

// --- Legacy 3: worker/EligibilityRepository.ts:36 (chainId number, minBalance string, no ruleType) ---
interface WorkerRule {
  ruleId: string;
  minBalance: string;
  chainId: number;
}
function workerToProtocol(r: WorkerRule): EligibilityRule {
  return EligibilityRuleSchema.parse({
    ruleId: r.ruleId,
    ruleType: 'token_balance', // worker had no ruleType; inferred (the proposal: surfacing it is strictly safer)
    chainId: ChainIdSchema.parse(r.chainId),
    threshold: { kind: 'balance', minAmount: r.minBalance },
  });
}

describe('round-trip meter (G-1) — no loss on chainId and threshold', () => {
  it('coexistence shape: chainId string + bigint amount round-trips losslessly', () => {
    const original: CoexistenceRule = {
      ruleType: 'token_balance',
      chainId: '8453',
      contractAddress: '0xdead',
      minAmount: 1000000000000000000n,
    };
    const unified = coexistenceToProtocol(original);
    // chainId: string "8453" → branded 8453 → back to string "8453"
    expect(String(unified.chainId)).toBe(original.chainId);
    // threshold: bigint → string → bigint, no precision loss
    expect(unified.threshold.kind).toBe('balance');
    if (unified.threshold.kind === 'balance') {
      expect(BigInt(unified.threshold.minAmount)).toBe(original.minAmount);
    }
  });

  it('chain shape: branded chainId + string amount round-trips losslessly', () => {
    const original: ChainRule = {
      id: 'r-2',
      communityId: 'g-2',
      ruleType: 'token_balance',
      chainId: 1,
      contractAddress: '0xbeef',
      parameters: { minAmount: '500' },
    };
    const unified = chainToProtocol(original);
    expect(Number(unified.chainId)).toBe(original.chainId);
    if (unified.threshold.kind === 'balance') {
      expect(unified.threshold.minAmount).toBe(original.parameters.minAmount);
    }
  });

  it('worker shape: numeric chainId + string minBalance round-trips losslessly', () => {
    const original: WorkerRule = { ruleId: 'r-3', minBalance: '42', chainId: 137 };
    const unified = workerToProtocol(original);
    expect(Number(unified.chainId)).toBe(original.chainId);
    if (unified.threshold.kind === 'balance') {
      expect(unified.threshold.minAmount).toBe(original.minBalance);
    }
  });
});

// =============================================================================
// (c) Replay safety (G-1/G-4): JSON round-trip is lossless; a smuggled bigint or
//     a numeric (non-string) amount is a hard parse failure.
//     (AccessDecisionRecord's bands-only / no-numeric-score invariant is owned by
//      shadow-audit's own suite and is untouched by this package.)
// =============================================================================

describe('replay safety (G-4)', () => {
  const rule: EligibilityRule = EligibilityRuleSchema.parse({
    ruleId: 'replay-1',
    ruleType: 'score_threshold',
    chainId: ChainIdSchema.parse(1),
    threshold: { kind: 'score', minScore: 700 },
  });

  it('JSON stringify → parse → re-validate is lossless (replayable)', () => {
    const replayed = EligibilityRuleSchema.parse(JSON.parse(JSON.stringify(rule)));
    expect(replayed).toEqual(rule);
  });

  it('a smuggled bigint amount is a hard parse failure (FORK-2)', () => {
    const bad = {
      ruleId: 'bad-1',
      ruleType: 'token_balance',
      chainId: ChainIdSchema.parse(1),
      threshold: { kind: 'balance', minAmount: 100n as unknown as string },
    };
    expect(EligibilityRuleSchema.safeParse(bad).success).toBe(false);
  });

  it('a numeric (non-string) amount is a hard parse failure', () => {
    const bad = {
      ruleId: 'bad-2',
      ruleType: 'token_balance',
      chainId: ChainIdSchema.parse(1),
      threshold: { kind: 'balance', minAmount: 100 as unknown as string },
    };
    expect(EligibilityRuleSchema.safeParse(bad).success).toBe(false);
  });

  it('a non-integer / non-positive chainId is rejected (FORK-1)', () => {
    expect(ChainIdSchema.safeParse(1.5).success).toBe(false);
    expect(ChainIdSchema.safeParse(0).success).toBe(false);
    expect(ChainIdSchema.safeParse(-1).success).toBe(false);
    expect(ChainIdSchema.safeParse('1').success).toBe(false); // string form is lossy → rejected
  });
});

// =============================================================================
// (d) .strict() rejects extra keys (the legacy fields cannot leak through)
// =============================================================================

describe('strictness (.strict())', () => {
  it('an extra key on the rule is rejected', () => {
    const bad = {
      ruleId: 'strict-1',
      ruleType: 'token_balance',
      chainId: ChainIdSchema.parse(1),
      threshold: { kind: 'balance', minAmount: '1' },
      legacyMinAmount: 1n, // a leaked legacy field
    };
    expect(EligibilityRuleSchema.safeParse(bad).success).toBe(false);
  });

  it('an extra key inside the threshold is rejected', () => {
    const bad = {
      ruleId: 'strict-2',
      ruleType: 'token_balance',
      chainId: ChainIdSchema.parse(1),
      threshold: { kind: 'balance', minAmount: '1', tokenId: '7' },
    };
    expect(EligibilityRuleSchema.safeParse(bad).success).toBe(false);
  });

  it('a non-eligible verdict without reason+code is rejected (refuse-not-approximate)', () => {
    expect(EligibilityVerdictSchema.safeParse({ status: 'ineligible', source: 'native' }).success).toBe(
      false,
    );
    expect(
      EligibilityVerdictSchema.safeParse({ status: 'degraded', source: 'native_degraded' }).success,
    ).toBe(false);
  });

  it('an extra key on a verdict is rejected', () => {
    expect(
      EligibilityVerdictSchema.safeParse({
        status: 'eligible',
        source: 'native',
        sneaky: true,
      }).success,
    ).toBe(false);
  });
});
