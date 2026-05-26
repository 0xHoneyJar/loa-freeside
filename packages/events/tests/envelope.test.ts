import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEnvelopeSchema, GENESIS_PREV_HASH, SCHEMA_VERSION, envelopeSigningBytes } from "../src/envelope.js";

const VALID_ENVELOPE = {
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
    const parsed = EventEnvelopeSchema.parse(VALID_ENVELOPE);
    assert.equal(parsed.schema_version, SCHEMA_VERSION);
    assert.equal(parsed.event_type, "nft.mint.detected.mibera-shadow.v1");
  });

  it("rejects a non-acvp-l1-v1 schema_version", () => {
    const bad = { ...VALID_ENVELOPE, schema_version: "acvp-l2-v1" };
    assert.throws(() => EventEnvelopeSchema.parse(bad));
  });

  it("rejects a non-3-segment event_type", () => {
    for (const bad of ["foo.bar.v1", "foo.bar.baz", "FOO.BAR.BAZ.v1", "foo.bar.baz.v0", "foo.bar.baz"]) {
      assert.throws(
        () => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, event_type: bad }),
        new RegExp(""),
        `expected reject: ${bad}`,
      );
    }
  });

  it("accepts a 4-segment versioned event_type", () => {
    const env = { ...VALID_ENVELOPE, event_type: "nft.mint.detected.mibera-shadow.v1" };
    assert.doesNotThrow(() => EventEnvelopeSchema.parse(env));
  });

  it("rejects non-64-char prev_hash / payload_hash", () => {
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, prev_hash: "abc" }));
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, payload_hash: "ABC".repeat(21) + "X" }));
  });

  it("rejects uppercase hex in prev_hash", () => {
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, prev_hash: "A".repeat(64) }));
  });

  it("rejects non-base64url signature", () => {
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, signature: "has padding=" }));
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, signature: "has spaces in it" }));
  });

  it("rejects emitted_at without trailing Z", () => {
    assert.throws(
      () => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, emitted_at: "2026-05-26T21:30:00+00:00" }),
    );
  });

  it("rejects extra fields (strict)", () => {
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, extra: "no" }));
  });

  it("rejects bad uuid", () => {
    assert.throws(() => EventEnvelopeSchema.parse({ ...VALID_ENVELOPE, event_id: "not-a-uuid" }));
  });
});

describe("envelopeSigningBytes", () => {
  it("produces deterministic bytes for the same (prev,payload) pair", () => {
    const a = envelopeSigningBytes("a".repeat(64), "b".repeat(64));
    const b = envelopeSigningBytes("a".repeat(64), "b".repeat(64));
    assert.deepEqual(a, b);
    assert.equal(a.length, 128); // 64 + 64 UTF-8 bytes
  });

  it("produces different bytes when either input changes", () => {
    const a = envelopeSigningBytes("a".repeat(64), "b".repeat(64));
    const b = envelopeSigningBytes("c".repeat(64), "b".repeat(64));
    const c = envelopeSigningBytes("a".repeat(64), "d".repeat(64));
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(a, c);
  });
});
