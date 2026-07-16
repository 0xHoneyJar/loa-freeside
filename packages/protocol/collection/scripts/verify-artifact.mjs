#!/usr/bin/env node
/**
 * Consumer-neutral verification for a pinned @freeside/collection-protocol artifact.
 *
 * Usage:
 *   node scripts/verify-artifact.mjs --tarball <path> --manifest <path> \
 *     [--expect-version <semver>] [--expect-major <n>] [--expect-minor <n>]
 *
 *   node scripts/verify-artifact.mjs --tarball <path> --legacy-sha256 <hex>
 *
 * Exit 0 on success; non-zero with a typed failure tag on mismatch.
 *
 * Manifest mode always invokes the same compiled harness verifier as the
 * library (`verifyArtifact`) — there is no weaker / duplicated schema path.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Cause, Effect, Exit } from "effect";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

const parseArgs = (argv) => {
  const options = {
    tarball: "",
    manifest: "",
    legacySha256: "",
    expectVersion: "",
    expectMajor: "",
    expectMinor: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    const next = () => argv[++index] ?? "";
    switch (arg) {
      case "--tarball":
        options.tarball = resolve(next());
        break;
      case "--manifest":
        options.manifest = resolve(next());
        break;
      case "--legacy-sha256":
        options.legacySha256 = next();
        break;
      case "--expect-version":
        options.expectVersion = next();
        break;
      case "--expect-major":
        options.expectMajor = next();
        break;
      case "--expect-minor":
        options.expectMinor = next();
        break;
      case "--help":
      case "-h":
        console.log(`Usage:
  verify-artifact.mjs --tarball <path> --manifest <path> [--expect-version V] [--expect-major N] [--expect-minor N]
  verify-artifact.mjs --tarball <path> --legacy-sha256 <hex>`);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
};

const fail = (tag, details) => {
  console.error(JSON.stringify({ ok: false, tag, ...details }, null, 2));
  process.exit(1);
};

const failureFromExit = (exit) => {
  const failures = Array.from(Cause.failures(exit.cause));
  if (failures[0] !== undefined) {
    return failures[0];
  }
  const defects = Array.from(Cause.defects(exit.cause));
  if (defects[0] !== undefined) {
    return defects[0];
  }
  return exit.cause;
};

const options = parseArgs(process.argv.slice(2));
if (!options.tarball) {
  fail("UsageError", { reason: "--tarball is required" });
}

const actualSha = sha256Hex(readFileSync(options.tarball));

if (options.legacySha256) {
  if (actualSha !== options.legacySha256) {
    fail("ArtifactChecksumMismatch", {
      expected: options.legacySha256,
      actual: actualSha,
      reason: "legacy temporary artifact SHA-256 does not match the pin",
    });
  }
  console.log(
    JSON.stringify(
      { ok: true, mode: "legacy-sha256", artifact_sha256: actualSha },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!options.manifest) {
  fail("UsageError", {
    reason: "--manifest is required unless --legacy-sha256 is used",
  });
}

const loaderUrl = pathToFileURL(join(here, "lib/isolated-harness.mjs")).href;
const { loadHarnessForVerify } = await import(loaderUrl);
const loaded = await loadHarnessForVerify(packageRoot);

try {
  const { verifyArtifact, artifactErrorClass } = loaded.harness;
  const manifestText = readFileSync(options.manifest, "utf8");

  const exit = await Effect.runPromiseExit(
    verifyArtifact({
      tarballPath: options.tarball,
      manifest: manifestText,
      expectedPackageVersion: options.expectVersion || undefined,
      expectedContractMajor:
        options.expectMajor === ""
          ? undefined
          : Number(options.expectMajor),
      expectedContractMinor:
        options.expectMinor === ""
          ? undefined
          : Number(options.expectMinor),
    }),
  );

  if (Exit.isFailure(exit)) {
    const error = failureFromExit(exit);
    const tag = artifactErrorClass(error);
    fail(tag, {
      error: {
        _tag: tag,
        field:
          error !== null && typeof error === "object" && "field" in error
            ? error.field
            : undefined,
        path:
          error !== null && typeof error === "object" && "path" in error
            ? error.path
            : undefined,
        expected:
          error !== null && typeof error === "object" && "expected" in error
            ? error.expected
            : undefined,
        actual:
          error !== null && typeof error === "object" && "actual" in error
            ? error.actual
            : undefined,
        reason:
          error !== null && typeof error === "object" && "reason" in error
            ? error.reason
            : String(error),
        key:
          error !== null && typeof error === "object" && "key" in error
            ? error.key
            : undefined,
      },
    });
  }

  const manifest = exit.value;
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "manifest",
        artifact_sha256: manifest.artifact_sha256,
        package_version: manifest.package_version,
        contract_schema: manifest.contract_schema,
        source_commit: manifest.source_commit,
        source_tree_sha256: manifest.source_tree_sha256,
      },
      null,
      2,
    ),
  );
} finally {
  loaded.cleanup();
}
