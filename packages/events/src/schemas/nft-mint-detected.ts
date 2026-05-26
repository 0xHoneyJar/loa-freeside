import { z } from "zod";

/**
 * Payload schema for `nft.mint.detected.*.v1` events.
 *
 * Emitted by `sonar-api` when an EVM Transfer-from-0x0 (or other mint-shaped
 * event per the indexer's per-contract handler) is detected. The publisher's
 * handler decides which collection slug to route to.
 *
 * v2 evolution (future): if the payload shape needs to change in a
 * non-additive way, publish under `nft.mint.detected.*.v2` alongside v1
 * during a ≥30d overlap window; subscribers may consume both via separate
 * `subscribeEnvelope` calls.
 */
export const NftMintDetectedSchema = z
  .object({
    /** EVM chain id (e.g. 80094 = Berachain mainnet). */
    chain_id: z.number().int().positive(),

    /** Contract address — lowercase 0x-prefixed 40 hex chars. */
    contract: z.string().regex(/^0x[0-9a-f]{40}$/, "must be lowercase 0x-prefixed 40 hex chars"),

    /** Token id — string-encoded (uint256 doesn't fit in a JS number). */
    token_id: z.string().regex(/^\d+$/, "must be a non-negative decimal integer string"),

    /** Minter (recipient of the from-0x0 transfer) — lowercase 0x-prefixed. */
    minter: z.string().regex(/^0x[0-9a-f]{40}$/, "must be lowercase 0x-prefixed 40 hex chars"),

    /** Block number the mint landed in. */
    block_number: z.number().int().nonnegative(),

    /** Transaction hash — lowercase 0x-prefixed 64 hex chars. */
    transaction_hash: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/, "must be lowercase 0x-prefixed 64 hex chars"),

    /** Block timestamp as ISO-8601 UTC. */
    timestamp: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/,
        "must be ISO-8601 UTC with trailing Z",
      ),

    /**
     * MST-specific enrichment — present when the handler is `vm-minted.ts`
     * (Mibera Shadows). Opaque hex string; downstream decoder lives in the
     * Mibera codex.
     */
    encoded_traits: z.string().regex(/^0x[0-9a-f]+$/).optional(),
  })
  .strict();

export type NftMintDetected = z.infer<typeof NftMintDetectedSchema>;
