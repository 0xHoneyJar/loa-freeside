import { Effect, ParseResult } from "effect";
import type { CanonicalEncodingError, DigestComputationError, VersionedDigest } from "@freeside/collection-protocol";
import type { AuthorizationScope, CandidateSnapshot, ResolutionCreateCommand } from "./contracts.js";
/**
 * Candidate snapshots carry mathematical sets over the wire. Normalize their
 * presentation order before hashing so probe scheduling and ranking order do
 * not create false identity or freshness drift. Caller-owned arrays are never
 * mutated.
 */
export declare const canonicalCandidateSnapshotMaterial: (snapshot: CandidateSnapshot) => CandidateSnapshot;
export declare const digestResolutionRequest: (command: ResolutionCreateCommand, scope: AuthorizationScope) => Effect.Effect<VersionedDigest, ParseResult.ParseError | CanonicalEncodingError | DigestComputationError>;
export declare const digestCandidateSnapshot: (snapshot: CandidateSnapshot) => Effect.Effect<VersionedDigest, ParseResult.ParseError | CanonicalEncodingError | DigestComputationError>;
export declare const digestSelection: (selectedDeploymentIds: ReadonlyArray<VersionedDigest>, selectedCollectionId: VersionedDigest | undefined) => Effect.Effect<VersionedDigest, ParseResult.ParseError | CanonicalEncodingError | DigestComputationError>;
export declare const digestAdmissionDecision: (material: unknown) => Effect.Effect<VersionedDigest, ParseResult.ParseError | CanonicalEncodingError | DigestComputationError, never>;
export declare const digestsEqual: (left: VersionedDigest, right: VersionedDigest) => boolean;
//# sourceMappingURL=digests.d.ts.map