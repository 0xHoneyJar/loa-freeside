#!/usr/bin/env node
/**
 * Load the collection-protocol harness from a fresh isolated staging build.
 *
 * Never imports or executes pre-existing checkout `dist/` output. Used by
 * `pack-artifact.mjs` (always) and by `verify-artifact.mjs` when TypeScript is
 * available so CLI and library share one compiled validator.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STAGING_COPY_ENTRIES = [
  "package.json",
  "tsconfig.json",
  "src",
];

const cleanGenerated = (root) => {
  rmSync(join(root, "dist"), { recursive: true, force: true });
  rmSync(join(root, "tsconfig.tsbuildinfo"), { force: true });
  try {
    execFileSync(
      "find",
      [root, "-maxdepth", "3", "-name", "*.tsbuildinfo", "-delete"],
      { stdio: "pipe" },
    );
  } catch {
    // optional
  }
};

const resolveTsc = (packageRoot) => {
  const candidates = [
    join(packageRoot, "node_modules", "typescript", "bin", "tsc"),
    join(packageRoot, "node_modules", ".bin", "tsc"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

/**
 * @param {string} packageRoot
 * @returns {Promise<{ harness: any, stagingRoot: string, cleanup: () => void }>}
 */
export const loadHarnessFromIsolatedBuild = async (packageRoot) => {
  const root = resolve(packageRoot);
  const tsc = resolveTsc(root);
  if (tsc === null) {
    throw new Error(
      "typescript is required to build an isolated harness (devDependency)",
    );
  }

  const stagingRoot = mkdtempSync(
    join(tmpdir(), "collection-protocol-harness-"),
  );
  const cleanup = () => {
    rmSync(stagingRoot, { recursive: true, force: true });
  };

  try {
    for (const entry of STAGING_COPY_ENTRIES) {
      const source = join(root, entry);
      if (!existsSync(source)) {
        throw new Error(`missing required pack input: ${entry}`);
      }
      cpSync(source, join(stagingRoot, entry), { recursive: true });
    }
    const nodeModules = join(root, "node_modules");
    if (existsSync(nodeModules)) {
      symlinkSync(nodeModules, join(stagingRoot, "node_modules"), "dir");
    }
    cleanGenerated(stagingRoot);
    execFileSync(process.execPath, [tsc, "-b", "--force"], {
      cwd: stagingRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "0",
        TZ: "UTC",
      },
    });

    const harnessUrl = pathToFileURL(
      join(stagingRoot, "dist/harness/index.js"),
    ).href;
    const harness = await import(harnessUrl);
    return { harness, stagingRoot, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
};

/**
 * Resolve harness for verify CLI:
 * - With typescript available: isolated build (never trust checkout dist).
 * - Consumer install without typescript: use published package dist.
 */
export const loadHarnessForVerify = async (packageRoot) => {
  const root = resolve(packageRoot);
  if (resolveTsc(root) !== null) {
    return loadHarnessFromIsolatedBuild(root);
  }
  const distIndex = join(root, "dist/harness/index.js");
  if (!existsSync(distIndex)) {
    throw new Error(
      "harness dist missing and typescript unavailable for isolated rebuild",
    );
  }
  const harness = await import(pathToFileURL(distIndex).href);
  return {
    harness,
    stagingRoot: null,
    cleanup: () => {},
  };
};

// Allow direct execution for debugging.
const isDirect =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(here, "../..");
  const loaded = await loadHarnessFromIsolatedBuild(packageRoot);
  console.log(
    JSON.stringify({
      ok: true,
      staging: loaded.stagingRoot,
      exports: Object.keys(loaded.harness).sort(),
    }),
  );
  loaded.cleanup();
}
