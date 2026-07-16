/**
 * CR-005 cross-repository contract harness.
 *
 * Consumers depend on `@freeside/collection-protocol`. This package never
 * imports Dashboard, Sonar, Inventory, Ordering, or any other consumer.
 */

export {
  ARTIFACT_MANIFEST_VERSION,
  ArtifactFileEntry,
  ArtifactManifest,
  ContractSchemaVersion,
  decodeArtifactManifest,
  decodeArtifactManifestJson,
  publishedContractSchema,
  publishedPackageVersion,
} from "./manifest.js";

export {
  PROTOCOL_IDENTITY_PATH,
  ProtocolIdentity,
  decodeProtocolIdentity,
  decodeProtocolIdentityJson,
  publishedProtocolIdentity,
  serializeProtocolIdentity,
  sourceTreeSha256FromFiles,
} from "./identity.js";

export {
  SourceCommitError,
  assertReachableSourceCommit,
  isDirtySourceTree,
  resolveHeadCommit,
  resolveRepositoryRoot,
} from "./source.js";

export {
  compareFileListsStrict,
  compareFixtureDigestsStrict,
  assertIdentityMatchesManifest,
  assertPackageJsonMatchesIdentity,
  type StrictVerifyFailure,
} from "./strict.js";

export {
  ConsumerSupport,
  UnsupportedContractMajor,
  UnsupportedContractMinor,
  checkContractCompatibility,
  contractSchemaFromWireMajor,
  currentPublishedSupport,
  decodeConsumerSupport,
  type ContractCompatibilityError,
} from "./compatibility.js";

export {
  ArtifactChecksumMismatch,
  ArtifactFixtureDigestMismatch,
  ArtifactManifestMismatch,
  ArtifactVersionMismatch,
  artifactErrorClass,
  verifyArtifact,
  verifyLegacyArtifactSha256,
  type ArtifactVerifyError,
  type VerifyArtifactOptions,
} from "./verify.js";

export {
  ARTIFACT_PACKAGE_PREFIX,
  ARTIFACT_REQUIRED_META_FILES,
  ArtifactArchiveMismatch,
  archivePathCollisionKey,
  assertArchiveMembersMatchManifest,
  assertArchiveMembersWellFormed,
  listTarGzipMembers,
  normalizeArchiveMemberPath,
  normalizeInventoryPath,
  normalizePathSegment,
  parsePaxExtendedHeader,
  preflightArchiveMembers,
  type TarMember,
} from "./archive.js";

export {
  DuplicateJsonKey,
  InvalidJsonDocument,
  parseJsonStrict,
  parseJsonStrictEffect,
  type StrictJsonError,
} from "./json-strict.js";

export {
  packArtifact,
  type PackArtifactOptions,
  type PackArtifactResult,
} from "./pack.js";

export {
  fixtureDigestsFromFiles,
  listHashedFiles,
  sha256Hex,
} from "./digests.js";
