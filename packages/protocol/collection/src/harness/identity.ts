import { Effect, Schema } from "effect";
import {
  COLLECTION_PROTOCOL_SCHEMA_MAJOR,
  COLLECTION_PROTOCOL_SCHEMA_MINOR,
  COLLECTION_PROTOCOL_VERSION,
} from "../scalars.js";
import { ContractSchemaVersion } from "./manifest.js";
import {
  parseJsonStrictEffect,
  type StrictJsonError,
} from "./json-strict.js";

/** Canonical machine-readable identity path inside the published tarball. */
export const PROTOCOL_IDENTITY_PATH = "protocol-identity.json" as const;

export const ProtocolIdentity = Schema.Struct({
  package_name: Schema.Literal("@freeside/collection-protocol"),
  package_version: Schema.String.pipe(Schema.minLength(1)),
  contract_schema: ContractSchemaVersion,
  source_commit: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
}).annotations({ identifier: "ProtocolIdentity" });
export type ProtocolIdentity = Schema.Schema.Type<typeof ProtocolIdentity>;

export const decodeProtocolIdentity = Schema.decodeUnknown(ProtocolIdentity, {
  errors: "all",
  onExcessProperty: "error",
});

/**
 * Decode identity JSON: duplicate-key preflight, then schema decode.
 */
export const decodeProtocolIdentityJson = (
  text: string,
): Effect.Effect<
  ProtocolIdentity,
  StrictJsonError | import("effect/ParseResult").ParseError
> =>
  Effect.gen(function* () {
    const raw = yield* parseJsonStrictEffect(text);
    return yield* decodeProtocolIdentity(raw);
  });

export const publishedProtocolIdentity = (sourceCommit: string): ProtocolIdentity => ({
  package_name: "@freeside/collection-protocol",
  package_version: COLLECTION_PROTOCOL_VERSION,
  contract_schema: {
    major: COLLECTION_PROTOCOL_SCHEMA_MAJOR,
    minor: COLLECTION_PROTOCOL_SCHEMA_MINOR,
  },
  source_commit: sourceCommit,
});

/** Stable JSON serialization for identity files written into the tarball. */
export const serializeProtocolIdentity = (identity: ProtocolIdentity): string =>
  `${JSON.stringify(identity, null, 2)}\n`;

export type PackageJsonIdentity = {
  readonly name: string;
  readonly version: string;
};

export const readPackageJsonIdentity = (raw: unknown): PackageJsonIdentity => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("package.json must be an object");
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw new Error("package.json missing name");
  }
  if (typeof record.version !== "string" || record.version.length === 0) {
    throw new Error("package.json missing version");
  }
  return { name: record.name, version: record.version };
};

/**
 * Digest over the packed file inventory (path + content hash + size).
 * Identity file is included; it does not embed this digest, so no cycle.
 */
export const sourceTreeSha256FromFiles = (
  files: ReadonlyArray<{ path: string; sha256: string; size: number }>,
  sha256Hex: (bytes: Buffer | string) => string,
): string => {
  const lines = [...files]
    .map((file) => `${file.path}\t${file.sha256}\t${file.size}`)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return sha256Hex(`${lines.join("\n")}\n`);
};
