import { z } from 'zod';

/**
 * The sealed `EligibilityRule` noun — the reconciliation of three structurally
 * incompatible legacy shapes into ONE published language:
 *
 *   - coexistence/shadow-sync-job.ts : chainId `string`, threshold `minAmount?: bigint | minScore?`
 *   - chain/two-tier-provider.ts     : chainId branded, threshold `parameters: {...}`, 4 ruleTypes
 *   - worker/EligibilityRepository.ts: chainId `number`, threshold `minBalance: string`, no ruleType
 *
 * Each legacy site adapts inward via a one-function `toProtocolRule()` (the anti-corruption
 * layer); nothing downstream binds the local shapes. See
 * `grimoires/loa/proposals/eligibility-rule-reconciliation.md`.
 *
 * Two operator-sealed forks are encoded here:
 *   FORK-1 — `chainId` is a branded EIP-155 integer (string/number forms are lossy).
 *   FORK-2 — threshold amounts are decimal STRINGS, never `bigint` (JSON-/replay-safe per #283).
 */

/**
 * FORK-1: branded EIP-155 chain id. A positive integer, type-distinct from a plain
 * `number` so a stray `1` (or a string `"1"`) can never silently stand in for a chain id.
 * Distinct brand from the legacy lossy `core/ports` `ChainId` (which was `number | string`).
 */
export const ChainIdSchema = z.number().int().positive().brand<'ChainId'>();
export type ChainId = z.infer<typeof ChainIdSchema>;

/** The 4-variant superset — the worker shape inferred its type from context; surfacing it is strictly safer. */
export const EligibilityRuleType = z.enum([
  'token_balance',
  'nft_ownership',
  'score_threshold',
  'activity_check',
]);
export type EligibilityRuleType = z.infer<typeof EligibilityRuleType>;

/**
 * FORK-2: threshold as a discriminated union on `kind`, killing the three legacy encodings
 * (`minAmount: bigint` | `minBalance: string` | `parameters: {...}`). Amounts are STRINGS.
 * Each member is `.strict()` so a smuggled `bigint`/numeric-score/extra key is a hard parse failure.
 */
export const EligibilityThreshold = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('balance'), minAmount: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('score'), minScore: z.number() }).strict(),
  z.object({ kind: z.literal('ownership') }).strict(),
  z.object({ kind: z.literal('activity'), minActivity: z.number() }).strict(),
]);
export type EligibilityThreshold = z.infer<typeof EligibilityThreshold>;

/** The sealed rule. `.strict()` — extra keys are rejected, so legacy fields cannot leak through. */
export const EligibilityRuleSchema = z
  .object({
    /** Canonical id — reconciles `(none)` | `id` | `ruleId`. */
    ruleId: z.string().min(1),
    /** Scope — only the chain shape carried this; optional in the superset. */
    communityId: z.string().min(1).optional(),
    /** Semantic category the checker routes on. */
    ruleType: EligibilityRuleType,
    /** FORK-1 branded chain id. */
    chainId: ChainIdSchema,
    /** Optional: `score_threshold` needs no contract. */
    contractAddress: z.string().min(1).optional(),
    /** FORK-2 threshold parameters. */
    threshold: EligibilityThreshold,
  })
  .strict();

export type EligibilityRule = z.infer<typeof EligibilityRuleSchema>;
