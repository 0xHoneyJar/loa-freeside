/**
 * @freeside/signing-key-custody-protocol
 *
 * CR-013 production KMS/HSM signing-key custody for collection-report Ordering.
 * Distinct from CR-009 wire semantics — this package owns registry distribution,
 * key-class separation, rotation/revocation policy, and database time-health gates.
 */

export {
  SIGNING_KEY_CUSTODY_SCHEMA_VERSION,
  ORDERING_DATABASE_MAX_SKEW_MS,
  MIN_INDEPENDENT_TIME_SOURCES,
  DEFAULT_REGISTRY_MAX_STALENESS_MS,
  MIN_ROTATION_OVERLAP_MS,
} from "./version.js";

export {
  ContractIntegrityError,
  KeyCustodyRejectedError,
  SigningBackendError,
} from "./errors.js";

export {
  strictDecodeOptions,
  KeyCustodyClass,
  CustodyBackendKind,
  CustodySigningKey,
  SigningKeyRegistryDocument,
  RotationEvent,
  RevocationEvent,
  CompromiseEvent,
  TimeSourceReading,
  TimeHealthSnapshot,
  decodeCustodySigningKey,
  decodeSigningKeyRegistryDocument,
  decodeRotationEvent,
  decodeRevocationEvent,
  decodeCompromiseEvent,
  decodeTimeHealthSnapshot,
} from "./contracts.js";

export {
  FIXTURE_KEY_ID_MARKER,
  isFixtureKeyId,
  isProductionKeyId,
  expectedBackendForClass,
  backendMatchesClass,
  validateKeyClassMechanics,
  assertProductionAuthorizedKey,
  assertFixtureKeyOnly,
  satisfiesProductionReleaseGate,
  toTrustEnvelopeServiceKey,
} from "./key-class.js";

export {
  PinnedKeyRegistry,
  registryObservability,
  type RegistryFreshnessInput,
  type ResolveKeyForIntakeInput,
} from "./registry.js";

export {
  validateRotationOverlap,
  applyRevocationToKeys,
  applyCompromiseToKeys,
  createInMemoryRotationCoordinator,
  buildEmergencyRevocationPlan,
  type RotationCoordinator,
  type EmergencyRevocationPlan,
} from "./rotation.js";

export {
  evaluateDatabaseClockSkew,
  buildTimeHealthSnapshot,
  assertSignedIntakeTimeHealthy,
  timeHealthObservability,
  type EvaluateDatabaseClockSkewInput,
  type DatabaseClockSkewVerdict,
} from "./time-health.js";

export {
  assertBackendAuthorizedForContext,
  signWithBackend,
  type RemoteSigningBackend,
  type LocalFixtureSigningBackend,
  type SigningBackend,
  type KmsHsmKeyReference,
} from "./signer.js";

export {
  gateSignedIntake,
  assertSignedIntakeAllowed,
  type GateSignedIntakeInput,
  type SignedIntakeGateVerdict,
} from "./intake-gate.js";

export {
  buildFixtureCustodyKey,
  defaultFixtureCustodyKeys,
  buildSigningKeyRegistryDocument,
  buildDefaultFixtureRegistryDocument,
  exampleProductionRegistryTemplate,
  type BuildRegistryDocumentInput,
} from "./fixture-registry.js";
