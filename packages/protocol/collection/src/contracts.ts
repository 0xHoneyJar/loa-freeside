import { Data, Effect, ParseResult, Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import {
  type CanonicalEncodingError,
  type DigestComputationError,
  VersionedDigest,
  digestVersioned,
} from "./canonical.js";
import {
  COLLECTION_PROTOCOL_SCHEMA_VERSION,
  Eip155NetworkReference,
  EvmAddress,
  EvmNormalizedAddress,
  SolanaNetworkReference,
  SolanaPublicKey,
  TokenStandardValue,
  VersionIdentifier,
  normalizeEvmAddress,
  normalizeSolanaAddress,
} from "./scalars.js";

export const DIGEST_DOMAINS = Object.freeze({
  deployment: "collection.deployment",
  identity: "collection.identity",
  candidate: "collection.candidate",
  provenance: "collection.provenance",
  work_key: "collection.work-key",
  evidence: "collection.evidence",
  cache_key: "collection.cache-key",
  report_input: "collection.report-input",
});

const SchemaVersion = Schema.Literal(COLLECTION_PROTOCOL_SCHEMA_VERSION);
const HttpsUrl = Schema.String.pipe(
  Schema.pattern(/^https:\/\/[^\s]+$/),
).annotations({ identifier: "HttpsUrl" });
const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/),
).annotations({ identifier: "IsoTimestamp" });
const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

const keyCompare = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const isStrictlySortedUnique = <Value>(
  values: ReadonlyArray<Value>,
  key: (value: Value) => string,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) return false;
    if (keyCompare(key(previous), key(current)) >= 0) return false;
  }
  return true;
};

const digestKey = (value: VersionedDigest): string =>
  `${value.domain}:${value.major_version}:${value.digest}`;

const versionedDigestHasDomain = (
  value: VersionedDigest,
  domain: string,
): boolean =>
  value.algorithm === "sha-256" && value.major_version === 1 && value.domain === domain;

export const Eip155NetworkRef = Schema.Struct({
  schema_version: SchemaVersion,
  network_namespace: Schema.Literal("eip155"),
  network_reference: Eip155NetworkReference,
}).annotations({ identifier: "Eip155NetworkRef" });
export interface Eip155NetworkRef extends Schema.Schema.Type<typeof Eip155NetworkRef> {}

export const SolanaNetworkRef = Schema.Struct({
  schema_version: SchemaVersion,
  network_namespace: Schema.Literal("solana"),
  network_reference: SolanaNetworkReference,
}).annotations({ identifier: "SolanaNetworkRef" });
export interface SolanaNetworkRef extends Schema.Schema.Type<typeof SolanaNetworkRef> {}

export const NetworkRef = Schema.Union(Eip155NetworkRef, SolanaNetworkRef).annotations({
  identifier: "NetworkRef",
});
export type NetworkRef = Schema.Schema.Type<typeof NetworkRef>;

const EvmCollectionIdentifier = Schema.Struct({
  schema_version: SchemaVersion,
  raw: EvmAddress,
  format: Schema.Literal("evm_address"),
});
const SolanaCollectionIdentifier = Schema.Struct({
  schema_version: SchemaVersion,
  raw: SolanaPublicKey,
  format: Schema.Literal("solana_public_key"),
});

export const CollectionIdentifier = Schema.Union(
  EvmCollectionIdentifier,
  SolanaCollectionIdentifier,
).annotations({ identifier: "CollectionIdentifier" });
export type CollectionIdentifier = Schema.Schema.Type<typeof CollectionIdentifier>;

const EvmDeploymentInputFields = {
  schema_version: SchemaVersion,
  network: Eip155NetworkRef,
  address: EvmAddress,
};
const SolanaDeploymentInputFields = {
  schema_version: SchemaVersion,
  network: SolanaNetworkRef,
  address: SolanaPublicKey,
};

const EvmCollectionDeploymentInput = Schema.Struct(EvmDeploymentInputFields);
const SolanaCollectionDeploymentInput = Schema.Struct(SolanaDeploymentInputFields);

