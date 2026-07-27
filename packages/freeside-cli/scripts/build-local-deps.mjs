#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, "..");
const repoRoot = resolve(cliRoot, "../..");

const runBuild = (packageDir) => {
  const result = spawnSync("pnpm", ["build"], { cwd: packageDir, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const readPackage = (packageDir) =>
  JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf-8"));

const refreshFileDependencyDist = (sourceRel, installedRel) => {
  const sourceRoot = resolve(repoRoot, sourceRel);
  const installedRoot = resolve(repoRoot, installedRel);
  const sourceDist = resolve(sourceRoot, "dist");

  if (!existsSync(installedRoot) || !existsSync(sourceDist)) return;

  const sourcePackage = readPackage(sourceRoot);
  const installedPackage = readPackage(installedRoot);
  if (sourcePackage.name !== installedPackage.name || sourcePackage.version !== installedPackage.version) {
    throw new Error(
      `Refusing to refresh ${installedRel}: expected ${sourcePackage.name}@${sourcePackage.version}, ` +
        `found ${installedPackage.name}@${installedPackage.version}`,
    );
  }

  // Local pnpm file: dependencies are materialized as package snapshots, not live
  // workspace links. Refresh only the built dist payload for the exact local
  // dependency package that Node will load when executing the compiled CLI.
  const installedDist = resolve(installedRoot, "dist");

  // npm can materialize file: dependencies as symlinks. In that layout the
  // installed dist is the source dist; deleting it would erase the build we
  // just produced and make the following copy fail with ENOENT.
  if (existsSync(installedDist) && realpathSync(installedDist) === realpathSync(sourceDist)) return;

  rmSync(installedDist, { recursive: true, force: true });
  cpSync(sourceDist, installedDist, { recursive: true });
};

runBuild(resolve(repoRoot, "packages/beacon-schema"));
refreshFileDependencyDist("packages/beacon-schema", "packages/freeside-registry/node_modules/@freeside/beacon-schema");
refreshFileDependencyDist("packages/beacon-schema", "packages/freeside-cli/node_modules/@freeside/beacon-schema");

runBuild(resolve(repoRoot, "packages/freeside-registry"));
refreshFileDependencyDist("packages/freeside-registry", "packages/freeside-cli/node_modules/@freeside/freeside-registry");