#!/usr/bin/env node
/**
 * build-beacon-json · YAML→JSON adapter for beacon.yaml v2
 *
 * Usage: build-beacon-json --in <beacon.yaml> --out <beacon.json>
 *
 * Validates the YAML against BeaconV2Schema. On success writes pretty-printed
 * JSON to --out. On failure prints ParseError to stderr and exits non-zero
 * (1 = validation failure, 2 = usage error).
 *
 * Wired from each construct's package.json:
 *   "build:beacon": "build-beacon-json --in beacon.yaml --out app/.well-known/beacon.json"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { Schema, Effect } from "effect";
import { BeaconV2Schema } from "../src/beacon-v2.js";

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
const result = Effect.runSyncExit(
  Schema.decodeUnknown(BeaconV2Schema)(parsed),
);
if (result._tag === "Failure") {
  console.error(`[build-beacon-json] schema validation failed for ${inFile}:`);
  console.error(JSON.stringify(result.cause, null, 2));
  process.exit(1);
}
writeFileSync(outFile, JSON.stringify(result.value, null, 2) + "\n");
console.log(
  `[build-beacon-json] ${inFile} → ${outFile} (${
    JSON.stringify(result.value).length
  } bytes)`,
);
