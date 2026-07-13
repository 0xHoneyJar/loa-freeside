/**
 * FR-1 / SDD §3.1 — the Order we fulfill.
 *
 * v1 is sealed to the single supported gating rule (NFT balance threshold) + the lead-magnet
 * audit product.
 *
 * S5-T3 — `source` is the ADDRESSING deployment, NOT the whole collection. It used to be sealed
 * to "a single on-chain source", and that seal became a correctness bug the moment the collections
 * bridged: Honeycomb is 2,280 holders on ethereum AND 1,813 on berachain, so a berachain-addressed
 * audit saw 44% of the holders and branded every ethereum holder STALE. Any ONE declared deployment
 * now ADDRESSES the collection, and the registry resolves it to the full source set the audit
 * reconstructs as a UNION. The request shape is unchanged on purpose — the live dashboard client and
 * the public teaser keep working, and only the resolution changes.
 */

import { z } from 'zod';
import { ChainSchema, EthAddressSchema } from './common.js';

/**
 * The single sealed gating rule v1 supports. Any OTHER gating intent
 * (erc20-balance, LP/staked, multi-contract, …) is REFUSED by the
 * EligibilityResolver (AC-3) with `unsupported-gating`, never approximated.
 */
export const SUPPORTED_GATING_KIND = 'nft-balance' as const;

export const GatingRuleSchema = z
  .object({
    kind: z.literal(SUPPORTED_GATING_KIND),
    /** Minimum NFT count held at the snapshot block to qualify. */
    threshold: z.number().int().positive(),
  })
  .strict();
export type GatingRule = z.infer<typeof GatingRuleSchema>;

export const OrderSchema = z
  .object({
    community: z
      .object({
        name: z.string().min(1),
        owner_wallet: EthAddressSchema,
      })
      .strict(),
    /** ANY ONE declared deployment of the collection — it ADDRESSES the collection (S5-T3); the
     *  audit reconstructs the UNION of every deployment the registry declares for it. */
    source: z
      .object({
        chain: ChainSchema,
        contract_address: EthAddressSchema,
      })
      .strict(),
    gating_rule: GatingRuleSchema,
    /** v1 ships exactly one product. */
    products: z.tuple([z.literal('audit')]),
    mode: z.literal('lead-magnet'),
  })
  .strict();
export type Order = z.infer<typeof OrderSchema>;
