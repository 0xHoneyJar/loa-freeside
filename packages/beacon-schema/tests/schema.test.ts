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

test("V3 composes_with.tag without version+hash format fails", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.composes_with["freeside-sonar"].tag = "SonarPort"; // no version+hash
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(
    result._tag,
    "Failure",
    "expected Tag@version+hash format enforcement",
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
});

// ─── ComposesWith key regex — outer: namespace (refs #234, #235) ──────────
// The regex admits two shapes:
//   1. ^[a-z][a-z0-9-]*$          — building slugs (the eventual *-api cells)
//   2. ^outer:[a-z][a-z0-9-]+$    — outer-dep prefix (constructs, upstream
//                                   data substrates) until their API surface
//                                   ships (#235 mibera-codex transition).
// Both branches valid through the transition. #234 sub-step B tightens
// branch 1 to ^[a-z][a-z0-9-]*-api$; branch 2 stays.

test("V3 composes_with accepts outer:mibera-codex key", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  const sonarEntry = beacon.composes_with["freeside-sonar"];
  beacon.composes_with = { "outer:mibera-codex": sonarEntry };
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  if (result._tag === "Failure") {
    assert.fail(
      `expected outer:mibera-codex to validate, got: ${JSON.stringify(result.cause)}`,
    );
  }
});

test("V3 composes_with rejects bare outer: with empty suffix", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  const sonarEntry = beacon.composes_with["freeside-sonar"];
  beacon.composes_with = { "outer:": sonarEntry };
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(
    result._tag,
    "Failure",
    "expected outer: with no suffix to be rejected",
  );
});

test("V3 composes_with rejects unknown prefix:foo (only outer: is admitted)", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  const sonarEntry = beacon.composes_with["freeside-sonar"];
  beacon.composes_with = { "inner:mibera-codex": sonarEntry };
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(
    result._tag,
    "Failure",
    "expected non-outer prefix to be rejected (colon disallowed in branch 1)",
  );
});

test("V3 composes_with still accepts canonical -api slug (sonar-api)", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  const sonarEntry = beacon.composes_with["freeside-sonar"];
  beacon.composes_with = { "sonar-api": sonarEntry };
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  if (result._tag === "Failure") {
    assert.fail(
      `expected sonar-api to validate, got: ${JSON.stringify(result.cause)}`,
    );
  }
});

// ─── AcvpInvariant.status + runtime_class (ACVP-OD · sprint-400 T1) ─────────
// SDD §6: status gates the aspirational-allowlist escape hatch; runtime_class
// disambiguates audit_replay (envelope vs storage). Both additive + optional.

test("V3 acvp_invariant.status defaults to 'active' when omitted (additive bump)", () => {
  const result = Effect.runSyncExit(
    decodeBeaconV3(fix("freeside-inventory-v3.yaml")),
  );
  if (result._tag === "Failure") {
    assert.fail(`expected success, got: ${JSON.stringify(result.cause)}`);
  }
  const invs = result.value.acvp_invariants ?? [];
  assert.ok(invs.length >= 1, "fixture should declare acvp_invariants");
  for (const inv of invs) {
    assert.equal(inv.status, "active", "missing status must default to 'active'");
  }
});

test("V3 acvp_invariant.status accepts 'aspirational'", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.acvp_invariants[0].status = "aspirational";
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  if (result._tag === "Failure") {
    assert.fail(
      `expected aspirational to decode, got: ${JSON.stringify(result.cause)}`,
    );
  }
  assert.equal(result.value.acvp_invariants?.[0].status, "aspirational");
});

test("V3 acvp_invariant.status rejects unknown literal", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.acvp_invariants[0].status = "provisional"; // not in {active, aspirational}
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected status enum rejection");
});

test("V3 acvp_invariant.runtime_class is optional and accepts the 3 literals", () => {
  for (const rc of ["envelope", "storage", "construct-local"]) {
    const beacon = fix("freeside-inventory-v3.yaml");
    beacon.acvp_invariants[0].runtime_class = rc;
    const result = Effect.runSyncExit(decodeBeaconV3(beacon));
    if (result._tag === "Failure") {
      assert.fail(
        `expected runtime_class=${rc} to decode, got: ${JSON.stringify(result.cause)}`,
      );
    }
    assert.equal(result.value.acvp_invariants?.[0].runtime_class, rc);
  }
  // omitted → still decodes (runtime_class undefined)
  const omitted = Effect.runSyncExit(
    decodeBeaconV3(fix("freeside-inventory-v3.yaml")),
  );
  assert.equal(omitted._tag, "Success");
});

test("V3 acvp_invariant.runtime_class rejects unknown literal", () => {
  const beacon = fix("freeside-inventory-v3.yaml");
  beacon.acvp_invariants[0].runtime_class = "db"; // not in enum
  const result = Effect.runSyncExit(decodeBeaconV3(beacon));
  assert.equal(result._tag, "Failure", "expected runtime_class enum rejection");
});
