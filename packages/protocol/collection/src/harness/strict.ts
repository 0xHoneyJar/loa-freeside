import type { ArtifactManifest } from "./manifest.js";
import type { ProtocolIdentity } from "./identity.js";

export type StrictVerifyFailure = {
  readonly _tag: string;
  readonly field?: string;
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly reason: string;
};

const fail = (
  tag: string,
  details: Omit<StrictVerifyFailure, "_tag" | "reason"> & { reason: string },
): StrictVerifyFailure => ({
  _tag: tag,
  ...details,
});

const sortedKeys = (record: Record<string, string>): Array<string> =>
  Object.keys(record).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

/**
 * Compare fixture digest maps with exact key-set + digest equality.
 * Missing, extra, unknown, renamed, or digest-drift entries all fail.
 * Used by both the Effect library path and the CLI strict verifier.
 */
export const compareFixtureDigestsStrict = (
  expected: Record<string, string>,
  actual: Record<string, string>,
): StrictVerifyFailure | null => {
  const expectedKeys = sortedKeys(expected);
  const actualKeys = sortedKeys(actual);
  if (expectedKeys.length !== actualKeys.length) {
    return fail("ArtifactFixtureDigestMismatch", {
      path: "<fixture_digests>",
      expected: expectedKeys.join(","),
      actual: actualKeys.join(","),
      reason:
        "fixture digest key set must match the complete canonical fixture set exactly",
    });
  }
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const expectedKey = expectedKeys[index];
    const actualKey = actualKeys[index];
    if (expectedKey === undefined || actualKey === undefined) {
      return fail("ArtifactFixtureDigestMismatch", {
        path: "<fixture_digests>",
        expected: expectedKey ?? "<missing>",
        actual: actualKey ?? "<missing>",
        reason: "fixture digest key set drift",
      });
    }
    if (expectedKey !== actualKey) {
      return fail("ArtifactFixtureDigestMismatch", {
        path: expectedKey,
        expected: expectedKey,
        actual: actualKey,
        reason:
          "fixture digest keys differ (missing, extra, renamed, or semantic reorder drift)",
      });
    }
    const expectedDigest = expected[expectedKey];
    const actualDigest = actual[actualKey];
    if (expectedDigest === undefined || actualDigest === undefined) {
      return fail("ArtifactFixtureDigestMismatch", {
        path: expectedKey,
        expected: expectedDigest ?? "<missing>",
        actual: actualDigest ?? "<missing>",
        reason: "fixture digest missing",
      });
    }
    if (expectedDigest !== actualDigest) {
      return fail("ArtifactFixtureDigestMismatch", {
        path: expectedKey,
        expected: expectedDigest,
        actual: actualDigest,
        reason: "fixture bytes do not match the pinned digest",
      });
    }
  }
  return null;
};

export const compareFileListsStrict = (
  expected: ReadonlyArray<{ path: string; sha256: string; size: number }>,
  actual: ReadonlyArray<{ path: string; sha256: string; size: number }>,
): StrictVerifyFailure | null => {
  if (expected.length !== actual.length) {
    return fail("ArtifactManifestMismatch", {
      field: "files.length",
      expected: String(expected.length),
      actual: String(actual.length),
      reason: "packaged file count does not match the manifest",
    });
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (left === undefined || right === undefined) {
      return fail("ArtifactManifestMismatch", {
        field: `files[${index}]`,
        expected: left?.path ?? "<missing>",
        actual: right?.path ?? "<missing>",
        reason: "packaged file list drift",
      });
    }
    if (
      left.path !== right.path ||
      left.sha256 !== right.sha256 ||
      left.size !== right.size
    ) {
      return fail("ArtifactManifestMismatch", {
        field: `files[${index}]`,
        expected: `${left.path}:${left.sha256}:${left.size}`,
        actual: `${right.path}:${right.sha256}:${right.size}`,
        reason: "packaged file entry does not match the manifest",
      });
    }
  }
  return null;
};

export const assertIdentityMatchesManifest = (
  identity: ProtocolIdentity,
  manifest: Pick<
    ArtifactManifest,
    "package_name" | "package_version" | "contract_schema" | "source_commit"
  >,
): StrictVerifyFailure | null => {
  if (identity.package_name !== manifest.package_name) {
    return fail("ArtifactManifestMismatch", {
      field: "package_name",
      expected: identity.package_name,
      actual: manifest.package_name,
      reason: "manifest package_name does not match protocol-identity.json",
    });
  }
  if (identity.package_version !== manifest.package_version) {
    return fail("ArtifactManifestMismatch", {
      field: "package_version",
      expected: identity.package_version,
      actual: manifest.package_version,
      reason: "manifest package_version does not match protocol-identity.json",
    });
  }
  if (
    identity.contract_schema.major !== manifest.contract_schema.major ||
    identity.contract_schema.minor !== manifest.contract_schema.minor
  ) {
    return fail("ArtifactManifestMismatch", {
      field: "contract_schema",
      expected: `${identity.contract_schema.major}.${identity.contract_schema.minor}`,
      actual: `${manifest.contract_schema.major}.${manifest.contract_schema.minor}`,
      reason: "manifest contract_schema does not match protocol-identity.json",
    });
  }
  if (identity.source_commit !== manifest.source_commit) {
    return fail("ArtifactManifestMismatch", {
      field: "source_commit",
      expected: identity.source_commit,
      actual: manifest.source_commit,
      reason: "manifest source_commit does not match protocol-identity.json",
    });
  }
  return null;
};

export const assertPackageJsonMatchesIdentity = (
  packageJson: { name: string; version: string },
  identity: ProtocolIdentity,
): StrictVerifyFailure | null => {
  if (packageJson.name !== identity.package_name) {
    return fail("ArtifactManifestMismatch", {
      field: "package.json.name",
      expected: identity.package_name,
      actual: packageJson.name,
      reason: "package.json name does not match protocol-identity.json",
    });
  }
  if (packageJson.version !== identity.package_version) {
    return fail("ArtifactManifestMismatch", {
      field: "package.json.version",
      expected: identity.package_version,
      actual: packageJson.version,
      reason: "package.json version does not match protocol-identity.json",
    });
  }
  return null;
};
