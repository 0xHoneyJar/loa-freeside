/**
 * Compatibility shim — CLI/library share one compiled harness verifier.
 *
 * Do not reintroduce a second schema decoder here. Prefer:
 *   node scripts/verify-artifact.mjs
 *   import { verifyArtifact } from '@freeside/collection-protocol/harness'
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Effect } from "effect";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const loaderUrl = pathToFileURL(join(here, "isolated-harness.mjs")).href;

export const sha256Hex = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Strict artifact verification — delegates to the shared harness verifier.
 */
export const verifyArtifactStrict = async (options) => {
  const { loadHarnessForVerify } = await import(loaderUrl);
  const loaded = await loadHarnessForVerify(packageRoot);
  try {
    const { verifyArtifact } = loaded.harness;
    return await Effect.runPromise(
      verifyArtifact({
        tarballPath: options.tarballPath,
        manifest:
          typeof options.manifest === "string"
            ? options.manifest
            : (options.manifestText ?? options.manifest),
        expectedPackageVersion: options.expectedPackageVersion,
        expectedContractMajor:
          options.expectedContractMajor === undefined ||
          options.expectedContractMajor === ""
            ? undefined
            : Number(options.expectedContractMajor),
        expectedContractMinor:
          options.expectedContractMinor === undefined ||
          options.expectedContractMinor === ""
            ? undefined
            : Number(options.expectedContractMinor),
      }),
    );
  } finally {
    loaded.cleanup();
  }
};
