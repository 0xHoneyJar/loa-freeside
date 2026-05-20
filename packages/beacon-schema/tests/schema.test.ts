/**
 * Unit tests · @0xhoneyjar/beacon-schema
 *
 * Per SDD §8.1 acceptance criteria:
 *   - codex v2 yaml decodes
 *   - score v2 yaml decodes
 *   - v1-shaped yaml fails with clear ParseError (schema_version mismatch)
 *   - 4 Auth refine cases:
 *       - kind:none + header → fail
 *       - kind:api-key without header → fail
 *       - kind:api-key without credentials_ref → fail
 *       - happy paths (kind:none bare; kind:api-key with both) → pass
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Effect, Schema } from "effect";
import {
  Auth,
  BeaconV2Schema,
  decodeBeacon,
  BeaconV2JsonSchema,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = (name: string) =>
  parse(readFileSync(join(__dirname, "fixtures", name), "utf-8"));

// ─── beacon decode ────────────────────────────────────────────────────────

test("codex v2 fixture decodes successfully", () => {
  const result = Effect.runSyncExit(decodeBeacon(fix("codex-v2.yaml")));
  if (result._tag === "Failure") {
    assert.fail(`expected success, got: ${JSON.stringify(result.cause)}`);
  }
  assert.equal(result.value.schema_version, "2");
  assert.equal(result.value.mcp.shape, "data");
  assert.equal(result.value.mcp.auth.kind, "none");
  assert.equal(result.value.mcp.publisher, "0xHoneyJar");
});

test("score v2 fixture decodes successfully (api-key auth)", () => {
  const result = Effect.runSyncExit(decodeBeacon(fix("score-v2.yaml")));
  if (result._tag === "Failure") {
    assert.fail(`expected success, got: ${JSON.stringify(result.cause)}`);
  }
  assert.equal(result.value.mcp.auth.kind, "api-key");
  assert.equal(result.value.mcp.auth.header, "X-MCP-Key");
  assert.equal(
    result.value.mcp.auth.credentials_ref?.key,
    "MCP_SCORE_UPSTREAM_KEY",
  );
  assert.equal(
    result.value.mcp.auth.credentials_ref?.type,
    "railway-secret",
  );
});

test("v1-shaped beacon fails with ParseError on schema_version", () => {
  const result = Effect.runSyncExit(decodeBeacon(fix("v1-shaped.yaml")));
  assert.equal(result._tag, "Failure", "expected v1 fixture to fail decode");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("schema_version"),
      `expected ParseError to mention schema_version, got: ${message}`,
    );
  }
});

// ─── Auth refine rules ────────────────────────────────────────────────────

const decodeAuth = Schema.decodeUnknown(Auth);

test("auth refine · kind:none + header → fail", () => {
  const result = Effect.runSyncExit(
    decodeAuth({ kind: "none", header: "X-Foo" }),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("kind:none must omit header"),
      `unexpected error: ${message}`,
    );
  }
});

test("auth refine · kind:api-key without header → fail", () => {
  const result = Effect.runSyncExit(
    decodeAuth({
      kind: "api-key",
      credentials_ref: { type: "railway-secret", key: "MCP_FOO" },
    }),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("kind:api-key requires both header"),
      `unexpected error: ${message}`,
    );
  }
});

test("auth refine · kind:api-key without credentials_ref → fail", () => {
  const result = Effect.runSyncExit(
    decodeAuth({ kind: "api-key", header: "X-Foo" }),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("kind:api-key requires both header"),
      `unexpected error: ${message}`,
    );
  }
});

test("auth refine · happy paths (none bare + api-key with both)", () => {
  const noneOk = Effect.runSyncExit(decodeAuth({ kind: "none" }));
  assert.equal(noneOk._tag, "Success");

  const apiKeyOk = Effect.runSyncExit(
    decodeAuth({
      kind: "api-key",
      header: "X-MCP-Key",
      credentials_ref: { type: "railway-secret", key: "MCP_SCORE_UPSTREAM_KEY" },
    }),
  );
  assert.equal(apiKeyOk._tag, "Success");
});

// ─── credentials_ref pattern ──────────────────────────────────────────────

test("credentials_ref.key rejects lowercase / non-SCREAMING_SNAKE_CASE", () => {
  const result = Effect.runSyncExit(
    decodeAuth({
      kind: "api-key",
      header: "X-Foo",
      credentials_ref: { type: "railway-secret", key: "lowercase_key" },
    }),
  );
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("SCREAMING_SNAKE_CASE"),
      `unexpected error: ${message}`,
    );
  }
});

// ─── JSONSchema export ────────────────────────────────────────────────────

test("BeaconV2JsonSchema exports a non-empty JSON Schema object", () => {
  assert.equal(typeof BeaconV2JsonSchema, "object");
  assert.ok(
    "$schema" in BeaconV2JsonSchema || "$ref" in BeaconV2JsonSchema || "type" in BeaconV2JsonSchema,
    "expected JSON Schema to have $schema or $ref or type field",
  );
  // BeaconV2 identifier should appear in the export
  const dump = JSON.stringify(BeaconV2JsonSchema);
  assert.ok(dump.includes("BeaconV2"), "expected BeaconV2 identifier in schema");
});

// ─── McpBlock refine: remote required when paths includes remote-http ────

test("mcp refine · paths includes remote-http but remote omitted → fail", () => {
  const beacon = structuredClone(fix("codex-v2.yaml")) as Record<string, unknown>;
  const mcp = beacon.mcp as Record<string, unknown>;
  mcp.paths = ["remote-http"];
  delete mcp.remote;
  const result = Effect.runSyncExit(decodeBeacon(beacon));
  assert.equal(result._tag, "Failure");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("mcp.remote required when paths includes remote-http"),
      `unexpected error: ${message}`,
    );
  }
});

test("mcp refine · paths is stdio-only and remote omitted → success", () => {
  const beacon = structuredClone(fix("codex-v2.yaml")) as Record<string, unknown>;
  const mcp = beacon.mcp as Record<string, unknown>;
  mcp.paths = ["stdio"];
  delete mcp.remote;
  const result = Effect.runSyncExit(decodeBeacon(beacon));
  assert.equal(result._tag, "Success");
});

// ─── docs placeholder (Cycle D contract) ──────────────────────────────────

test("docs:Schema.optional(Schema.Unknown) accepts arbitrary docs payload (Cycle D placeholder)", () => {
  const withDocs = {
    ...fix("codex-v2.yaml"),
    docs: { tagline: "anything", random_field: 42 },
  };
  const result = Effect.runSyncExit(decodeBeacon(withDocs));
  assert.equal(
    result._tag,
    "Success",
    "Cycle C must accept arbitrary docs blocks per §0.3 contract",
  );
});

// ─── encodeBeacon roundtrip ───────────────────────────────────────────────

test("encodeBeacon roundtrip preserves codex fixture", () => {
  const decoded = Effect.runSyncExit(decodeBeacon(fix("codex-v2.yaml")));
  if (decoded._tag === "Failure") assert.fail("decode failed");
  const encoded = Effect.runSyncExit(Schema.encode(BeaconV2Schema)(decoded.value));
  assert.equal(encoded._tag, "Success");
});

// ─── V3 schema tests (ADR-007 §D-4 + Appendix A) ──────────────────────────

import {
  BeaconV3Schema,
  decodeBeaconV3,
  BeaconV3JsonSchema,
} from "../src/index.js";

test("V3 inventory fixture decodes successfully (canonical reference module)", () => {
  const result = Effect.runSyncExit(
    decodeBeaconV3(fix("freeside-inventory-v3.yaml")),
  );
  if (result._tag === "Failure") {
    assert.fail(`expected success, got: ${JSON.stringify(result.cause)}`);
  }
  assert.equal(result.value.is.one_liner.startsWith("Read-side inventory"), true);
  assert.equal(result.value.is_not.length, 3);
  assert.equal(result.value.cycle_state.status, "candidate");
});

test("V3 is_not entry without 'Does NOT'/'Will NOT'/'Refuses to' prefix fails", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.is_not = ["Manages everything"]; // no prefix → should fail
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected validation failure");
});

test("V3 is_not with fewer than 2 entries fails", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.is_not = ["Does NOT do one thing"]; // only 1 entry → should fail
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected validation failure");
});

// ─── V3 belt fields: produces / consumes (cycle-049 S1, ADR-008 §D-3) ─────

test("V3 produces/consumes belts on the inventory fixture decode and populate", () => {
  const result = Effect.runSyncExit(
    decodeBeaconV3(fix("freeside-inventory-v3.yaml")),
  );
  if (result._tag === "Failure") {
    assert.fail(`expected success, got: ${JSON.stringify(result.cause)}`);
  }
  assert.equal(result.value.produces.length, 1);
  assert.equal(result.value.produces[0].belt, "holder-inventory");
  assert.equal(result.value.consumes.length, 2);
  assert.equal(result.value.consumes[0].from, "freeside-sonar");
  assert.equal(result.value.consumes[0].belt, "chain-events");
});

test("V3 beacon omitting produces + consumes decodes (both default to [])", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  delete beacon.produces;
  delete beacon.consumes;
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  if (result._tag === "Failure") {
    assert.fail(`expected success, got: ${JSON.stringify(result.cause)}`);
  }
  assert.deepEqual(result.value.produces, []);
  assert.deepEqual(result.value.consumes, []);
});

test("V3 produces.belt rejects a non-kebab belt name with the SDD message", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.produces[0].belt = "HolderInventory"; // PascalCase → must fail
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected lowercase-kebab belt enforcement");
  if (result._tag === "Failure") {
    const message = JSON.stringify(result.cause);
    assert.ok(
      message.includes("produces.belt must be lowercase-kebab"),
      `expected the SDD §3.1 belt message, got: ${message}`,
    );
  }
});

test("V3 consumes.tag without version+hash format fails", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.consumes[0].tag = "SonarPort"; // no version+hash
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(
    result._tag,
    "Failure",
    "expected Tag@version+hash format enforcement on consumes.tag",
  );
});

test("V3 consumes.from rejects a non-kebab sibling building slug", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.consumes[0].from = "Freeside_Sonar"; // caps + underscore → must fail
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected lowercase-kebab slug enforcement");
});

test("V3 regression: composes_with removed — schema neither requires nor validates it", () => {
  // composes_with was hard-replaced by produces/consumes in cycle-049 S1
  // (ADR-008 §D-3 belt migration). A beacon omitting it decodes clean; a
  // stale composes_with block is an ignored excess property, never validated.
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.composes_with = { "freeside-sonar": { tag: "garbage", role: "x" } };
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(
    result._tag,
    "Success",
    "stale composes_with must be ignored, not validated or required",
  );
});

test("V3 cycle_state.status enum rejects unknown values", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.cycle_state.status = "stable"; // not in enum
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected enum rejection");
});

test("V3 sealed_schemas.hash rejects non-sha256 values", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.sealed_schemas[0].hash = "deadbeef"; // too short
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected sha256 enforcement");
});

test("V3 JSON Schema can be exported (for downstream tooling)", () => {
  const json = JSON.stringify(BeaconV3JsonSchema);
  assert.equal(json.length > 1000, true, "JSON Schema should be non-trivial");
  assert.ok(json.includes('"is_not"'), "is_not field should appear in schema");
  assert.ok(json.includes('"cycle_state"'), "cycle_state field should appear");
  // cycle-049 S1: the regenerated schema carries belt fields, not composes_with
  assert.ok(json.includes('"produces"'), "produces field should appear in schema");
  assert.ok(json.includes('"consumes"'), "consumes field should appear in schema");
  assert.ok(
    !json.includes('"composes_with"'),
    "composes_with must be absent from the regenerated schema",
  );
});
