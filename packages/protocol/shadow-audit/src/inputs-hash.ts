/**
 * SDD §11 (IMP-001) — the deterministic audit fingerprint.
 *
 * `inputs_hash = sha256(JCS({sources, rule}))` drives idempotency, event correlation, and
 * run_id derivation.
 *
 * ⚠ BREAKING (S5-T3): the fingerprint used to cover ONE `{chain, contract, snapshot_block}`.
 * A collection is now the UNION of its declared deployments (Honeycomb lives on ethereum AND
 * berachain), so the fingerprint MUST cover the FULL source set + each source's snapshot block —
 * otherwise two DIFFERENT unions (e.g. bera-only vs eth+bera) collide on one `inputs_hash`, hence
 * one `run_id`, and the determinism claim is a lie. Consequence, stated rather than hidden: EVERY
 * `inputs_hash`/`run_id` changes, including single-source ones (the hashed object's shape changed).
 * Consumers correlating on a previously-issued hash will not match. That is a correctness break we
 * take deliberately: the old hash could not distinguish the audits it was fingerprinting.
 */

import { z } from 'zod';
import { BlockNumberSchema, ChainSchema, EthAddressSchema } from './schemas/common.js';
import { GatingRuleSchema } from './schemas/order.js';
import { jcsCanonicalize, sha256Hex } from './jcs.js';

/**
 * Wire-visible version of the sealed inputs_hash algorithm. Increment whenever the accepted input shape or
 * canonical hash material changes. Deployment gates compare this value before routing traffic.
 */
export const SHADOW_AUDIT_PROTOCOL_VERSION = '2';

/** ONE reconstructed deployment of the collection: where it lives + the block it was read at. */
export const AuditSourceSchema = z
  .object({
    chain: ChainSchema,
    contract: EthAddressSchema,
    snapshot_block: BlockNumberSchema,
  })
  .strict();
export type AuditSource = z.infer<typeof AuditSourceSchema>;

/**
 * The sealed inputs that uniquely identify an audit computation. Deliberately EXCLUDES
 * snapshot_date (already resolved to per-source blocks), owner_wallet, and any caller/session
 * data — so an identical source-set + rule always yields the same hash.
 */
export const AuditInputsSchema = z
  .object({
    /** EVERY declared deployment the union was reconstructed over — never a subset (a partial
     *  union is refused upstream; a partial union that reached here would fingerprint as if it
     *  were the whole collection). */
    sources: z.array(AuditSourceSchema).min(1),
    rule: GatingRuleSchema,
  })
  .strict()
  .superRefine((inputs, ctx) => {
    // The same deployment twice is a registry defect: it would fingerprint two distinct unions
    // identically and (under a summing policy) double-count a holder. Refuse rather than hash it.
    const seen = new Set<string>();
    for (const s of inputs.sources) {
      const key = `${s.chain}/${s.contract.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sources'],
          message: `duplicate source ${key} — a collection's deployments must be distinct`,
        });
      }
      seen.add(key);
    }
  });
export type AuditInputs = z.infer<typeof AuditInputsSchema>;

/**
 * Compute `inputs_hash`. Deterministic by construction:
 *   - contract addresses are lowercased (checksum-insensitive),
 *   - the source set is SORTED by (chain, contract) — so registry iteration order cannot change
 *     the fingerprint of the same union, and
 *   - JCS (RFC 8785) canonicalizes key order + number form,
 * so equivalent inputs always collide and inequivalent inputs never do.
 *
 * Throws (via Zod) on malformed inputs — only validated inputs are hashed.
 */
export function computeInputsHash(inputs: AuditInputs): string {
  const v = AuditInputsSchema.parse(inputs);
  const sources = v.sources
    .map((s) => ({
      chain: s.chain,
      contract: s.contract.toLowerCase(),
      snapshot_block: s.snapshot_block,
    }))
    .sort((a, b) => (a.chain === b.chain ? a.contract.localeCompare(b.contract) : a.chain.localeCompare(b.chain)));
  return sha256Hex(jcsCanonicalize({ sources, rule: v.rule }));
}
