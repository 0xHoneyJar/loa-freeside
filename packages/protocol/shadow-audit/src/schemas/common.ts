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

/** Chain identifier as a lowercase slug (e.g. "ethereum", "berachain"). */
export const ChainSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, 'chain must be a lowercase slug');
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
