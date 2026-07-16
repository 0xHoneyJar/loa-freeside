import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { VersionedDigest } from "@freeside/collection-protocol";
import {
  GATE_LEAK_CAPABILITIES,
  decodeGateLeakWorkKeyInput,
  digestGateLeakWorkKey,
} from "../index.js";
import {
  expectEffectFailure,
  expectEffectSuccess,
  permuteKeyOrder,
  readFixture,
} from "./test-helpers.js";

const VectorSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    input: Schema.Unknown,
    work_key_digest: VersionedDigest,
  }),
);
const decodeVectors = Schema.decodeUnknown(VectorSchema, {
  errors: "all",
  onExcessProperty: "error",
});

const vectors = expectEffectSuccess(
  decodeVectors(readFixture("work-key-digest-vectors.valid.json")),
);
const vector = (name: string) => {
  const found = vectors.find((entry) => entry.name === name);
  expect(found, `vector ${name}`).toBeDefined();
  if (found === undefined) throw new Error(`missing vector ${name}`);
  return found;
};
const digestOf = (name: string): string => vector(name).work_key_digest.digest;

describe("CR-002 work-key table", () => {
  it("strict-decodes and recomputes every published vector digest", () => {
    for (const entry of vectors) {
      const input = expectEffectSuccess(decodeGateLeakWorkKeyInput(entry.input));
      const digest = expectEffectSuccess(digestGateLeakWorkKey(input));
      expect(digest, entry.name).toStrictEqual(entry.work_key_digest);
    }
  });

  it("same key: object key order never changes the digest (JCS canonical form)", () => {
    for (const name of ["ownership-base", "mapping-acme", "identity-base"]) {
      const entry = vector(name);
      const permuted = expectEffectSuccess(
        decodeGateLeakWorkKeyInput(permuteKeyOrder(entry.input)),
      );
      const digest = expectEffectSuccess(digestGateLeakWorkKey(permuted));
      expect(digest.digest, name).toBe(entry.work_key_digest.digest);
    }
  });

  it("same key: two communities requesting the same public work share one key", () => {
    // The global input has no tenant field at all, so a second community's
    // equivalent request is byte-identical: shared work is structural.
    const first = expectEffectSuccess(
      decodeGateLeakWorkKeyInput(vector("ownership-base").input),
    );
    const second = expectEffectSuccess(
      decodeGateLeakWorkKeyInput(vector("ownership-base").input),
    );
    expect(expectEffectSuccess(digestGateLeakWorkKey(first)).digest).toBe(
      expectEffectSuccess(digestGateLeakWorkKey(second)).digest,
    );
  });

  it("different key: deployment set, finality, readiness policy, and adapter changes", () => {
    const base = digestOf("ownership-base");
    expect(digestOf("ownership-single-deployment")).not.toBe(base);
    expect(digestOf("ownership-finality-bump")).not.toBe(base);
    expect(digestOf("ownership-policy-bump")).not.toBe(base);
    expect(digestOf("ownership-adapter-bump")).not.toBe(base);
  });

  it("different key: community, guild, and mapping-version scope changes", () => {
    const base = digestOf("mapping-acme");
    expect(digestOf("mapping-other-community")).not.toBe(base);
    expect(digestOf("mapping-acme-other-guild")).not.toBe(base);
    expect(digestOf("mapping-mibera-version")).not.toBe(base);
  });

  it("community/guild boundaries cannot collide by concatenation", () => {
    // "team-a" + "123456789012345678" and "team-a1" + "23456789012345678"
    // concatenate identically; the keyed JCS object still separates them.
    expect(digestOf("mapping-boundary-a")).not.toBe(digestOf("mapping-boundary-b"));
  });

  it("different key: acquisition vs snapshot consumption and authorization epoch", () => {
    const acquisition = digestOf("discord-acquisition");
    expect(digestOf("discord-acquisition-epoch-bump")).not.toBe(acquisition);
    expect(digestOf("discord-exact-snapshot")).not.toBe(acquisition);
  });

  it("SDD 6.3: Discord snapshot keys bind the ratified mapping identity/version — same config, same key; relink or different config, different key", () => {
    const base = vector("discord-acquisition");
    // Same ratified mapping/config: byte-identical input, identical key.
    const replay = expectEffectSuccess(decodeGateLeakWorkKeyInput(base.input));
    expect(expectEffectSuccess(digestGateLeakWorkKey(replay)).digest).toBe(
      base.work_key_digest.digest,
    );
    // A relinked (new) mapping version over the SAME configuration changes the key.
    expect(digestOf("discord-acquisition-relinked-mapping")).not.toBe(
      base.work_key_digest.digest,
    );
    // A different ratified configuration changes the key.
    expect(digestOf("discord-acquisition-other-config")).not.toBe(
      base.work_key_digest.digest,
    );
    // The mapping binding is REQUIRED: stripping it fails closed.
    const raw = base.input;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("expected object vector input");
    }
    const { mapping_version_id: _v, mapping_config_digest: _c, ...stripped } =
      raw as Record<string, unknown>;
    expectEffectFailure(decodeGateLeakWorkKeyInput(stripped));
  });

  it("work-key digesting refuses an in-process permuted role set instead of minting a fragmented key", () => {
    const decoded = expectEffectSuccess(
      decodeGateLeakWorkKeyInput(vector("discord-acquisition").input),
    );
    if (decoded.capability !== "discord_role_snapshot.v1") {
      throw new Error("expected discord work-key input");
    }
    const permuted = {
      ...decoded,
      role_ids: decoded.role_ids.toReversed(),
    };
    const failure = expectEffectFailure(
      digestGateLeakWorkKey(permuted as typeof decoded),
    );
    expect(String(failure)).toContain("sorted unique");
  });

  it("different key: consent-policy version change on identity-link work", () => {
    expect(digestOf("identity-consent-bump")).not.toBe(digestOf("identity-base"));
  });

  it("compute work: order-scoped keys differ per order; result-cache scope has no order identity", () => {
    expect(digestOf("compute-order-a")).not.toBe(digestOf("compute-order-b"));
    expect(digestOf("compute-result-cache")).not.toBe(digestOf("compute-order-a"));
    const cacheable = expectEffectSuccess(
      decodeGateLeakWorkKeyInput(vector("compute-result-cache").input),
    );
    if (cacheable.capability !== "gate_leak_compute.v1") {
      throw new Error("expected compute work-key input");
    }
    expect(cacheable.result_scope.kind).toBe("result_cache");
    expect(Object.keys(cacheable.result_scope)).not.toContain("order_id");
  });

  it("every published vector digest is unique", () => {
    const digests = vectors.map((entry) => entry.work_key_digest.digest);
    expect(new Set(digests).size).toBe(digests.length);
  });

  it("global public keys structurally refuse tenant identity", () => {
    expectEffectFailure(
      decodeGateLeakWorkKeyInput(
        readFixture("malformed/work-key-global-with-community.invalid.json"),
      ),
    );
  });

  it("capability version changes cannot reuse v1 keys: a v2 id fails closed", () => {
    const entry = vector("ownership-base");
    const raw = permuteKeyOrder(entry.input);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("expected object vector input");
    }
    expectEffectFailure(
      decodeGateLeakWorkKeyInput({ ...raw, capability: "ownership_index.v2" }),
    );
  });

  it("declares shareability and privacy class for all six capabilities", () => {
    expect(Object.keys(GATE_LEAK_CAPABILITIES)).toHaveLength(6);
    expect(GATE_LEAK_CAPABILITIES["collection_identity.v1"].shareability).toBe("global");
    expect(GATE_LEAK_CAPABILITIES["ownership_index.v1"].shareability).toBe(
      "global_freshness_qualified",
    );
    expect(GATE_LEAK_CAPABILITIES["gate_mapping.v1"].privacy_class).toBe(
      "restricted_community",
    );
    expect(GATE_LEAK_CAPABILITIES["gate_leak_compute.v1"].shareability).toBe(
      "order_or_result_digest",
    );
    expect(GATE_LEAK_CAPABILITIES["discord_role_snapshot.v1"].evidence_boundary).toBe(
      "acquisition_then_exact_snapshot",
    );
    expect(GATE_LEAK_CAPABILITIES["ownership_index.v1"].evidence_boundary).toBe(
      "continuous_latest",
    );
    expect(GATE_LEAK_CAPABILITIES["identity_link_snapshot.v1"].retention).toContain(
      "SHORTEST applicable retention",
    );
    for (const declaration of Object.values(GATE_LEAK_CAPABILITIES)) {
      expect(declaration.retention.length).toBeGreaterThan(0);
      expect(declaration.freshness_authority.length).toBeGreaterThan(0);
    }
  });
});
