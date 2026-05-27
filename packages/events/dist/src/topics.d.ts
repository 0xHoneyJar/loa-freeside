/**
 * Hounfour 3-segment topic builders.
 *
 * Convention (per `loa-hounfour/src/schemas/domain-event.ts`):
 *   {aggregate}.{noun}.{verb}[.{specifier}].v{N}
 *
 * - All segments lowercase kebab-case (a-z, 0-9, -)
 * - Version suffix `.v{N}` non-negotiable — schema evolution = new versioned subject
 * - Wildcard subscriptions use NATS `>` (e.g. `nft.mint.detected.>`)
 */
export interface TopicSegments {
    aggregate: string;
    noun: string;
    verb: string;
    specifier?: string;
    version: number;
}
export declare function buildTopic(segments: TopicSegments): string;
/**
 * Wildcard subject for subscribing to all NFT mint events across all
 * collections AND across all topic versions (`nft.mint.detected.>`).
 *
 * This is a NATS subject pattern — only use it with `subscribe`, never with
 * `publish`. To get the actual subject for publishing a specific event, use
 * {@link nftMintDetectedTopic}.
 */
export declare const NFT_MINT_DETECTED_WILDCARD = "nft.mint.detected.>";
/**
 * Build the publish subject for an NFT-mint-detected event.
 *
 * Returns a concrete subject string for use with `publish` — NOT a wildcard.
 * To subscribe to all collections under this event family, use
 * {@link NFT_MINT_DETECTED_WILDCARD} instead.
 *
 * Examples:
 *   nftMintDetectedTopic({collectionSlug: "mibera-shadow"}) → "nft.mint.detected.mibera-shadow.v1"
 *   nftMintDetectedTopic()                                  → "nft.mint.detected.v1"
 *     (the base versioned subject with no collection discriminator — for
 *     events whose collection cannot be discriminated at publish time. A
 *     subscriber to this exact string will NOT receive collection-specific
 *     publishes; use NFT_MINT_DETECTED_WILDCARD for that.)
 *   nftMintDetectedTopic({collectionSlug: "mibera-shadow", version: 2}) → "nft.mint.detected.mibera-shadow.v2"
 *
 * Per the build doc, schema evolution requires a new versioned subject + a
 * ≥30d v1/v2 coexistence window.
 */
export declare function nftMintDetectedTopic(opts?: {
    collectionSlug?: string;
    version?: number;
}): string;
//# sourceMappingURL=topics.d.ts.map