/**
 * @freeside/public-authorization-protocol
 *
 * CR-007A public subject-resource-action contract, grant/membership projection
 * watermarks, and short-lived authorization leases for resolution, report-order,
 * and capability-demand boundaries. Restricted artifact grants are CR-007B.
 */

export {
  PUBLIC_AUTHORIZATION_SCHEMA_VERSION,
  PUBLIC_AUTHORIZATION_LEASE_MAX_MS,
  PUBLIC_AUTHORIZATION_PROJECTION_MAX_LAG_MS,
} from "./version.js";

export { AuthorizationDeniedError, ContractIntegrityError } from "./errors.js";

export {
  PublicPermission,
  ProtectedResource,
  ProtectedAction,
  PublicAuthorizationScope,
  AuthorityWatermarks,
  AuthorizationLease,
  AuthorizationDenial,
  ProtectedOperation,
  REQUIRED_PERMISSION,
  decodePublicAuthorizationScope,
  decodeAuthorityWatermarks,
  decodeAuthorizationLease,
  decodeProtectedOperation,
  requiredPermissionFor,
  scopesPermissionMatch,
} from "./contracts.js";

export {
  type MembershipProjectionView,
  type GrantProjectionView,
  type AuthorizePublicOperationInput,
  type AcquireLeaseInput,
  authorizePublicOperation,
  acquirePublicAuthorizationLease,
  assertLeaseValid,
  toAuthorizationDenial,
  resolutionScopeToPublic,
} from "./authorize.js";

export {
  type FixtureGrantRecord,
  type FixtureMembershipRecord,
  type FixtureProjectionBundle,
  decodeFixtureProjectionBundle,
  fixtureProjectionFromBundle,
} from "./fixture-projections.js";
