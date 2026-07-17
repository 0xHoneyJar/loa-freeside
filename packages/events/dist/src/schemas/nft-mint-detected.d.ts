import { Schema as S } from "@effect/schema";
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
 *
 * Effect.Schema chosen here (vs zod) per cluster memory
 * `freeside-effect-transition`: new protocol-layer types use @effect/schema;
 * legacy zod stays for now. This payload schema travels across cells
 * (cross-cell wire contract = protocol layer), so it falls on the
 * Effect.Schema side of the line.
 */
export declare const NftMintDetectedSchema: S.Struct<{
    /** EVM chain id (e.g. 80094 = Berachain mainnet). */
    chain_id: S.filter<S.Schema<number, number, never>>;
    /** Contract address — lowercase 0x-prefixed 40 hex chars. */
    contract: S.filter<S.Schema<string, string, never>>;
    /** Token id — string-encoded (uint256 doesn't fit in a JS number). */
    token_id: S.filter<S.Schema<string, string, never>>;
    /** Minter (recipient of the from-0x0 transfer) — lowercase 0x-prefixed. */
    minter: S.filter<S.Schema<string, string, never>>;
    /** Block number the mint landed in. */
    block_number: S.filter<S.Schema<number, number, never>>;
    /** Transaction hash — lowercase 0x-prefixed 64 hex chars. */
    transaction_hash: S.filter<S.Schema<string, string, never>>;
    /** Block timestamp as ISO-8601 UTC. */
    timestamp: S.filter<S.Schema<string, string, never>>;
    /**
     * MST-specific enrichment — present when the handler is `vm-minted.ts`
     * (Mibera Shadows). Opaque hex string; downstream decoder lives in the
     * Mibera codex.
     */
    encoded_traits: S.optional<S.filter<S.Schema<string, string, never>>>;
}>;
export type NftMintDetected = S.Schema.Type<typeof NftMintDetectedSchema>;
//# sourceMappingURL=nft-mint-detected.d.ts.map