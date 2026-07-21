/**
 * @freeside/collection-resolution-protocol
 *
 * Shared CR-006 wire language for durable resolution sessions and stale
 * selection. Consumers decode unknown boundary input through the exported
 * strict decoders; Ordering alone persists confirmed resolutions.
 */
export { COLLECTION_RESOLUTION_PROTOCOL_VERSION, COLLECTION_RESOLUTION_SCHEMA_VERSION, RESOLUTION_TTL_MS, IDEMPOTENCY_KEY_RETENTION_MS, RESOLUTION_DIGEST_DOMAINS, } from "./version.js";
export { SelectionStaleError, IdempotencyConflictError, ConcurrentConfirmationError, ResolutionNotFoundError, ResolutionExpiredError, SelectionRejectedError, AuthorizationScopeMismatchError, ConfirmationVersionConflictError, CapabilityViewStaleError, OrderBindingRejectedError, ContractIntegrityError, ImmutableRequestMismatchError, } from "./errors.js";
export { AuthorizationScope, ResolutionEnvironment, ResolutionCreateCommand, ResolutionRequestMaterial, ResolutionDiagnostics, ResolutionConfirmCommand, ResolutionRefreshCommand, OrderResolutionBinding, CandidateSnapshot, ConfirmedResolutionRecord, ResolutionPublicProjection, CapabilityHealthState, CapabilityOperation, LocalCapabilityDeploymentView, LocalCapabilitySnapshot, AdmissionDecision, decodeResolutionCreateCommand, decodeResolutionConfirmCommand, decodeResolutionRefreshCommand, decodeResolutionRequestMaterial, decodeOrderResolutionBinding, decodeCandidateSnapshot, decodeConfirmedResolutionRecord, decodeResolutionPublicProjection, decodeLocalCapabilitySnapshot, decodeAdmissionDecision, decodeAuthorizationScope, toPublicProjection, expiresAtFrom, assertNoRawCandidateOrderFields, scopesMatch, requestMaterialFromCreate, requestMaterialsEqual, digestKey, capabilityViewSetKey, isStrictlySortedUnique, } from "./contracts.js";
export { digestResolutionRequest, digestCandidateSnapshot, digestSelection, digestAdmissionDecision, digestsEqual, } from "./digests.js";
export { validateSelection, rejectAddressOnlyIdentity, type ValidatedSelection, } from "./selection.js";
export { DISPLAY_ONLY_CANDIDATE_FIELDS, selectionRelevantMaterial, digestSelectionRelevant, compareCandidateFreshness, assertScopeUnchanged, type FreshnessComparison, type StaleReason, } from "./freshness.js";
export { evaluateAdmissionCompatibility } from "./admission.js";
export { deepCloneFreeze, isDeepFrozen } from "./immutability.js";
//# sourceMappingURL=index.d.ts.map