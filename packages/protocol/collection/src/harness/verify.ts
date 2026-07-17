import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Data, Effect, Either } from "effect";
import {
  type ArtifactManifest,
  decodeArtifactManifest,
  decodeArtifactManifestJson,
} from "./manifest.js";
import {
  PROTOCOL_IDENTITY_PATH,
  decodeProtocolIdentityJson,
  readPackageJsonIdentity,
  sourceTreeSha256FromFiles,
} from "./identity.js";
import {
  assertIdentityMatchesManifest,
  assertPackageJsonMatchesIdentity,
  compareFileListsStrict,
  compareFixtureDigestsStrict,
  type StrictVerifyFailure,
} from "./strict.js";
import { fixtureDigestsFromFiles, listHashedFiles, sha256Hex } from "./digests.js";
import {
  ArtifactArchiveMismatch,
  preflightArchiveMembers,
} from "./archive.js";
import type { StrictJsonError } from "./json-strict.js";

export class ArtifactChecksumMismatch extends Data.TaggedError(
  "ArtifactChecksumMismatch",
)<{
  readonly expected: string;
  readonly actual: string;
  readonly reason: string;
}> {}

export class ArtifactManifestMismatch extends Data.TaggedError(
  "ArtifactManifestMismatch",
)<{
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly reason: string;
}> {}

export class ArtifactFixtureDigestMismatch extends Data.TaggedError(
  "ArtifactFixtureDigestMismatch",
)<{
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  readonly reason: string;
}> {}

export class ArtifactVersionMismatch extends Data.TaggedError("ArtifactVersionMismatch")<{
  readonly field: "package_version" | "contract_schema.major" | "contract_schema.minor";
  readonly expected: string;
  readonly actual: string;
  readonly reason: string;
}> {}

export type ArtifactVerifyError =
  | ArtifactChecksumMismatch
  | ArtifactManifestMismatch
  | ArtifactFixtureDigestMismatch
  | ArtifactVersionMismatch
  | ArtifactArchiveMismatch
  | StrictJsonError
  | import("effect/ParseResult").ParseError;

const extractTarball = (tarballPath: string, destination: string): void => {
  execFileSync("tar", ["-xzf", tarballPath, "-C", destination], { stdio: "pipe" });
};

const packageRootFromExtract = (extractRoot: string): string =>
  join(extractRoot, "package");

const failureFromStrict = (failure: StrictVerifyFailure): ArtifactVerifyError => {
  if (failure._tag === "ArtifactFixtureDigestMismatch") {
    return new ArtifactFixtureDigestMismatch({
      path: failure.path ?? "<fixture_digests>",
      expected: failure.expected ?? "",
      actual: failure.actual ?? "",
      reason: failure.reason,
    });
  }
  if (failure._tag === "ArtifactChecksumMismatch") {
    return new ArtifactChecksumMismatch({
      expected: failure.expected ?? "",
      actual: failure.actual ?? "",
      reason: failure.reason,
    });
  }
  if (failure._tag === "ArtifactVersionMismatch") {
    const field =
      failure.field === "contract_schema.major" ||
      failure.field === "contract_schema.minor" ||
      failure.field === "package_version"
        ? failure.field
        : "package_version";
    return new ArtifactVersionMismatch({
      field,
      expected: failure.expected ?? "",
      actual: failure.actual ?? "",
      reason: failure.reason,
    });
  }
  return new ArtifactManifestMismatch({
    field: failure.field ?? failure.path ?? "manifest",
    expected: failure.expected ?? "",
    actual: failure.actual ?? "",
    reason: failure.reason,
  });
};

export interface VerifyArtifactOptions {
  readonly tarballPath: string;
  /** Parsed manifest object, or raw JSON text (preferred — enables duplicate-key checks). */
  readonly manifest: unknown;
  readonly expectedPackageVersion?: string;
  readonly expectedContractMajor?: number;
  readonly expectedContractMinor?: number;
}

const decodeManifestInput = (
  manifest: unknown,
): Effect.Effect<
  ArtifactManifest,
  StrictJsonError | import("effect/ParseResult").ParseError
> => {
  if (typeof manifest === "string") {
    return decodeArtifactManifestJson(manifest);
  }
  return decodeArtifactManifest(manifest);
};

/**
 * Verify a pinned collection-protocol artifact before install or consumer tests.
 *
 * Does not trust manifest identity fields alone: package_version, contract
 * schema, and source_commit must match protocol-identity.json inside the
 * tarball; package.json must match that identity; source_tree_sha256 and the
 * complete fixture digest key set are recomputed from artifact bytes.
 *
 * Archive members are validated against the manifest inventory before extract.
 */
