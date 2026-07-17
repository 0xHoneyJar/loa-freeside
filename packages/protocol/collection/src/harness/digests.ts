import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ArtifactFileEntry } from "./manifest.js";

export const sha256Hex = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const toPosix = (path: string): string => path.split(sep).join("/");

const walkFiles = (root: string, current = root): Array<string> => {
  const entries = readdirSync(current, { withFileTypes: true });
  const files: Array<string> = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolute));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
};

export const listHashedFiles = (root: string): ReadonlyArray<ArtifactFileEntry> => {
  const files = walkFiles(root)
    .map((absolute) => {
      const path = toPosix(relative(root, absolute));
      const bytes = readFileSync(absolute);
      return {
        path,
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
      } satisfies ArtifactFileEntry;
    })
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return files;
};

export const fixtureDigestsFromFiles = (
  files: ReadonlyArray<ArtifactFileEntry>,
): Record<string, string> => {
  const digests: Record<string, string> = {};
  for (const file of files) {
    if (!file.path.startsWith("fixtures/") || !file.path.endsWith(".json")) {
      continue;
    }
    digests[file.path] = file.sha256;
  }
  return Object.fromEntries(
    Object.entries(digests).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
};

export const directoryExists = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
