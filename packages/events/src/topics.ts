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

const SEGMENT_RX = /^[a-z][a-z0-9-]*$/;

function assertSegment(name: string, value: string): void {
  if (!SEGMENT_RX.test(value)) {
    throw new Error(
      `topic ${name} segment "${value}" must match /^[a-z][a-z0-9-]*$/ (lowercase kebab-case)`,
    );
  }
}

export function buildTopic(segments: TopicSegments): string {
  assertSegment("aggregate", segments.aggregate);
  assertSegment("noun", segments.noun);
  assertSegment("verb", segments.verb);
  if (segments.specifier !== undefined) assertSegment("specifier", segments.specifier);
  if (!Number.isInteger(segments.version) || segments.version < 1) {
    throw new Error(`topic version must be a positive integer (got ${segments.version})`);
  }
  const parts = [segments.aggregate, segments.noun, segments.verb];
  if (segments.specifier !== undefined) parts.push(segments.specifier);
  parts.push(`v${segments.version}`);
  return parts.join(".");
}

// --- pre-built topic helpers (NFT mint detection — v1 scope) -----------------

/** Catch-all wildcard for any NFT mint event across all collections. */
export const NFT_MINT_DETECTED_WILDCARD = "nft.mint.detected.>";

/**
 * Per-collection NFT-mint-detected subject.
 *
 * Examples:
 *   nftMintDetectedTopic({collectionSlug: "mibera-shadow"}) → "nft.mint.detected.mibera-shadow.v1"
 *   nftMintDetectedTopic() (no slug) → "nft.mint.detected.v1" (catch-all per-version)
 */
export function nftMintDetectedTopic(
  opts: { collectionSlug?: string; version?: number } = {},
): string {
  return buildTopic({
    aggregate: "nft",
    noun: "mint",
    verb: "detected",
    specifier: opts.collectionSlug,
    version: opts.version ?? 1,
  });
}
