import { Effect, Schema } from "effect";
import {
  COLLECTION_PROTOCOL_SCHEMA_MAJOR,
  COLLECTION_PROTOCOL_SCHEMA_MINOR,
  COLLECTION_PROTOCOL_VERSION,
  Sha256Hex,
} from "../scalars.js";
import {
  parseJsonStrictEffect,
  type StrictJsonError,
} from "./json-strict.js";

export const ARTIFACT_MANIFEST_VERSION = 1 as const;

export const ContractSchemaVersion = Schema.Struct({
  major: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  minor: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
}).annotations({ identifier: "ContractSchemaVersion" });
export type ContractSchemaVersion = Schema.Schema.Type<typeof ContractSchemaVersion>;

export const ArtifactFileEntry = Schema.Struct({
  path: Schema.String.pipe(Schema.minLength(1)),
  sha256: Sha256Hex,
  size: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
}).annotations({ identifier: "ArtifactFileEntry" });
export type ArtifactFileEntry = Schema.Schema.Type<typeof ArtifactFileEntry>;

export const ArtifactManifest = Schema.Struct({
  manifest_version: Schema.Literal(ARTIFACT_MANIFEST_VERSION),
  package_name: Schema.Literal("@freeside/collection-protocol"),
  package_version: Schema.String.pipe(Schema.minLength(1)),
  contract_schema: ContractSchemaVersion,
  source_commit: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
  /** Canonical digest of the packed file inventory (path/sha256/size). */
  source_tree_sha256: Sha256Hex,
  artifact_sha256: Sha256Hex,
  files: Schema.Array(ArtifactFileEntry),
  fixture_digests: Schema.Record({ key: Schema.String, value: Sha256Hex }),
}).annotations({ identifier: "ArtifactManifest" });
export type ArtifactManifest = Schema.Schema.Type<typeof ArtifactManifest>;

/**
 * Single strict manifest decoder for library + CLI.
 * Rejects excess properties at every Struct nesting level.
 */
export const decodeArtifactManifest = Schema.decodeUnknown(ArtifactManifest, {
  errors: "all",
  onExcessProperty: "error",
});

/**
 * Decode a manifest JSON document: duplicate-key preflight, then schema decode.
 */
export const decodeArtifactManifestJson = (
  text: string,
): Effect.Effect<
  ArtifactManifest,
  StrictJsonError | import("effect/ParseResult").ParseError
> =>
  Effect.gen(function* () {
    const raw = yield* parseJsonStrictEffect(text);
    return yield* decodeArtifactManifest(raw);
  });

export const publishedContractSchema = (): ContractSchemaVersion => ({
  major: COLLECTION_PROTOCOL_SCHEMA_MAJOR,
  minor: COLLECTION_PROTOCOL_SCHEMA_MINOR,
});

export const publishedPackageVersion = (): string => COLLECTION_PROTOCOL_VERSION;
