import type { VersionedDigest } from "@freeside/collection-protocol";
import type { CapabilityRegistryVersion } from "@freeside/collection-protocol";
declare const SelectionStaleError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "SelectionStaleError";
} & Readonly<A>;
export declare class SelectionStaleError extends SelectionStaleError_base<{
    readonly resolution_id: string;
    readonly reason: "deployment_changed" | "grouping_changed" | "network_changed" | "standard_changed" | "provenance_changed" | "capability_changed" | "authorization_changed" | "scope_changed" | "local_capability_incompatible" | "equivalence_revoked" | "identity_drift" | "finality_policy_changed" | "health_rejects_admission" | "recognition_changed" | "index_status_changed" | "report_readiness_changed" | "metadata_quality_changed" | "operation_incompatible" | "identity_digest_mismatch";
    readonly previous_candidate_snapshot_digest: VersionedDigest;
    readonly current_candidate_snapshot_digest: VersionedDigest;
}> {
}
declare const IdempotencyConflictError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "IdempotencyConflictError";
} & Readonly<A>;
export declare class IdempotencyConflictError extends IdempotencyConflictError_base<{
    readonly operation: "create" | "confirm" | "refresh";
    readonly idempotency_key: string;
    readonly reason: "command_mismatch";
}> {
}
declare const ConcurrentConfirmationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ConcurrentConfirmationError";
} & Readonly<A>;
export declare class ConcurrentConfirmationError extends ConcurrentConfirmationError_base<{
    readonly resolution_id: string;
    readonly expected_confirmation_version: number;
    readonly current_confirmation_version: number;
}> {
}
declare const ResolutionNotFoundError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ResolutionNotFoundError";
} & Readonly<A>;
export declare class ResolutionNotFoundError extends ResolutionNotFoundError_base<{
    readonly resolution_id: string;
}> {
}
declare const ResolutionExpiredError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ResolutionExpiredError";
} & Readonly<A>;
export declare class ResolutionExpiredError extends ResolutionExpiredError_base<{
    readonly resolution_id: string;
    readonly expires_at: string;
}> {
}
declare const SelectionRejectedError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "SelectionRejectedError";
} & Readonly<A>;
export declare class SelectionRejectedError extends SelectionRejectedError_base<{
    readonly reason: "empty_selection" | "unknown_deployment" | "cross_candidate_composition" | "mixed_equivalence_groups" | "address_only_identity" | "alias_guessing" | "client_digest_forgery" | "ceiling_exceeded" | "unconfirmed_required";
    readonly detail: string;
}> {
}
declare const AuthorizationScopeMismatchError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "AuthorizationScopeMismatchError";
} & Readonly<A>;
export declare class AuthorizationScopeMismatchError extends AuthorizationScopeMismatchError_base<{
    readonly reason: "subject_mismatch" | "community_mismatch" | "cross_subject_replay" | "permission_revoked" | "scope_required" | "scope_mismatch";
}> {
}
declare const ConfirmationVersionConflictError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ConfirmationVersionConflictError";
} & Readonly<A>;
export declare class ConfirmationVersionConflictError extends ConfirmationVersionConflictError_base<{
    readonly resolution_id: string;
    readonly expected_confirmation_version: number;
    readonly current_confirmation_version: number;
}> {
}
declare const CapabilityViewStaleError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "CapabilityViewStaleError";
} & Readonly<A>;
export declare class CapabilityViewStaleError extends CapabilityViewStaleError_base<{
    readonly resolution_id: string;
    readonly required: CapabilityRegistryVersion;
    readonly local: CapabilityRegistryVersion | null;
    readonly reason: "missing_view" | "older_than_required" | "epoch_mismatch" | "receipt_stale";
}> {
}
declare const OrderBindingRejectedError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "OrderBindingRejectedError";
} & Readonly<A>;
export declare class OrderBindingRejectedError extends OrderBindingRejectedError_base<{
    readonly reason: "raw_candidate_metadata_refused" | "digest_grafting" | "missing_confirmation" | "resolution_expired" | "scope_mismatch";
    readonly detail: string;
}> {
}
declare const ContractIntegrityError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ContractIntegrityError";
} & Readonly<A>;
export declare class ContractIntegrityError extends ContractIntegrityError_base<{
    readonly contract: string;
    readonly reason: string;
}> {
}
declare const ImmutableRequestMismatchError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ImmutableRequestMismatchError";
} & Readonly<A>;
export declare class ImmutableRequestMismatchError extends ImmutableRequestMismatchError_base<{
    readonly resolution_id: string;
    readonly reason: "identifier_mismatch" | "report_mismatch" | "environment_mismatch" | "community_mismatch" | "canonical_mismatch";
}> {
}
export {};
//# sourceMappingURL=errors.d.ts.map