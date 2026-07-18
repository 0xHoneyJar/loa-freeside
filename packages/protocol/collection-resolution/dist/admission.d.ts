import { Effect, ParseResult } from "effect";
import type { CanonicalEncodingError, DigestComputationError, VersionedDigest } from "@freeside/collection-protocol";
import type { AdmissionDecision, ConfirmedResolutionRecord, LocalCapabilitySnapshot } from "./contracts.js";
import { CapabilityViewStaleError, SelectionStaleError } from "./errors.js";
/**
 * Admission resolves selected deployments against the exact current local
 * capability view. A newer snapshot is compatible only when every declared
 * safety field remains safe: operation, identity_digest, health/state,
 * standard, finality, identity/equivalence/revocation, authorization, and
 * registry source sequence/version. A recognize-only view cannot satisfy
 * prepare admission. No field may be ignored because a UI omits it.
 */
export declare const evaluateAdmissionCompatibility: (record: ConfirmedResolutionRecord, local: LocalCapabilitySnapshot, orderDigest: VersionedDigest) => Effect.Effect<AdmissionDecision, SelectionStaleError | CapabilityViewStaleError | ParseResult.ParseError | CanonicalEncodingError | DigestComputationError>;
//# sourceMappingURL=admission.d.ts.map