export const CollectionDeploymentInput = Schema.Union(
  EvmCollectionDeploymentInput,
  SolanaCollectionDeploymentInput,
).annotations({ identifier: "CollectionDeploymentInput" });
export type CollectionDeploymentInput = Schema.Schema.Type<typeof CollectionDeploymentInput>;

const EvmCollectionDeploymentRef = Schema.Struct({
  ...EvmDeploymentInputFields,
  normalized_address: EvmNormalizedAddress,
  deployment_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        versionedDigestHasDomain(value, DIGEST_DOMAINS.deployment) ||
        "deployment_id must use the collection.deployment v1 digest domain",
    ),
  ),
}).pipe(
  Schema.filter(
    (deployment) =>
      deployment.normalized_address === normalizeEvmAddress(deployment.address) ||
      "EVM normalized_address must be the lowercase comparison form",
  ),
);

const SolanaCollectionDeploymentRef = Schema.Struct({
  ...SolanaDeploymentInputFields,
  normalized_address: SolanaPublicKey,
  deployment_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        versionedDigestHasDomain(value, DIGEST_DOMAINS.deployment) ||
        "deployment_id must use the collection.deployment v1 digest domain",
    ),
  ),
}).pipe(
  Schema.filter(
    (deployment) =>
      deployment.normalized_address === normalizeSolanaAddress(deployment.address) ||
      "Solana normalized_address must retain exact case",
  ),
);

export const CollectionDeploymentRef = Schema.Union(
  EvmCollectionDeploymentRef,
  SolanaCollectionDeploymentRef,
).annotations({ identifier: "CollectionDeploymentRef" });
export type CollectionDeploymentRef = Schema.Schema.Type<typeof CollectionDeploymentRef>;

export const TokenStandard = Schema.Struct({
  schema_version: SchemaVersion,
  value: TokenStandardValue,
}).annotations({ identifier: "TokenStandard" });
export interface TokenStandard extends Schema.Schema.Type<typeof TokenStandard> {}

export const KNOWN_TOKEN_STANDARDS: ReadonlyArray<string> = Object.freeze([
  "erc721",
  "erc1155",
  "metaplex_collection",
  "programmable_nft",
  "compressed_nft",
  "unknown",
]);

const EquivalenceAssertionDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      value.major_version >= 1 || "equivalence assertion digest must be versioned",
  ),
);

const SingleDeploymentBasis = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("single_deployment"),
});
const RegistryEquivalenceBasis = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("registry"),
  assertion_digest: EquivalenceAssertionDigest,
});
const OperatorRatifiedEquivalenceBasis = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("operator_ratified"),
  assertion_digest: EquivalenceAssertionDigest,
  authority_ref: NonEmptyString,
});
const ProtocolLinkEquivalenceBasis = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("protocol_link"),
  assertion_digest: EquivalenceAssertionDigest,
  protocol: NonEmptyString,
});

export const EquivalenceBasis = Schema.Union(
  SingleDeploymentBasis,
  RegistryEquivalenceBasis,
  OperatorRatifiedEquivalenceBasis,
  ProtocolLinkEquivalenceBasis,
).annotations({ identifier: "EquivalenceBasis" });
export type EquivalenceBasis = Schema.Schema.Type<typeof EquivalenceBasis>;

const CollectionDeployments = Schema.Array(CollectionDeploymentRef).pipe(
  Schema.filter((deployments) => deployments.length > 0 || "deployments must be non-empty"),
  Schema.filter(
    (deployments) =>
      isStrictlySortedUnique(deployments, (deployment) => digestKey(deployment.deployment_id)) ||
      "deployments are a sorted set keyed by deployment_id",
  ),
);

const CollectionIdDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      versionedDigestHasDomain(value, DIGEST_DOMAINS.identity) ||
      "collection_id must use the collection.identity v1 digest domain",
  ),
);

const CollectionIdentityCoreFields = {
  schema_version: SchemaVersion,
  collection_key: Schema.optionalWith(NonEmptyString, { exact: true }),
  name: Schema.optionalWith(NonEmptyString, { exact: true }),
  symbol: Schema.optionalWith(NonEmptyString, { exact: true }),
  image: Schema.optionalWith(HttpsUrl, { exact: true }),
  deployments: CollectionDeployments,
  equivalence_basis: EquivalenceBasis,
};

