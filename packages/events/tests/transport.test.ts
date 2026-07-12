import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNatsTransport, internalPublish, type RawNats } from "../src/transport.js";
import * as publicApi from "../src/index.js";

const recordingNats = (): RawNats & { calls: Array<{ subject: string }> } => {
  const calls: Array<{ subject: string }> = [];
  return { calls, publish: (subject: string) => void calls.push({ subject }) };
};

describe("transport capability boundary (T1.5, FR-7, SKP-001/SKP-002)", () => {
  it("a transport token exposes no member yielding the raw client", () => {
    const transport = createNatsTransport(recordingNats());
    // The opaque token has no own enumerable members, and certainly no publish/unwrap.
    assert.deepEqual(Object.keys(transport as object), []);
    assert.equal((transport as Record<string, unknown>).publish, undefined);
    assert.equal((transport as Record<string, unknown>).unwrap, undefined);
  });

  it("internalPublish resolves the raw client for a real token (package-internal)", () => {
    const raw = recordingNats();
    const transport = createNatsTransport(raw);
    assert.equal(internalPublish(transport), raw);
  });

  it("internalPublish throws on a forged token (not from createNatsTransport)", () => {
    const forged = Object.freeze({}) as Parameters<typeof internalPublish>[0];
    assert.throws(() => internalPublish(forged), /not constructed via createNatsTransport/);
  });

  it("SKP-002: index.ts does NOT export internalPublish (capability stays private)", () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(publicApi, "internalPublish"),
      false,
      "internalPublish must never be re-exported from the package entrypoint",
    );
    // createNatsTransport IS public (the only sanctioned way to obtain a transport).
    assert.equal(typeof publicApi.createNatsTransport, "function");
  });
});
