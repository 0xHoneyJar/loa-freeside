/**
 * @freeside/collection-protocol
 *
 * Shared CR-001 wire language for cross-VM collection identity. Consumers
 * decode unknown boundary input through the exported strict decoders; no
 * consumer owns a mirrored copy of these schemas.
 */

export {
  COLLECTION_PROTOCOL_VERSION,
  COLLECTION_PROTOCOL_SCHEMA_VERSION,
  EvmAddress,
  EvmNormalizedAddress,
  SolanaPublicKey,
  Eip155NetworkReference,
  SolanaNetworkReference,
  VersionIdentifier,
  TokenStandardValue,
  Sha256Hex,
  RegistryEpoch,
  RegistrySequence,
  normalizeEvmAddress,
  normalizeSolanaAddress,
} from "./scalars.js";

export {
  DigestDomain,
  VersionedDigest,
  CanonicalEncodingError,
  DuplicateCanonicalSetMemberError,
  DigestComputationError,
  type CanonicalSetMember,
  canonicalize,
  canonicalEncode,
  sortCanonicalSet,
  digestVersioned,
  CANONICAL_ENCODING_RULES,
} from "./canonical.js";

export {
  DIGEST_DOMAINS,
  Eip155NetworkRef,
  SolanaNetworkRef,
  NetworkRef,
  CollectionIdentifier,
  CollectionDeploymentInput,
  CollectionDeploymentRef,
  TokenStandard,
  KNOWN_TOKEN_STANDARDS,
  EquivalenceBasis,
  CollectionIdentityInput,
  CollectionIdentity,
  RecognitionState,
  IndexState,
  ReportReadinessState,
  MetadataQualityState,
  FinalityPolicyBinding,
  Provenance,
  CollectionCandidate,
  CollectionWorkKeyMaterial,
  CollectionEvidenceReference,
  CollectionCacheKeyMaterial,
  CollectionReportInput,
  ContractIntegrityError,
  decodeCollectionIdentifier,
  decodeNetworkRef,
  makeCollectionDeploymentRef,
  decodeCollectionDeploymentRef,
  makeCollectionIdentity,
  decodeCollectionIdentity,
  decodeCollectionCandidate,
  decodeCollectionWorkKeyMaterial,
  decodeCollectionEvidenceReference,
  decodeCollectionCacheKeyMaterial,
  decodeCollectionReportInput,
  digestCollectionCandidate,
  digestCollectionWorkKey,
  digestCollectionEvidence,
  digestCollectionCacheKey,
  digestCollectionReportInput,
  COLLECTION_CANONICAL_COLLECTION_RULES,
} from "./contracts.js";

export {
  CapabilityRegistryVersion,
  CAPABILITY_REGISTRY_BASELINE_DIGEST_DOMAIN,
  CapabilityRegistryBaseline,
  RegistryVersionRelation,
  RegistryVersionAdvance,
  RegistryEpochMismatchError,
  RegistryBaselineRequiredError,
  InvalidRegistryBaselineError,
  RegistryBaselineIntegrityError,
  RegistrySequenceRegressionError,
  decodeCapabilityRegistryVersion,
  decodeCapabilityRegistryBaseline,
  compareCapabilityRegistryVersions,
  advanceCapabilityRegistryVersion,
} from "./registry-version.js";