interface IdentityInvariantInput {
  readonly deployments: ReadonlyArray<CollectionDeploymentRef>;
  readonly equivalence_basis: EquivalenceBasis;
}

const identityInvariant = (identity: IdentityInvariantInput): boolean | string => {
  if (
    identity.equivalence_basis.kind === "single_deployment" &&
    identity.deployments.length !== 1
  ) {
    return "single_deployment equivalence basis requires exactly one deployment";
  }
  if (
    identity.equivalence_basis.kind !== "single_deployment" &&
    identity.deployments.length < 2
  ) {
    return "multi-deployment equivalence basis requires at least two deployments";
  }
  return true;
};

export const CollectionIdentityInput = Schema.Struct(CollectionIdentityCoreFields).pipe(
  Schema.filter(identityInvariant),
).annotations({ identifier: "CollectionIdentityInput" });
export type CollectionIdentityInput = Schema.Schema.Type<typeof CollectionIdentityInput>;

export const CollectionIdentity = Schema.Struct({
  collection_id: CollectionIdDigest,
  ...CollectionIdentityCoreFields,
}).pipe(Schema.filter(identityInvariant)).annotations({ identifier: "CollectionIdentity" });
export type CollectionIdentity = Schema.Schema.Type<typeof CollectionIdentity>;

export const RecognitionState = Schema.Literal(
  "recognized",
  "ambiguous",
  "unrecognized",
).annotations({ identifier: "RecognitionState" });
export type RecognitionState = Schema.Schema.Type<typeof RecognitionState>;

export const IndexState = Schema.Literal(
  "indexed",
  "indexing",
  "missing",
  "unsupported",
  "failed",
  "unknown",
).annotations({ identifier: "IndexState" });
export type IndexState = Schema.Schema.Type<typeof IndexState>;

export const ReportReadinessState = Schema.Literal(
  "ready",
  "preparation_required",
  "unsupported",
  "blocked",
  "unknown",
).annotations({ identifier: "ReportReadinessState" });
export type ReportReadinessState = Schema.Schema.Type<typeof ReportReadinessState>;

export const MetadataQualityState = Schema.Literal(
  "onchain",
  "registry_enriched",
  "external_pointer",
  "partial",
  "unavailable",
).annotations({ identifier: "MetadataQualityState" });
export type MetadataQualityState = Schema.Schema.Type<typeof MetadataQualityState>;

export const FinalityPolicyBinding = Schema.Struct({
  schema_version: SchemaVersion,
  network: NetworkRef,
  finality_policy_version: VersionIdentifier,
}).annotations({ identifier: "FinalityPolicyBinding" });
export interface FinalityPolicyBinding extends Schema.Schema.Type<typeof FinalityPolicyBinding> {}

const networkKey = (network: NetworkRef): string =>
  `${network.network_namespace}:${network.network_reference}`;

const FinalityPolicySet = Schema.Array(FinalityPolicyBinding).pipe(
  Schema.filter((bindings) => bindings.length > 0 || "finality_policies must be non-empty"),
  Schema.filter(
    (bindings) =>
      isStrictlySortedUnique(bindings, (binding) => networkKey(binding.network)) ||
      "finality_policies are a sorted set keyed by network namespace and reference",
  ),
);

export const Provenance = Schema.Struct({
  schema_version: SchemaVersion,
  source: Schema.Literal(
    "onchain",
    "sonar_probe",
    "inventory_registry",
    "operator_ratified",
    "protocol_link",
    "external_metadata",
  ),
  source_reference: Schema.optionalWith(NonEmptyString, { exact: true }),
  observed_at: IsoTimestamp,
  evidence_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        versionedDigestHasDomain(value, DIGEST_DOMAINS.provenance) ||
        "provenance evidence_digest must use the collection.provenance v1 digest domain",
    ),
  ),
}).annotations({ identifier: "Provenance" });
export type Provenance = Schema.Schema.Type<typeof Provenance>;

const ProvenanceList = Schema.Array(Provenance).pipe(
  Schema.filter((items) => items.length > 0 || "provenance must be non-empty"),
);

