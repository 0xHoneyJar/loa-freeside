import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  decodeGateManifestSync,
  decodeApprovalKeyringSync,
  flattenTaskManifest,
  type ApprovalAuthorities,
  type GateManifestT,
  type SourceInventory,
} from "../src/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(testDirectory, "..");

export const fixturePath = (...parts: ReadonlyArray<string>): string =>
  resolve(packageRoot, ...parts);

export const readYaml = (path: string): unknown =>
  parse(readFileSync(path, "utf8"));

export const loadManifest = (): GateManifestT =>
  decodeGateManifestSync(
    readYaml(fixturePath("manifest", "collection-report.gates.yaml")),
  );

export const loadSourceInventory = (): SourceInventory => {
  const path = fixturePath("test-vectors", "source", "task-manifest.yaml");
  const bytes = readFileSync(path);
  return {
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    tasks: flattenTaskManifest(parse(bytes.toString("utf8"))),
  };
};

export const loadApprovalAuthorities = (): ApprovalAuthorities => {
  const keyring = decodeApprovalKeyringSync(
    readYaml(
      fixturePath(
        "test-vectors",
        "trust",
        "approval-keyring.yaml",
      ),
    ),
  );
  return new Map(
    keyring.authorities.map((authority) => [
      authority.owner,
      {
        key_id: authority.key_id,
        public_key: authority.public_key,
      },
    ]),
  );
};
