#!/usr/bin/env node
/**
 * Canonical CR-005 pack command for @freeside/collection-protocol.
 *
 * Usage:
 *   node scripts/pack-artifact.mjs [--out <dir>] [--source-commit <sha>]
 *
 * Never imports or executes checkout `dist/`. The packer implementation is
 * compiled and loaded from a fresh isolated staging build created in this
 * invocation; `packArtifact` then performs its own isolated package build.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

const parseArgs = (argv) => {
  const options = {
    out: join(packageRoot, ".tmp/artifact"),
    sourceCommit: process.env.SOURCE_COMMIT ?? "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--out") {
      options.out = resolve(argv[++index] ?? "");
      continue;
    }
    if (arg === "--source-commit") {
      options.sourceCommit = argv[++index] ?? "";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: pack-artifact.mjs [--out <dir>] [--source-commit <sha>]`,
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
};

const resolveSourceCommit = (explicit) => {
  if (/^[0-9a-f]{40}$/.test(explicit)) {
    return explicit;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: packageRoot,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    throw new Error(
      `unable to resolve source commit; pass --source-commit <sha40> (${String(error)})`,
    );
  }
};

const options = parseArgs(process.argv.slice(2));
mkdirSync(options.out, { recursive: true });

const loaderUrl = pathToFileURL(join(here, "lib/isolated-harness.mjs")).href;
const { loadHarnessFromIsolatedBuild } = await import(loaderUrl);
const loaded = await loadHarnessFromIsolatedBuild(packageRoot);

try {
  const { packArtifact } = loaded.harness;
  const result = packArtifact({
    packageRoot,
    outputDirectory: options.out,
    sourceCommit: resolveSourceCommit(options.sourceCommit),
    isolatedBuild: true,
  });

  console.log(
    JSON.stringify(
      {
        tarball: result.tarballPath,
        manifest: result.manifestPath,
        artifact_sha256: result.manifest.artifact_sha256,
        package_version: result.manifest.package_version,
        contract_schema: result.manifest.contract_schema,
        source_commit: result.manifest.source_commit,
        source_tree_sha256: result.manifest.source_tree_sha256,
        dirty_source_tree: result.dirtySourceTree,
        file_count: result.manifest.files.length,
        fixture_count: Object.keys(result.manifest.fixture_digests).length,
      },
      null,
      2,
    ),
  );
} finally {
  loaded.cleanup();
}