const candidateInvariant = (candidate: {
  readonly identity: CollectionIdentity;
  readonly finality_policies: ReadonlyArray<FinalityPolicyBinding>;
}): boolean | string => {
  const deploymentNetworks = new Set(
    candidate.identity.deployments.map((deployment) => networkKey(deployment.network)),
  );
  const finalityNetworks = new Set(
    candidate.finality_policies.map((binding) => networkKey(binding.network)),
  );
  if (deploymentNetworks.size !== finalityNetworks.size) {
    return "finality_policies must cover every deployment network exactly once";
  }
  for (const deploymentNetwork of deploymentNetworks) {
    if (!finalityNetworks.has(deploymentNetwork)) {
      return "finality_policies must cover every deployment network exactly once";
    }
  }
  return true;
};

export const CollectionCandidate = Schema.Struct({
  schema_version: SchemaVersion,
  identity: CollectionIdentity,
  token_standard: TokenStandard,
  recognition: RecognitionState,
  index_status: IndexState,
  report_readiness: ReportReadinessState,
  metadata_quality: MetadataQualityState,
  provenance: ProvenanceList,
  finality_policies: FinalityPolicySet,
  ranking_reasons: Schema.Array(NonEmptyString),
}).pipe(Schema.filter(candidateInvariant)).annotations({ identifier: "CollectionCandidate" });
export type CollectionCandidate = Schema.Schema.Type<typeof CollectionCandidate>;

const DeploymentIdSet = Schema.Array(VersionedDigest).pipe(
  Schema.filter((items) => items.length > 0 || "deployment_ids must be non-empty"),
  Schema.filter(
    (items) =>
      items.every((item) => versionedDigestHasDomain(item, DIGEST_DOMAINS.deployment)) ||
      "deployment_ids must use the collection.deployment v1 digest domain",
  ),
  Schema.filter(
    (items) =>
      isStrictlySortedUnique(items, digestKey) ||
      "deployment_ids are a sorted set keyed by versioned digest",
  ),
);

const ProvenanceDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      versionedDigestHasDomain(value, DIGEST_DOMAINS.provenance) ||
      "evidence_digest must use the collection.provenance v1 digest domain",
  ),
);

const EvidenceDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      versionedDigestHasDomain(value, DIGEST_DOMAINS.evidence) ||
      "report evidence_digests must use the collection.evidence v1 digest domain",
  ),
);

const EvidenceDigestSet = Schema.Array(EvidenceDigest).pipe(
  Schema.filter((items) => items.length > 0 || "evidence_digests must be non-empty"),
  Schema.filter(
    (items) =>
      isStrictlySortedUnique(items, digestKey) ||
      "evidence_digests are a sorted set keyed by versioned digest",
  ),
);

export const CollectionWorkKeyMaterial = Schema.Struct({
  schema_version: SchemaVersion,
  capability: NonEmptyString,
  capability_version: VersionIdentifier,
  collection_id: CollectionIdDigest,
  deployment_ids: DeploymentIdSet,
  finality_policies: FinalityPolicySet,
}).annotations({ identifier: "CollectionWorkKeyMaterial" });
export type CollectionWorkKeyMaterial = Schema.Schema.Type<typeof CollectionWorkKeyMaterial>;

export const CollectionEvidenceReference = Schema.Struct({
  schema_version: SchemaVersion,
  evidence_digest: ProvenanceDigest,
  deployment_ids: DeploymentIdSet,
  finality_policies: FinalityPolicySet,
}).annotations({ identifier: "CollectionEvidenceReference" });
export type CollectionEvidenceReference = Schema.Schema.Type<typeof CollectionEvidenceReference>;

export const CollectionCacheKeyMaterial = Schema.Struct({
  schema_version: SchemaVersion,
  cache_namespace: NonEmptyString,
  deployment_ids: DeploymentIdSet,
  finality_policies: FinalityPolicySet,
}).annotations({ identifier: "CollectionCacheKeyMaterial" });
export type CollectionCacheKeyMaterial = Schema.Schema.Type<typeof CollectionCacheKeyMaterial>;

export const CollectionReportInput = Schema.Struct({
  schema_version: SchemaVersion,
  report_type: NonEmptyString,
  report_version: VersionIdentifier,
  collection_id: CollectionIdDigest,
  deployment_ids: DeploymentIdSet,
  finality_policies: FinalityPolicySet,
  evidence_digests: EvidenceDigestSet,
}).annotations({ identifier: "CollectionReportInput" });
export type CollectionReportInput = Schema.Schema.Type<typeof CollectionReportInput>;

