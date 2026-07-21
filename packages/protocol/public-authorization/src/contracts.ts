import { Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { PUBLIC_AUTHORIZATION_SCHEMA_VERSION } from "./version.js";

const SchemaVersion = Schema.Literal(PUBLIC_AUTHORIZATION_SCHEMA_VERSION);
const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const SubjectId = NonEmptyString.pipe(Schema.maxLength(256)).annotations({
  identifier: "SubjectId",
});
const CommunityRef = NonEmptyString.pipe(Schema.maxLength(256)).annotations({
  identifier: "CommunityRef",
});
const IdempotencyKey = NonEmptyString.pipe(Schema.maxLength(256)).annotations({
  identifier: "IdempotencyKey",
});
const LeaseId = NonEmptyString.pipe(Schema.maxLength(128)).annotations({
  identifier: "LeaseId",
});

const strictOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

/** Public-path permissions ratified by CR-007A. Restricted grants are CR-007B. */
export const PublicPermission = Schema.Literal(
  "report:create",
  "report:read",
  "demand:create",
  "demand:read",
  "demand:withdraw",
).annotations({ identifier: "PublicPermission" });
export type PublicPermission = Schema.Schema.Type<typeof PublicPermission>;

export const ProtectedResource = Schema.Literal(
  "resolution",
  "report_order",
  "capability_demand",
).annotations({ identifier: "ProtectedResource" });
export type ProtectedResource = Schema.Schema.Type<typeof ProtectedResource>;

export const ProtectedAction = Schema.Literal(
  "create",
  "confirm",
  "refresh",
  "list",
  "detail",
  "withdraw",
).annotations({ identifier: "ProtectedAction" });
export type ProtectedAction = Schema.Schema.Type<typeof ProtectedAction>;

/**
 * BFF-supplied scope for a protected operation. Client community and subject
 * claims are never authoritative — Ordering revalidates against projections.
 */
export const PublicAuthorizationScope = Schema.Struct({
  schema_version: SchemaVersion,
  subject_id: SubjectId,
  community_ref: CommunityRef,
  permission: PublicPermission,
  idempotency_key: Schema.optionalWith(IdempotencyKey, { exact: true }),
}).annotations({ identifier: "PublicAuthorizationScope" });
export type PublicAuthorizationScope = Schema.Schema.Type<typeof PublicAuthorizationScope>;

/** Local projection watermarks bound into every lease (SDD §11.1). */
export const AuthorityWatermarks = Schema.Struct({
  schema_version: SchemaVersion,
  membership_stream_epoch: Schema.Number,
  membership_sequence: Schema.Number,
  grant_stream_epoch: Schema.Number,
  grant_sequence: Schema.Number,
  projected_at_unix_ms: Schema.Number,
}).annotations({ identifier: "AuthorityWatermarks" });
export type AuthorityWatermarks = Schema.Schema.Type<typeof AuthorityWatermarks>;

/** Database-stamped short lease acquired at a protected boundary. */
export const AuthorizationLease = Schema.Struct({
  schema_version: SchemaVersion,
  lease_id: LeaseId,
  subject_id: SubjectId,
  community_ref: CommunityRef,
  resource: ProtectedResource,
  action: ProtectedAction,
  permission: PublicPermission,
  watermarks: AuthorityWatermarks,
  issued_at_unix_ms: Schema.Number,
  expires_at_unix_ms: Schema.Number,
}).annotations({ identifier: "AuthorizationLease" });
export type AuthorizationLease = Schema.Schema.Type<typeof AuthorizationLease>;

/** Safe denial envelope returned to BFF callers — no cross-tenant hints. */
export const AuthorizationDenial = Schema.Struct({
  schema_version: SchemaVersion,
  code: Schema.Literal(
    "unauthorized",
    "forbidden",
    "authorization_scope_mismatch",
    "idempotency_conflict",
    "rate_limited",
  ),
  reason: Schema.Literal(
    "unauthenticated",
    "membership_revoked",
    "permission_revoked",
    "community_mismatch",
    "cross_subject",
    "scope_tamper",
    "projection_stale",
    "projection_gap",
    "lease_expired",
    "unsupported_permission",
    "idempotency_replay_mismatch",
  ),
}).annotations({ identifier: "AuthorizationDenial" });
export type AuthorizationDenial = Schema.Schema.Type<typeof AuthorizationDenial>;

export const ProtectedOperation = Schema.Struct({
  resource: ProtectedResource,
  action: ProtectedAction,
}).annotations({ identifier: "ProtectedOperation" });
export type ProtectedOperation = Schema.Schema.Type<typeof ProtectedOperation>;

const decodePublicAuthorizationScopeStruct = Schema.decodeUnknown(
  PublicAuthorizationScope,
  strictOptions,
);
const decodeAuthorityWatermarksStruct = Schema.decodeUnknown(AuthorityWatermarks, strictOptions);
const decodeAuthorizationLeaseStruct = Schema.decodeUnknown(AuthorizationLease, strictOptions);
const decodeProtectedOperationStruct = Schema.decodeUnknown(ProtectedOperation, strictOptions);

export const decodePublicAuthorizationScope = decodePublicAuthorizationScopeStruct;
export const decodeAuthorityWatermarks = decodeAuthorityWatermarksStruct;
export const decodeAuthorizationLease = decodeAuthorizationLeaseStruct;
export const decodeProtectedOperation = decodeProtectedOperationStruct;

/** Maps resource+action to the permission Ordering must recheck at the boundary. */
export const REQUIRED_PERMISSION: Readonly<
  Record<ProtectedResource, Partial<Record<ProtectedAction, PublicPermission>>>
> = {
  resolution: {
    create: "report:create",
    confirm: "report:create",
    refresh: "report:create",
  },
  report_order: {
    create: "report:create",
    list: "report:read",
    detail: "report:read",
  },
  capability_demand: {
    create: "demand:create",
    list: "demand:read",
    detail: "demand:read",
    withdraw: "demand:withdraw",
  },
};

export function requiredPermissionFor(
  operation: ProtectedOperation,
): PublicPermission | undefined {
  return REQUIRED_PERMISSION[operation.resource]?.[operation.action];
}

export function scopesPermissionMatch(
  scope: PublicAuthorizationScope,
  operation: ProtectedOperation,
): boolean {
  const required = requiredPermissionFor(operation);
  return required !== undefined && scope.permission === required;
}
