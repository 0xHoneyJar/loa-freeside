import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const collectionRoot = join(packageRoot, "..", "collection");
const temporaryRoot = mkdtempSync(join(tmpdir(), "collection-resolution-pack-"));
const tarballRoot = join(temporaryRoot, "tarballs");
const consumerRoot = join(temporaryRoot, "consumer");

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  mkdirSync(tarballRoot, { recursive: true });
  mkdirSync(consumerRoot, { recursive: true });

  run("pnpm", ["run", "clean"], collectionRoot);
  run("pnpm", ["run", "clean"], packageRoot);

  const collectionTarballName = run(
    "pnpm",
    ["pack", "--pack-destination", tarballRoot],
    collectionRoot,
  ).split("\n").at(-1);
  const resolutionTarballName = run(
    "pnpm",
    ["pack", "--pack-destination", tarballRoot],
    packageRoot,
  ).split("\n").at(-1);

  if (!collectionTarballName || !resolutionTarballName) {
    throw new Error("pnpm pack did not report both tarball paths");
  }

  const collectionTarball = isAbsolute(collectionTarballName)
    ? collectionTarballName
    : join(tarballRoot, collectionTarballName);
  const resolutionTarball = isAbsolute(resolutionTarballName)
    ? resolutionTarballName
    : join(tarballRoot, resolutionTarballName);

  for (const tarball of [collectionTarball, resolutionTarball]) {
    const contents = run("tar", ["-tzf", tarball], packageRoot).split("\n");
    for (const requiredPath of ["package/dist/index.js", "package/dist/index.d.ts"]) {
      if (!contents.includes(requiredPath)) {
        throw new Error(`${tarball} does not contain ${requiredPath}`);
      }
    }
  }

  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@freeside/collection-protocol": `file:${collectionTarball}`,
          "@freeside/collection-resolution-protocol": `file:${resolutionTarball}`,
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
      [
        'const protocol = await import("@freeside/collection-resolution-protocol");',
        'if (typeof protocol.decodeCandidateSnapshot !== "function") {',
        '  throw new Error("packed protocol export is unavailable");',
        "}",
      ].join("\n"),
    ],
    consumerRoot,
  );

  process.stdout.write("packed collection-resolution consumer import verified\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
