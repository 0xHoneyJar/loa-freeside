/**
 * @freeside/freeside-registry · beacon-loader (cycle-049 FR-2, NFR-4)
 *
 * Resolves a registry module's beacon. Fixture-aware: a `ModuleEntry` MAY
 * point at an in-repo fixture file (`beacon_fixture`) instead of a remote
 * `beacon_url`. The fixture path is hardened (NFR-4 audit rigor) — `..`
 * rejection + realpath + REPO_ROOT-style containment, mirroring the L7
 * `realpath` + containment pattern.
 *
 * V2/V3 discrimination — DEVIATION D-S2-1 from SDD §3.2:
 *   SDD §3.2 / sprint Task 2.3 specify discriminating on the in-YAML
 *   `schema_version` field (`"3"` → V3). That is impossible against the
 *   shipped schema: `BeaconV3Schema` extends `BeaconV2Schema`, which pins
 *   `schema_version: Schema.Literal("2")` — a V3 beacon therefore carries
 *   `schema_version: "2"` (the existing `freeside-inventory-v3.yaml` fixture
 *   proves this). V3-ness is signalled by the V3 *fields*, not the version
 *   string. This loader discriminates by decode-attempt: try BeaconV3 first
 *   (a clean decode ⇒ V3); else try BeaconV2 (a clean decode ⇒ V2-legacy);
 *   else error. See NOTES.md Decision Log D-S2-1.
 *
 * Remote `beacon_url` fetching is out of scope this cycle (SDD §1.8) — a
 * `beacon_url`-only entry resolves to an `error` result and is skipped by
 * the manifest builder.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Schema } from "effect";
import {
  BeaconV3Schema,
  BeaconV2Schema,
  type BeaconV3,
  type BeaconV2,
} from "@freeside/beacon-schema";
import type { ModuleEntry } from "./registry.js";

/** Discriminated result of resolving one module's beacon. */
export type BeaconLoadResult =
  | { kind: "v3"; beacon: BeaconV3 }
  | { kind: "legacy"; beacon: BeaconV2 }
  | { kind: "error"; error: string };

/** The injected resolver `buildFreesideManifest` calls per module. */
export type BeaconLoader = (entry: ModuleEntry) => BeaconLoadResult;

const DEFAULT_REGISTRY_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const decodeV3 = Schema.decodeUnknownSync(BeaconV3Schema);
const decodeV2 = Schema.decodeUnknownSync(BeaconV2Schema);

/**
 * Resolve a `beacon_fixture` path to a realpath, refusing anything that
 * escapes the registry package. `..` is rejected BEFORE any filesystem
 * access (SDD §3.3); realpath then defeats symlink escape; containment is
 * the final gate. Throws on any violation.
 */
const resolveFixturePath = (registryRoot: string, fixture: string): string => {
  if (fixture.includes("..")) {
    throw new Error(`beacon_fixture path traversal rejected ('..'): ${fixture}`);
  }
  const realRoot = realpathSync(registryRoot);
  const realCandidate = realpathSync(join(realRoot, fixture));
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
    throw new Error(
      `beacon_fixture escapes the registry package: ${fixture}`,
    );
  }
  return realCandidate;
};

/** Try BeaconV3, then BeaconV2-legacy, then error. */
const classifyBeacon = (parsed: unknown): BeaconLoadResult => {
  try {
    return { kind: "v3", beacon: decodeV3(parsed) };
  } catch {
    // not a V3 beacon — fall through to the V2-legacy attempt
  }
  try {
    return { kind: "legacy", beacon: decodeV2(parsed) };
  } catch (err) {
    return {
      kind: "error",
      error: `beacon decodes as neither BeaconV3 nor BeaconV2 (malformed): ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
};

/**
 * Resolve one module's beacon. Prefers `beacon_fixture` (in-repo) over
 * `beacon_url` (remote, not fetched this cycle). Never throws — every
 * failure is returned as `{ kind: "error" }` so the manifest builder can
 * skip-not-crash (SDD §6.1).
 */
export const loadBeacon = (
  entry: ModuleEntry,
  registryRoot: string = DEFAULT_REGISTRY_ROOT,
): BeaconLoadResult => {
  if (entry.beacon_fixture) {
    let path: string;
    try {
      path = resolveFixturePath(registryRoot, entry.beacon_fixture);
    } catch (err) {
      return {
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(readFileSync(path, "utf-8"));
    } catch (err) {
      return {
        kind: "error",
        error: `beacon_fixture read/parse failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    return classifyBeacon(parsed);
  }

  // Remote beacon_url: out of scope this cycle (SDD §1.8). Skipped by the
  // builder; surfaced as a warn, never a crash.
  return {
    kind: "error",
    error:
      "remote beacon_url fetch is not implemented this cycle — only beacon_fixture entries are resolved",
  };
};