export const verifyArtifact = (
  options: VerifyArtifactOptions,
): Effect.Effect<ArtifactManifest, ArtifactVerifyError> =>
  Effect.gen(function* () {
    const manifest = yield* decodeManifestInput(options.manifest);
    const actualSha = sha256Hex(readFileSync(options.tarballPath));
    if (actualSha !== manifest.artifact_sha256) {
      return yield* Effect.fail(
        new ArtifactChecksumMismatch({
          expected: manifest.artifact_sha256,
          actual: actualSha,
          reason: "artifact tarball SHA-256 does not match the manifest",
        }),
      );
    }

    if (
      options.expectedPackageVersion !== undefined &&
      options.expectedPackageVersion !== manifest.package_version
    ) {
      return yield* Effect.fail(
        new ArtifactVersionMismatch({
          field: "package_version",
          expected: options.expectedPackageVersion,
          actual: manifest.package_version,
          reason: "pinned package version does not match the artifact manifest",
        }),
      );
    }
    if (
      options.expectedContractMajor !== undefined &&
      options.expectedContractMajor !== manifest.contract_schema.major
    ) {
      return yield* Effect.fail(
        new ArtifactVersionMismatch({
          field: "contract_schema.major",
          expected: String(options.expectedContractMajor),
          actual: String(manifest.contract_schema.major),
          reason: "pinned contract major does not match the artifact manifest",
        }),
      );
    }
    if (
      options.expectedContractMinor !== undefined &&
      options.expectedContractMinor !== manifest.contract_schema.minor
    ) {
      return yield* Effect.fail(
        new ArtifactVersionMismatch({
          field: "contract_schema.minor",
          expected: String(options.expectedContractMinor),
          actual: String(manifest.contract_schema.minor),
          reason: "pinned contract minor does not match the artifact manifest",
        }),
      );
    }

    // Preflight on the archive itself before any extract/read of package/.
    yield* preflightArchiveMembers(options.tarballPath, manifest.files);

    const extractRoot = mkdtempSync(join(tmpdir(), "collection-protocol-verify-"));
    try {
      extractTarball(options.tarballPath, extractRoot);
      const packageRoot = packageRootFromExtract(extractRoot);
      const files = listHashedFiles(packageRoot);

      const fileListFailure = compareFileListsStrict(manifest.files, files);
      if (fileListFailure !== null) {
        return yield* Effect.fail(failureFromStrict(fileListFailure));
      }

      const identityEither = yield* Effect.either(
        decodeProtocolIdentityJson(
          readFileSync(join(packageRoot, PROTOCOL_IDENTITY_PATH), "utf8"),
        ),
      );
      if (Either.isLeft(identityEither)) {
        return yield* Effect.fail(identityEither.left);
      }
      const identity = identityEither.right;

      const identityFailure = assertIdentityMatchesManifest(identity, manifest);
      if (identityFailure !== null) {
        return yield* Effect.fail(failureFromStrict(identityFailure));
      }

      const packageJson = readPackageJsonIdentity(
        JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
      );
      const packageJsonFailure = assertPackageJsonMatchesIdentity(
        packageJson,
        identity,
      );
      if (packageJsonFailure !== null) {
        return yield* Effect.fail(failureFromStrict(packageJsonFailure));
      }

      const actualTree = sourceTreeSha256FromFiles(files, sha256Hex);
      if (actualTree !== manifest.source_tree_sha256) {
        return yield* Effect.fail(
          new ArtifactManifestMismatch({
            field: "source_tree_sha256",
            expected: manifest.source_tree_sha256,
            actual: actualTree,
            reason:
              "manifest source_tree_sha256 does not match the packed file inventory",
          }),
        );
      }

      const fixtureFailure = compareFixtureDigestsStrict(
        manifest.fixture_digests,
        fixtureDigestsFromFiles(files),
      );
      if (fixtureFailure !== null) {
        return yield* Effect.fail(failureFromStrict(fixtureFailure));
      }
    } finally {
      rmSync(extractRoot, { recursive: true, force: true });
    }

    return manifest;
  });

/**
 * Verify only the legacy CR-003/CR-105 temporary pin (checksum identity).
 * Prefer full manifest verification after consumers migrate to CR-005 packs.
 */
export const verifyLegacyArtifactSha256 = (
  tarballPath: string,
  expectedSha256: string,
): Effect.Effect<string, ArtifactChecksumMismatch> => {
  const actual = sha256Hex(readFileSync(tarballPath));
  if (actual !== expectedSha256) {
    return Effect.fail(
      new ArtifactChecksumMismatch({
        expected: expectedSha256,
        actual,
        reason: "legacy temporary artifact SHA-256 does not match the pin",
      }),
    );
  }
  return Effect.succeed(actual);
};

/**
 * Classify a verify/decode failure into a stable error-class tag shared by CLI
 * and library equivalence tests.
 */
export const artifactErrorClass = (error: unknown): string => {
  if (error !== null && typeof error === "object") {
    if (
      "_tag" in error &&
      (error as { _tag: unknown })._tag === "FiberFailure" &&
      "error" in error
    ) {
      return artifactErrorClass((error as { error: unknown }).error);
    }
    if ("_tag" in error) {
      const tag = (error as { _tag: unknown })._tag;
      if (typeof tag === "string" && tag.length > 0) {
        return tag;
      }
    }
  }
  if (error instanceof Error && error.name.length > 0) {
    // Effect sometimes stringifies as "(FiberFailure) ParseError"
    const fiber = /^\(FiberFailure\)\s+(.+)$/u.exec(error.name);
    if (fiber?.[1]) {
      return fiber[1];
    }
    return error.name;
  }
  return "ArtifactVerifyFailure";
};
