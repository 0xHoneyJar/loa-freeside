/**
 * FR-2 / SDD §3.2 — a per-member access decision.
 *
 * BANDS ONLY. There is deliberately no numeric score field, and every object
 * is `.strict()`, so a smuggled `score` (or any extra key) is a hard parse
 * failure — this is the schema-level enforcement of the "no numeric score"
 * acceptance criterion. Evidence is block heights / counts: one-click checkable
 * against the chain.
 */

import { z } from 'zod';
import {
  BandSchema,
  BlockNumberSchema,
  EthAddressSchema,
  SourceSchema,
} from './common.js';

export const EvidenceSchema = z
  .object({
    /** NFT balance held by the wallet at snapshot_block. */
    balance_at_snapshot: z.number().int().nonnegative(),
    /** Last block at which the wallet held >= threshold (if it later lapsed). */
    last_held_block: BlockNumberSchema.optional(),
    /** Block at which the wallet's balance fell below threshold (the "sale"). */
    sold_at: BlockNumberSchema.optional(),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ProvenanceSchema = z
  .object({
    rule_id: z.string().min(1),
    snapshot_block: BlockNumberSchema,
    /** ISO-8601 UTC instant the record was computed. */
    computed_at: z.string().datetime(),
    sources: z.array(SourceSchema).min(1),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const AccessDecisionRecordSchema = z
  .object({
    wallet: EthAddressSchema,
    /** Community identifier (name/slug) this decision is scoped to. */
    community: z.string().min(1),
    holds_role: z.boolean(),
    qualifies: z.boolean(),
    band: BandSchema,
    evidence: EvidenceSchema,
    provenance: ProvenanceSchema,
  })
  .strict();
export type AccessDecisionRecord = z.infer<typeof AccessDecisionRecordSchema>;