export class ContractIntegrityError extends Data.TaggedError("ContractIntegrityError")<{
  readonly contract: string;
  readonly reason: string;
}> {}

const strictOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const decodeIdentifierStruct = Schema.decodeUnknown(CollectionIdentifier, strictOptions);
const decodeNetworkRefStruct = Schema.decodeUnknown(NetworkRef, strictOptions);
const decodeDeploymentInputStruct = Schema.decodeUnknown(CollectionDeploymentInput, strictOptions);
const decodeDeploymentRefStruct = Schema.decodeUnknown(CollectionDeploymentRef, strictOptions);
const decodeIdentityInputStruct = Schema.decodeUnknown(CollectionIdentityInput, strictOptions);
const decodeIdentityStruct = Schema.decodeUnknown(CollectionIdentity, strictOptions);
const decodeCandidateStruct = Schema.decodeUnknown(CollectionCandidate, strictOptions);
const decodeWorkKeyStruct = Schema.decodeUnknown(CollectionWorkKeyMaterial, strictOptions);
const decodeEvidenceStruct = Schema.decodeUnknown(CollectionEvidenceReference, strictOptions);
const decodeCacheKeyStruct = Schema.decodeUnknown(CollectionCacheKeyMaterial, strictOptions);
const decodeReportInputStruct = Schema.decodeUnknown(CollectionReportInput, strictOptions);

export const decodeCollectionIdentifier = decodeIdentifierStruct;
export const decodeNetworkRef = decodeNetworkRefStruct;

const deploymentDigestMaterial = (deployment: CollectionDeploymentInput): unknown => ({
  network_namespace: deployment.network.network_namespace,
  network_reference: deployment.network.network_reference,
  normalized_address:
    deployment.network.network_namespace === "eip155"
      ? normalizeEvmAddress(deployment.address)
      : normalizeSolanaAddress(deployment.address),
});

const digestMatches = (left: VersionedDigest, right: VersionedDigest): boolean =>
  left.algorithm === right.algorithm &&
  left.domain === right.domain &&
  left.major_version === right.major_version &&
  left.digest === right.digest;

export const makeCollectionDeploymentRef = (
  input: unknown,
): Effect.Effect<
  CollectionDeploymentRef,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
  decodeDeploymentInputStruct(input).pipe(
    Effect.flatMap((deployment) =>
      digestVersioned(
        DIGEST_DOMAINS.deployment,
        1,
        deploymentDigestMaterial(deployment),
      ).pipe(
        Effect.map((deploymentId) => {
          if (deployment.network.network_namespace === "eip155") {
            const result: CollectionDeploymentRef = {
              ...deployment,
              normalized_address: normalizeEvmAddress(deployment.address),
              deployment_id: deploymentId,
            };
            return result;
          }
          const result: CollectionDeploymentRef = {
            ...deployment,
            normalized_address: normalizeSolanaAddress(deployment.address),
            deployment_id: deploymentId,
          };
          return result;
        }),
      ),
    ),
  );

const validateDeploymentRef = (
  deployment: CollectionDeploymentRef,
): Effect.Effect<
  CollectionDeploymentRef,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  digestVersioned(
    DIGEST_DOMAINS.deployment,
    1,
    deploymentDigestMaterial(deployment),
  ).pipe(
    Effect.flatMap((expected) =>
      digestMatches(deployment.deployment_id, expected)
        ? Effect.succeed(deployment)
        : Effect.fail(
            new ContractIntegrityError({
              contract: "CollectionDeploymentRef",
              reason: "deployment_id does not match the canonical deployment identity",
            }),
          ),
    ),
  );

export const decodeCollectionDeploymentRef = (
  input: unknown,
): Effect.Effect<
  CollectionDeploymentRef,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> => decodeDeploymentRefStruct(input).pipe(Effect.flatMap(validateDeploymentRef));

