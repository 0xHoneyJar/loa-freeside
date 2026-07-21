import { Effect, ParseResult } from "effect";
import type { CanonicalEncodingError, DigestComputationError, VersionedDigest } from "@freeside/collection-protocol";
import type { AuthorizationScope, CandidateSnapshot } from "./contracts.js";
import { SelectionStaleError } from "./errors.js";
/**
 * Narrow allowlist of truly display-only fields. Everything else on a persisted
 * candidate participates in selection-relevant freshness — UI omission never
 * authorizes ignoring recognition, readiness, identity, or capability semantics.
 * Name, symbol, and image are presentation metadata rather than collection
 * identity: selection is bound to canonical collection/deployment digests, so
 * presentation refreshes do not silently substitute a different collection.
 */
export declare const DISPLAY_ONLY_CANDIDATE_FIELDS: readonly ["ranking_reasons", "identity.name", "identity.symbol", "identity.image"];
/**
 * Selection-relevant projection: the complete candidate snapshot minus the
 * explicit display-only allowlist. Prefer the already-canonical complete
 * candidate semantics over a hand-picked subset.
 */
export declare const selectionRelevantMaterial: (snapshot: CandidateSnapshot) => unknown;
export declare const digestSelectionRelevant: (snapshot: CandidateSnapshot) => Effect.Effect<VersionedDigest, ParseResult.ParseError | CanonicalEncodingError | DigestComputationError>;
export type StaleReason = SelectionStaleError["reason"];
export interface FreshnessComparison {
    readonly byte_equivalent: boolean;
    readonly selection_relevant_equal: boolean;
    readonly previous_digest: VersionedDigest;
    readonly current_digest: VersionedDigest;
    readonly previous_relevant_digest: VersionedDigest;
    readonly current_relevant_digest: VersionedDigest;
    readonly stale_reason: StaleReason | null;
}
export declare const compareCandidateFreshness: (previous: CandidateSnapshot, previousDigest: VersionedDigest, current: CandidateSnapshot, currentDigest: VersionedDigest) => Effect.Effect<FreshnessComparison, ParseResult.ParseError | CanonicalEncodingError | DigestComputationError>;
export declare const assertScopeUnchanged: (previous: AuthorizationScope, current: AuthorizationScope, resolutionId: string, previousDigest: VersionedDigest, currentDigest: VersionedDigest) => Effect.Effect<void, SelectionStaleError>;
//# sourceMappingURL=freshness.d.ts.map