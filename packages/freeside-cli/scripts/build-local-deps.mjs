#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, "..");
const repoRoot = resolve(cliRoot, "../..");
const packageManagerExecPath = process.env.npm_execpath;

if (!packageManagerExecPath) {
  throw new Error("Cannot build local dependencies: npm_execpath is not set");
}

const assertWithin = (parent, child, label) => {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`Refusing ${label}: ${child} escapes ${parent}`);
};

const runBuild = (packageDir) => {
  assertWithin(repoRoot, packageDir, "package build outside repository root");
  const result = spawnSync(process.execPath, [packageManagerExecPath, "run", "build"], {
    cwd: packageDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const readPackage = (packageDir) =>
  JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf-8"));

const refreshFileDependencyDist = (sourceRel, installedRel) => {
  const sourceRoot = resolve(repoRoot, sourceRel);
  const installedRoot = resolve(repoRoot, installedRel);
  assertWithin(repoRoot, sourceRoot, "source package outside repository root");
  assertWithin(repoRoot, installedRoot, "installed package outside repository root");

  if (!existsSync(installedRoot)) {
    throw new Error(`Expected installed local dependency is missing: ${installedRel}`);
  }

  const sourceDist = resolve(sourceRoot, "dist");
  if (!existsSync(sourceDist)) {
    throw new Error(`Expected source dist is missing after build: ${sourceRel}/dist`);
  }

  const sourcePackage = readPackage(sourceRoot);
  const installedPackage = readPackage(installedRoot);
  if (sourcePackage.name !== installedPackage.name || sourcePackage.version !== installedPackage.version) {
    throw new Error(
      `Refusing to refresh ${installedRel}: expected ${sourcePackage.name}@${sourcePackage.version}, ` +
        `found ${installedPackage.name}@${installedPackage.version}`,
    );
  }

  const sourceRootReal = realpathSync(sourceRoot);
  const installedRootReal = realpathSync(installedRoot);
  assertWithin(repoRoot, sourceRootReal, "resolved source package outside repository root");
  assertWithin(repoRoot, installedRootReal, "resolved installed package outside repository root");

  // npm can materialize file: dependencies as symlinks to the source package.
  // In that layout the dependency already consumes the source dist directly.
  if (sourceRootReal === installedRootReal) return;

  // pnpm materializes file: dependencies as package snapshots. Refresh only the
  // built dist payload for the exact local dependency package the CLI loads.
  const installedDist = resolve(installedRoot, "dist");
  assertWithin(installedRoot, installedDist, "installed dist outside package root");
  rmSync(installedDist, { recursive: true, force: true });
  cpSync(sourceDist, installedDist, { recursive: true });
};

runBuild(resolve(repoRoot, "packages/beacon-schema"));
refreshFileDependencyDist("packages/beacon-schema", "packages/freeside-registry/node_modules/@freeside/beacon-schema");
refreshFileDependencyDist("packages/beacon-schema", "packages/freeside-cli/node_modules/@freeside/beacon-schema");

runBuild(resolve(repoRoot, "packages/freeside-registry"));
refreshFileDependencyDist("packages/freeside-registry", "packages/freeside-cli/node_modules/@freeside/freeside-registry");
