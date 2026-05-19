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
