/**
 * FR-1 / SDD §3.1 — the Order we fulfill.
 *
 * v1 is sealed to a single on-chain source + the single supported gating rule
 * (single-contract NFT balance threshold) + the lead-magnet audit product.
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
