import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ArtifactManifest } from "./manifest.js";
import {
  PROTOCOL_IDENTITY_PATH,
  publishedProtocolIdentity,
  readPackageJsonIdentity,
  serializeProtocolIdentity,
  sourceTreeSha256FromFiles,
} from "./identity.js";
import { fixtureDigestsFromFiles, listHashedFiles, sha256Hex } from "./digests.js";
import {
  assertReachableSourceCommit,
  isDirtySourceTree,
  resolveRepositoryRoot,
} from "./source.js";
import { Effect } from "effect";
import { assertArchiveMembersWellFormed, listTarGzipMembers } from "./archive.js";

export interface PackArtifactOptions {
  readonly packageRoot: string;
  readonly outputDirectory: string;
  readonly sourceCommit: string;
  /** Override pack command (tests). Defaults to `pnpm pack`. */
  readonly packCommand?: ReadonlyArray<string>;
  /** Override build command inside the isolated staging tree. Defaults to `pnpm run build`. */
  readonly buildCommand?: ReadonlyArray<string>;
  /**
   * When true (default), wipe generated outputs and build inside a fresh
   * staging directory so pre-existing checkout `dist/` cannot enter the tarball.
   */
  readonly isolatedBuild?: boolean;
}

export interface PackArtifactResult {
  readonly tarballPath: string;
  readonly manifestPath: string;
  readonly manifest: ArtifactManifest;
  readonly dirtySourceTree: boolean;
}

const GENERATED_CLEAN_TARGETS = [
  "dist",
  ".tmp",
  "tsconfig.tsbuildinfo",
] as const;

const STAGING_COPY_ENTRIES = [
  "package.json",
  "tsconfig.json",
  "src",
  "fixtures",
  "scripts",
  "pins",
  "README.md",
  "CONSUMER.md",
  ".npmignore",
] as const;

const runCommand = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
): string =>
  execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "0",
      TZ: "UTC",
    },
  });

const cleanGeneratedOutputs = (root: string): void => {
  for (const target of GENERATED_CLEAN_TARGETS) {
    rmSync(join(root, target), { recursive: true, force: true });
  }
  try {
    execFileSync(
      "find",
      [root, "-maxdepth", "3", "-name", "*.tsbuildinfo", "-delete"],
      { stdio: "pipe" },
    );
  } catch {
    // find may be unavailable; generated targets above still cover the common case.
  }
};

const runPack = (
  packageRoot: string,
  destination: string,
  packCommand: ReadonlyArray<string>,
): string => {
  const [command, ...args] = packCommand;
  if (command === undefined) {
    throw new Error("packCommand must include an executable");
  }
  const output = runCommand(
    command,
    [...args, "--pack-destination", destination],
    packageRoot,
  );
  const match = output.match(/[\w.@/+\-]+\.tgz/);
  if (match === null) {
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".tgz"));
    const fallback = lines.at(-1);
    if (fallback === undefined) {
      throw new Error(`pnpm pack did not report a tarball path:\n${output}`);
    }
    return fallback;
  }
  const reported = match[0];
  if (reported.startsWith("/") || reported.includes("/")) {
    return reported;
  }
  return join(destination, reported);
};

const prepareIsolatedStaging = (
  packageRoot: string,
  buildCommand: ReadonlyArray<string>,
): string => {
  const staging = mkdtempSync(join(tmpdir(), "collection-protocol-isolated-"));
  for (const entry of STAGING_COPY_ENTRIES) {
    const source = join(packageRoot, entry);
    if (!existsSync(source)) {
      continue;
    }
    cpSync(source, join(staging, entry), { recursive: true });
  }
  const nodeModules = join(packageRoot, "node_modules");
  if (existsSync(nodeModules)) {
    symlinkSync(nodeModules, join(staging, "node_modules"), "dir");
  }
  cleanGeneratedOutputs(staging);
  const [command, ...args] = buildCommand;
  if (command === undefined) {
    throw new Error("buildCommand must include an executable");
  }
  runCommand(command, args, staging);
  return staging;
};

const writeIdentityFile = (packageRoot: string, sourceCommit: string): void => {
  const identity = publishedProtocolIdentity(sourceCommit);
  const packageJson = readPackageJsonIdentity(
    JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
  );
  if (packageJson.name !== identity.package_name) {
    throw new Error(
      `package.json name ${packageJson.name} does not match identity ${identity.package_name}`,
    );
  }
  if (packageJson.version !== identity.package_version) {
    throw new Error(
      `package.json version ${packageJson.version} does not match identity ${identity.package_version}`,
    );
  }
  writeFileSync(
    join(packageRoot, PROTOCOL_IDENTITY_PATH),
    serializeProtocolIdentity(identity),
    "utf8",
  );
};

