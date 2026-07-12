#!/usr/bin/env node
/**
 * build-beacon-json · YAML→JSON adapter for beacon.yaml (v2 + v3)
 *
 * Usage: build-beacon-json --in <beacon.yaml> --out <beacon.json>
 *
 * Auto-detects schema version from the YAML's `schema_version` field:
 *   - "2" → validates against BeaconV2Schema (MCP-tenant declaration)
 *   - "3" → validates against BeaconV3Schema (building-identity beacon, ADR-008 §D-11)
 *
 * On success writes pretty-printed JSON to --out. On failure prints ParseError
 * to stderr and exits non-zero:
 *   - 1 = validation failure
 *   - 2 = usage error
 *   - 3 = unknown schema_version
 *
 * Wired from each construct's package.json:
 *   "build:beacon": "build-beacon-json --in beacon.yaml --out app/.well-known/beacon.json"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { Schema, Effect } from "effect";
import { BeaconV2Schema } from "../src/beacon-v2.js";
import { BeaconV3Schema } from "../src/beacon-v3.js";

const args = process.argv.slice(2);
const inIdx = args.indexOf("--in");
const outIdx = args.indexOf("--out");
if (inIdx === -1 || outIdx === -1) {
  console.error(
    "usage: build-beacon-json --in <beacon.yaml> --out <beacon.json>",
  );
  process.exit(2);
}
const inFile = args[inIdx + 1];
const outFile = args[outIdx + 1];
if (!inFile || !outFile) {
  console.error(
    "usage: build-beacon-json --in <beacon.yaml> --out <beacon.json>",
  );
  process.exit(2);
}

const yaml = readFileSync(inFile, "utf-8");
const parsed = parse(yaml);

const version =
  parsed && typeof parsed === "object" && "schema_version" in parsed
    ? String((parsed as Record<string, unknown>).schema_version)
    : undefined;

// schema_version "3" → V3 (building-identity beacon, ADR-008 §D-11)
// schema_version "2" (or anything else, including "1" or absent) → V2 — let
// V2 surface the ParseError so unknown versions get a normal exit 1
// (preserves prior behavior where the CLI was V2-only).
const schema: Schema.Schema<unknown, unknown> =
  version === "3"
    ? (BeaconV3Schema as unknown as Schema.Schema<unknown, unknown>)
    : (BeaconV2Schema as unknown as Schema.Schema<unknown, unknown>);

const result = Effect.runSyncExit(Schema.decodeUnknown(schema)(parsed));
if (result._tag === "Failure") {
  console.error(`[build-beacon-json] schema_version=${version} validation failed for ${inFile}:`);
  console.error(JSON.stringify(result.cause, null, 2));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(result.value, null, 2) + "\n");
console.log(
  `[build-beacon-json] schema_version=${version} ${inFile} → ${outFile} (${
    JSON.stringify(result.value).length
  } bytes)`,
);