const identityDigestMaterial = (identity: CollectionIdentityInput): unknown => ({
  schema_version: identity.schema_version,
  deployment_ids: identity.deployments.map(
    (deployment) => deployment.deployment_id,
  ),
  equivalence_basis: identity.equivalence_basis,
});

export const makeCollectionIdentity = (
  input: unknown,
): Effect.Effect<
  CollectionIdentity,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  decodeIdentityInputStruct(input).pipe(
    Effect.flatMap((identity) =>
      Effect.forEach(identity.deployments, validateDeploymentRef).pipe(
        Effect.as(identity),
      ),
    ),
    Effect.flatMap((identity) =>
      digestVersioned(DIGEST_DOMAINS.identity, 1, identityDigestMaterial(identity)).pipe(
        Effect.map((collectionId) => {
          const result: CollectionIdentity = {
            collection_id: collectionId,
            ...identity,
          };
          return result;
        }),
      ),
    ),
  );

const validateIdentity = (
  identity: CollectionIdentity,
): Effect.Effect<
  CollectionIdentity,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  Effect.forEach(identity.deployments, validateDeploymentRef).pipe(
    Effect.flatMap(() =>
      digestVersioned(
        DIGEST_DOMAINS.identity,
        1,
        identityDigestMaterial(identity),
      ),
    ),
    Effect.flatMap((expected) =>
      digestMatches(identity.collection_id, expected)
        ? Effect.succeed(identity)
        : Effect.fail(
            new ContractIntegrityError({
              contract: "CollectionIdentity",
              reason: "collection_id does not match the canonical logical identity",
            }),
          ),
    ),
  );

export const decodeCollectionIdentity = (
  input: unknown,
): Effect.Effect<
  CollectionIdentity,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> => decodeIdentityStruct(input).pipe(Effect.flatMap(validateIdentity));

export const decodeCollectionCandidate = (
  input: unknown,
): Effect.Effect<
  CollectionCandidate,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  decodeCandidateStruct(input).pipe(
    Effect.flatMap((candidate) =>
      validateIdentity(candidate.identity).pipe(Effect.as(candidate)),
    ),
  );

export const decodeCollectionWorkKeyMaterial = decodeWorkKeyStruct;
export const decodeCollectionEvidenceReference = decodeEvidenceStruct;
export const decodeCollectionCacheKeyMaterial = decodeCacheKeyStruct;
export const decodeCollectionReportInput = decodeReportInputStruct;

export const digestCollectionCandidate = (candidate: unknown) =>
  decodeCollectionCandidate(candidate).pipe(
    Effect.flatMap((decoded) =>
      digestVersioned(DIGEST_DOMAINS.candidate, 1, decoded),
    ),
  );
export const digestCollectionWorkKey = (material: unknown) =>
  decodeCollectionWorkKeyMaterial(material).pipe(
    Effect.flatMap((decoded) =>
      digestVersioned(DIGEST_DOMAINS.work_key, 1, decoded),
    ),
  );
export const digestCollectionEvidence = (material: unknown) =>
  decodeCollectionEvidenceReference(material).pipe(
    Effect.flatMap((decoded) =>
      digestVersioned(DIGEST_DOMAINS.evidence, 1, decoded),
    ),
  );
export const digestCollectionCacheKey = (material: unknown) =>
  decodeCollectionCacheKeyMaterial(material).pipe(
    Effect.flatMap((decoded) =>
      digestVersioned(DIGEST_DOMAINS.cache_key, 1, decoded),
    ),
  );
export const digestCollectionReportInput = (material: unknown) =>
  decodeCollectionReportInput(material).pipe(
    Effect.flatMap((decoded) =>
      digestVersioned(DIGEST_DOMAINS.report_input, 1, decoded),
    ),
  );

export const COLLECTION_CANONICAL_COLLECTION_RULES = Object.freeze({
  collection_id:
    "stable logical identity over deployments and explicit equivalence only; display metadata and aliases are excluded",
  deployments: "sorted set keyed by versioned deployment_id",
  finality_policies: "sorted set keyed by network namespace and reference",
  deployment_ids: "sorted set keyed by versioned deployment digest",
  evidence_digests: "sorted set keyed by versioned evidence digest",
  provenance: "ordered array in source-precedence order",
  ranking_reasons: "ordered array in resolver ranking order",
});
