/**
 * Shared primitive schemas for the Shadow Access Audit protocol.
 *
 * Bands, not scores. Addresses validated for shape only — never silently
 * mutated (checksum casing is preserved for display; normalize explicitly
 * where determinism matters, e.g. computeInputsHash).
 */

import { z } from 'zod';

/**
 * EVM address — `0x` + 40 hex chars. Shape-only validation: NOT auto-lowercased
 * so checksum casing survives round-trips. Callers that need a canonical form
 * (the inputs_hash) lowercase explicitly.
 */
export const EthAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte hex address');
export type EthAddress = z.infer<typeof EthAddressSchema>;

/**
 * Chain identifier — the NUMERIC EVM chain id as a decimal string ("1", "80094").
 *
 * S5-T3: this used to be documented as a lowercase SLUG ("ethereum") while the runtime
 * (`ownership-source.ts`) refused any non-numeric chain — so a schema-VALID Order was
 * unreconstructable, and the failure surfaced deep in the adapter instead of at the boundary.
 * The chain id is now load-bearing in three places that must agree exactly: the collection
 * registry key (`<chain>/<contract>`), the chain-scoped sonar query, and this Order. A slug
 * would need a slug→id table, and a table is a place for the two sides to disagree silently.
 * So the type is tightened to what the system actually requires. Slug requests were ALREADY
 * failing (as `reconstruction-failed`); they now fail at the schema, which is the honest place.
 */
export const ChainSchema = z
  .string()
  .min(1)
  .regex(/^[0-9]+$/, 'chain must be a numeric EVM chain id (decimal string), e.g. "1" or "80094"');
export type Chain = z.infer<typeof ChainSchema>;

/** A block height — non-negative integer. */
export const BlockNumberSchema = z.number().int().nonnegative();

/**
 * Per-member access band. There is deliberately NO numeric score — access is
 * classified, never scored.
 *   ok      — holds_role === qualifies (access matches holdings)
 *   stale   — holds_role && !qualifies (access WITHOUT holdings — the confront set)
 *   missing — !holds_role && qualifies (holdings WITHOUT access — newly eligible)
 */
export const BandSchema = z.enum(['stale', 'missing', 'ok']);
export type Band = z.infer<typeof BandSchema>;

/** Aggregate stale-access risk — a band, never a raw score. */
export const RiskBandSchema = z.enum(['low', 'elevated', 'high']);
export type RiskBand = z.infer<typeof RiskBandSchema>;

/**
 * Audit mode. `external` is refused in v1 (ModeResolver, SKP-002); only
 * `dogfood-full` ever produces an audit output.
 */
export const AuditModeSchema = z.enum(['dogfood-full', 'external']);
export type AuditMode = z.infer<typeof AuditModeSchema>;

/** A data source contributing to a record's provenance. */
export const SourceSchema = z.enum(['sonar', 'score', 'role-snapshot']);
export type Source = z.infer<typeof SourceSchema>;
