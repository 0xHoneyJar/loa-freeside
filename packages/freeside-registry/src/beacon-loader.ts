/**
 * @freeside/freeside-registry · beacon-loader
 *
 * RECOVERED (sprint-400 T3, SDD correction 1): the compiled `dist/beacon-loader.js`
 * shipped WITHOUT a `src/` counterpart — the "lost from src" bug. This restores
 * the source so a registry rebuild regenerates the loader instead of orphaning it.
 * Lifted VERBATIM from the dist: `..`-rejection BEFORE any fs access → realpath →
 * registry-root containment (NFR-4 / L7 hardening), then decode-attempt
 * classification.
 *
 * Resolves a registry module's beacon. Fixture-aware: a ModuleEntry MAY point at
 * an in-repo `beacon_fixture` instead of a remote `beacon_url` (OD-1). Remote
 * fetch is out of scope (SDD SC-6) — a beacon_url-only entry resolves to
 * `{ kind: "error" }`, never a crash.
 *
 * DEVIATION D-S2-1: V3-ness is signalled by V3 *fields*, not the schema_version
 * string (BeaconV3Schema extends BeaconV2Schema's `schema_version: "2"`, so a V3
 * beacon carries `schema_version: "2"`). We discriminate by decode-attempt: a
 * clean V3 decode ⇒ v3; else a clean V2 decode ⇒ legacy; else error.
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

const DEFAULT_REGISTRY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const decodeV3 = Schema.decodeUnknownSync(BeaconV3Schema);
const decodeV2 = Schema.decodeUnknownSync(BeaconV2Schema);

export type BeaconResolution =
  | { readonly kind: "v3"; readonly beacon: BeaconV3 }
  | { readonly kind: "legacy"; readonly beacon: BeaconV2 }
  | { readonly kind: "error"; readonly error: string };

/**
 * Resolve a `beacon_fixture` path to a realpath, refusing anything that escapes
 * the registry package. `..` is rejected BEFORE any filesystem access;
 * realpath then defeats symlink escape; containment is the final gate. Throws
 * on any violation.
 */
export const resolveFixturePath = (registryRoot: string, fixture: string): string => {
  if (fixture.includes("..")) {
    throw new Error(`beacon_fixture path traversal rejected ('..'): ${fixture}`);
  }
  const realRoot = realpathSync(registryRoot);
  const realCandidate = realpathSync(join(realRoot, fixture));
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
    throw new Error(`beacon_fixture escapes the registry package: ${fixture}`);
  }
  return realCandidate;
};

/** Try BeaconV3, then BeaconV2-legacy, then error. */
export const classifyBeacon = (parsed: unknown): BeaconResolution => {
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
 * Classify a beacon from its raw YAML/JSON TEXT — for committed-only audits where
 * the caller has already fetched the authoritative bytes (e.g.
 * `git show <sha>:packages/protocol/beacon.yaml`, so a working-tree mutation of
 * the beacon cannot influence the verdict). Never throws: a parse failure is
 * `{ kind: "error" }`. Reuses the same try-V3-then-V2 `classifyBeacon`.
 */
export const loadBeaconFromText = (text: string): BeaconResolution => {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return {
      kind: "error",
      error: `beacon parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return classifyBeacon(parsed);
};

/**
 * Resolve one module's beacon. Prefers `beacon_fixture` (in-repo) over
 * `beacon_url` (remote, not fetched — SC-6). Never throws — every failure is a
 * `{ kind: "error" }` so callers (doctor / manifest builder) skip-not-crash.
 */
export const loadBeacon = (
  entry: Pick<ModuleEntry, "beacon_fixture" | "beacon_url">,
  registryRoot: string = DEFAULT_REGISTRY_ROOT,
): BeaconResolution => {
  if (entry.beacon_fixture) {
    let path: string;
    try {
      path = resolveFixturePath(registryRoot, entry.beacon_fixture);
    } catch (err) {
      return { kind: "error", error: err instanceof Error ? err.message : String(err) };
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
  // Remote beacon_url: out of scope (SC-6). Surfaced as error, never a crash.
  return {
    kind: "error",
    error:
      "remote beacon_url fetch is not implemented this build — only beacon_fixture entries are resolved (SC-6)",
  };
};
