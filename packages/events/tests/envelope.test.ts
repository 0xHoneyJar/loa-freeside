import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Schema as S } from "@effect/schema";
import {
  EventEnvelopeSchema,
  GENESIS_PREV_HASH,
  SCHEMA_VERSION,
  envelopeSigningBytes,
  type EventEnvelope,
} from "../src/envelope.js";
import { jcsCanonicalize, sha256Hex } from "../src/jcs.js";

// Match publisher/subscriber decode posture — extras REJECTED.
const decode = (input: unknown) =>
  S.decodeUnknownSync(EventEnvelopeSchema)(input, { onExcessProperty: "error" });

const VALID_ENVELOPE: EventEnvelope = {
  event_id: "0e3a4a2f-1c9e-4a8e-9c20-1234567890ab",
  event_type: "nft.mint.detected.mibera-shadow.v1",
  schema_version: SCHEMA_VERSION,
  emitted_by: "sonar-api",
  emitted_at: "2026-05-26T21:30:00Z",
  prev_hash: GENESIS_PREV_HASH,
  payload_hash: "a".repeat(64),
  signing_key_id: "sonar-api-1",
  signature: "abcDEF-_123",
  payload: { foo: "bar" },
};

describe("EventEnvelopeSchema", () => {
  it("accepts a well-formed envelope", () => {
    const parsed = decode(VALID_ENVELOPE);
    assert.equal(parsed.schema_version, SCHEMA_VERSION);
    assert.equal(parsed.event_type, "nft.mint.detected.mibera-shadow.v1");
  });

  it("rejects a non-acvp-l1-v2 schema_version (literal-locked)", () => {
    const bad = { ...VALID_ENVELOPE, schema_version: "acvp-l1-v1" };
    assert.throws(() => decode(bad));
    const bad2 = { ...VALID_ENVELOPE, schema_version: "acvp-l2-v1" };
    assert.throws(() => decode(bad2));
  });

  it("rejects non-3-segment event_types", () => {
    for (const bad of ["foo.bar.v1", "foo.bar.baz", "FOO.BAR.BAZ.v1", "foo.bar.baz.v0"]) {
      assert.throws(
        () => decode({ ...VALID_ENVELOPE, event_type: bad }),
        new RegExp(""),
        `expected reject: ${bad}`,
      );
    }
  });

  it("accepts a 4-segment versioned event_type", () => {
    assert.doesNotThrow(() =>
      decode({ ...VALID_ENVELOPE, event_type: "nft.mint.detected.mibera-shadow.v1" }),
    );
  });

  it("rejects non-64-char prev_hash / payload_hash", () => {
    assert.throws(() => decode({ ...VALID_ENVELOPE, prev_hash: "abc" }));
    assert.throws(() => decode({ ...VALID_ENVELOPE, payload_hash: "ABC".repeat(21) + "X" }));
  });

  it("rejects uppercase hex in prev_hash", () => {
    assert.throws(() => decode({ ...VALID_ENVELOPE, prev_hash: "A".repeat(64) }));
  });

  it("rejects non-base64url signature", () => {
    assert.throws(() => decode({ ...VALID_ENVELOPE, signature: "has padding=" }));
    assert.throws(() => decode({ ...VALID_ENVELOPE, signature: "has spaces in it" }));
  });

  it("rejects emitted_at without trailing Z", () => {
    assert.throws(() =>
      decode({ ...VALID_ENVELOPE, emitted_at: "2026-05-26T21:30:00+00:00" }),
    );
  });

  it("rejects extra fields (Struct rejects undeclared keys)", () => {
    assert.throws(() => decode({ ...VALID_ENVELOPE, extra: "no" }));
  });

  it("rejects bad uuid", () => {
    assert.throws(() => decode({ ...VALID_ENVELOPE, event_id: "not-a-uuid" }));
  });
});

describe("envelopeSigningBytes (acvp-l1-v2 full-envelope binding)", () => {
  it("produces deterministic bytes for the same envelope shape", () => {
    const { signature: _s1, ...unsigned } = VALID_ENVELOPE;
    void _s1;
    const a = envelopeSigningBytes(unsigned);
    const b = envelopeSigningBytes(unsigned);
    assert.deepEqual(a, b);
  });

  it("binds event_type to the signature (EVT-001 closed)", () => {
    const { signature: _s, ...unsigned } = VALID_ENVELOPE;
    void _s;
    const a = envelopeSigningBytes(unsigned);
    const tampered = { ...unsigned, event_type: "nft.mint.detected.other-collection.v1" };
    const b = envelopeSigningBytes(tampered);
    assert.notDeepEqual(a, b, "event_type tamper must change signing bytes");
  });

  it("binds emitted_by to the signature (EVT-001 closed)", () => {
    const { signature: _s, ...unsigned } = VALID_ENVELOPE;
    void _s;
    const a = envelopeSigningBytes(unsigned);
    const tampered = { ...unsigned, emitted_by: "fabricated-cell" };
    const b = envelopeSigningBytes(tampered);
    assert.notDeepEqual(a, b, "emitted_by tamper must change signing bytes");
  });

  it("binds payload to the signature (via payload_hash recompute)", () => {
    const { signature: _s, ...unsigned } = VALID_ENVELOPE;
    void _s;
    const a = envelopeSigningBytes(unsigned);
    const tampered = { ...unsigned, payload: { foo: "DIFFERENT" } };
    const b = envelopeSigningBytes(tampered);
    assert.notDeepEqual(a, b, "payload tamper must change signing bytes (because payload is in the canonical envelope)");
  });

  it("returns 64-byte UTF-8 of the sha256 hex digest", () => {
    const { signature: _s, ...unsigned } = VALID_ENVELOPE;
    void _s;
    const bytes = envelopeSigningBytes(unsigned);
    assert.equal(bytes.length, 64); // sha256 hex = 64 chars = 64 UTF-8 bytes
    // sanity: the digest is sha256(JCS(env-with-empty-sig))
    const expected = sha256Hex(jcsCanonicalize({ ...unsigned, signature: "" }));
    assert.equal(new TextDecoder().decode(bytes), expected);
  });
});
