/**
 * SDD §11 (IMP-001) — the deterministic audit fingerprint.
 *
 * `inputs_hash = sha256(JCS({chain, contract, snapshot_block, rule}))` drives
 * idempotency, event correlation, and run_id derivation.
 */

import { z } from 'zod';
import { BlockNumberSchema, ChainSchema, EthAddressSchema } from './schemas/common.js';
import { GatingRuleSchema } from './schemas/order.js';
import { jcsCanonicalize, sha256Hex } from './jcs.js';

/**
 * The sealed inputs that uniquely identify an audit computation. Deliberately
 * EXCLUDES snapshot_date (already resolved to a block), owner_wallet, and any
 * caller/session data — so identical chain+contract+block+rule always yields
 * the same hash.
 */
export const AuditInputsSchema = z
  .object({
    chain: ChainSchema,
    contract: EthAddressSchema,
    snapshot_block: BlockNumberSchema,
    rule: GatingRuleSchema,
  })
  .strict();
export type AuditInputs = z.infer<typeof AuditInputsSchema>;

/**
 * Compute `inputs_hash`. Deterministic by construction:
 *   - the contract address is lowercased (checksum-insensitive), and
 *   - JCS (RFC 8785) canonicalizes key order + number form,
 * so equivalent inputs always collide and inequivalent inputs never do.
 *
 * Throws (via Zod) on malformed inputs — only validated inputs are hashed.
 */
export function computeInputsHash(inputs: AuditInputs): string {
  const v = AuditInputsSchema.parse(inputs);
  const canonical = jcsCanonicalize({
    chain: v.chain,
    contract: v.contract.toLowerCase(),
    snapshot_block: v.snapshot_block,
    rule: v.rule,
  });
  return sha256Hex(canonical);
}
