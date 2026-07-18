import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  decodeGateManifestSync,
  decodeApprovalKeyringSync,
  decodeRepositoryAcceptanceKeyringSync,
  decodeRepositoryAcceptanceReceiptsSync,
  flattenTaskManifest,
  type ApprovalAuthorities,
  type GateManifestT,
  type RepositoryAcceptanceAuthorities,
  type RepositoryAcceptanceReceiptT,
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
  const flattened = flattenTaskManifest(parse(bytes.toString("utf8")));
  return {
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ...flattened,
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

export const loadRepositoryAcceptanceReceipts = (
  directory: "positive" | "negative" = "positive",
  fixture = "repository-acceptance-receipts.yaml",
): readonly RepositoryAcceptanceReceiptT[] =>
  decodeRepositoryAcceptanceReceiptsSync(
    readYaml(fixturePath("test-vectors", directory, fixture)),
  ).receipts;

export const loadRepositoryAcceptanceAuthorities =
  (): RepositoryAcceptanceAuthorities => {
    const keyring = decodeRepositoryAcceptanceKeyringSync(
      readYaml(
        fixturePath(
          "test-vectors",
          "trust",
          "repository-acceptance-keyring.yaml",
        ),
      ),
    );
    return new Map(
      keyring.authorities.map((authority) => [
        authority.repository,
        {
          owner: authority.owner,
          key_id: authority.key_id,
          public_key: authority.public_key,
        },
      ]),
    );
  };
