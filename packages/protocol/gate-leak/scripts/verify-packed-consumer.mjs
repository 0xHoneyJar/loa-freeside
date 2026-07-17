import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const collectionRoot = join(packageRoot, "..", "collection");
const temporaryRoot = mkdtempSync(join(tmpdir(), "gate-leak-pack-"));
const tarballRoot = join(temporaryRoot, "tarballs");
const consumerRoot = join(temporaryRoot, "consumer");

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const absoluteTarballPath = (packedName) =>
  isAbsolute(packedName) ? packedName : join(tarballRoot, packedName);

try {
  mkdirSync(tarballRoot, { recursive: true });
  mkdirSync(consumerRoot, { recursive: true });

  run("pnpm", ["run", "clean"], collectionRoot);
  run("pnpm", ["run", "clean"], packageRoot);

  const collectionTarball = absoluteTarballPath(
    run("pnpm", ["pack", "--pack-destination", tarballRoot], collectionRoot)
      .split("\n")
      .at(-1),
  );
  const gateLeakTarball = absoluteTarballPath(
    run("pnpm", ["pack", "--pack-destination", tarballRoot], packageRoot)
      .split("\n")
      .at(-1),
  );

  for (const tarball of [collectionTarball, gateLeakTarball]) {
    const entries = run("tar", ["-tzf", tarball], temporaryRoot);
    for (const requiredEntry of ["package/dist/index.js", "package/dist/index.d.ts"]) {
      if (!entries.split("\n").includes(requiredEntry)) {
        throw new Error(`${tarball} is missing ${requiredEntry}`);
      }
    }
  }

  const packedManifest = JSON.parse(
    run("tar", ["-xOf", gateLeakTarball, "package/package.json"], temporaryRoot),
  );
  const collectionRange =
    packedManifest.dependencies?.["@freeside/collection-protocol"];
  if (collectionRange !== "^1.0.0") {
    throw new Error(
      `packed Gate Leak manifest has unsafe collection dependency: ${collectionRange}`,
    );
  }

  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@freeside/collection-protocol": `file:${collectionTarball}`,
          "@freeside/gate-leak-protocol": `file:${gateLeakTarball}`,
          effect: "^3.21.0",
        },
        pnpm: {
          overrides: {
            "@freeside/collection-protocol": `file:${collectionTarball}`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  run("pnpm", ["install", "--ignore-scripts"], consumerRoot);
  run(
    "node",
    [
      "--input-type=module",
      "--eval",
      'const protocol = await import("@freeside/gate-leak-protocol"); if (typeof protocol.evaluateGateLeakReadiness !== "function") throw new Error("missing Gate Leak ESM export");',
    ],
    consumerRoot,
  );

  process.stdout.write("packed Gate Leak consumer install and ESM import verified\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