const buildManifestFromTarball = (
  tarballPath: string,
  sourceCommit: string,
): ArtifactManifest => {
  const members = listTarGzipMembers(tarballPath);
  const wellFormed = Effect.runSync(assertArchiveMembersWellFormed(members));

  const extractRoot = mkdtempSync(join(tmpdir(), "collection-protocol-pack-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", extractRoot], {
      stdio: "pipe",
    });
    const packageRoot = join(extractRoot, "package");
    const files = [...listHashedFiles(packageRoot)];
    const extractedPaths = new Set(files.map((file) => file.path));
    for (const path of wellFormed.relativePaths) {
      if (!extractedPaths.has(path)) {
        throw new Error(
          `archive member ${path} missing after extraction`,
        );
      }
    }
    for (const path of extractedPaths) {
      if (!wellFormed.relativePaths.includes(path)) {
        throw new Error(
          `extracted path ${path} was not a validated archive member`,
        );
      }
    }
    const identityRaw = JSON.parse(
      readFileSync(join(packageRoot, PROTOCOL_IDENTITY_PATH), "utf8"),
    ) as {
      package_name: string;
      package_version: string;
      contract_schema: { major: number; minor: number };
      source_commit: string;
    };
    const packageJson = readPackageJsonIdentity(
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
    );
    if (identityRaw.package_name !== "@freeside/collection-protocol") {
      throw new Error(
        `unexpected identity package_name: ${identityRaw.package_name}`,
      );
    }
    if (packageJson.name !== identityRaw.package_name) {
      throw new Error(
        "packaged package.json name does not match protocol-identity.json",
      );
    }
    if (packageJson.version !== identityRaw.package_version) {
      throw new Error(
        "packaged package.json version does not match protocol-identity.json",
      );
    }
    if (identityRaw.source_commit !== sourceCommit) {
      throw new Error(
        `identity source_commit ${identityRaw.source_commit} does not match pack source_commit ${sourceCommit}`,
      );
    }
    return {
      manifest_version: 1,
      package_name: "@freeside/collection-protocol",
      package_version: identityRaw.package_version,
      contract_schema: identityRaw.contract_schema,
      source_commit: identityRaw.source_commit,
      source_tree_sha256: sourceTreeSha256FromFiles(files, sha256Hex),
      artifact_sha256: sha256Hex(readFileSync(tarballPath)),
      files,
      fixture_digests: fixtureDigestsFromFiles(files),
    };
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }
};

/**
 * Canonical CR-005 pack: clean isolated build → identity file → deterministic
 * pnpm pack tarball + sidecar manifest. Artifact SHA cannot live inside the
 * tarball; identity fields are bound to protocol-identity.json inside it.
 *
 * Dirty working trees may pack, but only alongside `source_tree_sha256` which
 * binds the exact packed inventory — a dirty tree cannot claim commit-only
 * cleanliness.
 */
export const packArtifact = (options: PackArtifactOptions): PackArtifactResult => {
  const packageRoot = resolve(options.packageRoot);
  const outputDirectory = resolve(options.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });

  const repositoryRoot = resolveRepositoryRoot(packageRoot);
  const sourceCommit = assertReachableSourceCommit(
    repositoryRoot,
    options.sourceCommit,
  );
  const dirtySourceTree = isDirtySourceTree(repositoryRoot);

  const isolated = options.isolatedBuild !== false;
  let packRoot = packageRoot;
  let createdStaging: string | undefined;

  if (isolated) {
    createdStaging = prepareIsolatedStaging(
      packageRoot,
      options.buildCommand ?? ["pnpm", "run", "build"],
    );
    packRoot = createdStaging;
  } else {
    cleanGeneratedOutputs(packRoot);
    const buildCommand = options.buildCommand ?? ["pnpm", "run", "build"];
    const [command, ...args] = buildCommand;
    if (command === undefined) {
      throw new Error("buildCommand must include an executable");
    }
    runCommand(command, args, packRoot);
  }

  const packOut = mkdtempSync(join(tmpdir(), "collection-protocol-pack-out-"));
  try {
    writeIdentityFile(packRoot, sourceCommit);
    const stagedTarball = runPack(
      packRoot,
      packOut,
      options.packCommand ?? ["pnpm", "pack"],
    );
    const tarballName = basename(stagedTarball);
    const tarballPath = join(outputDirectory, tarballName);
    copyFileSync(stagedTarball, tarballPath);

    const manifest = buildManifestFromTarball(tarballPath, sourceCommit);
    const manifestPath = join(
      outputDirectory,
      tarballName.replace(/\.tgz$/u, "") + ".manifest.json",
    );
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return {
      tarballPath,
      manifestPath,
      manifest,
      dirtySourceTree,
    };
  } finally {
    rmSync(packOut, { recursive: true, force: true });
    if (createdStaging !== undefined) {
      rmSync(createdStaging, { recursive: true, force: true });
    } else {
      rmSync(join(packRoot, PROTOCOL_IDENTITY_PATH), { force: true });
    }
  }
};
