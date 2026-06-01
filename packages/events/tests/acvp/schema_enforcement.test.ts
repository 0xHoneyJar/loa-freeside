import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Either } from "effect";
import { makeEmitter, SchemaEmitError } from "../../src/emit.js";
import { NftMintDetectedId } from "../../src/registry.js";
import { createNatsTransport, type RawNats } from "../../src/transport.js";
import { InMemoryPrevHashStore } from "../../src/publisher.js";
import { LocalEd25519Signer } from "../../src/signer.js";
import * as publicApi from "../../src/index.js";

/**
 * ACVP proof artifact for the `schema_enforcement` invariant
 * (events-api beacon, cycle-112 S5/T5.3). The invariant: every NATS event
 * emitted via emit() is payload-validated against its registry schema BEFORE
 * signing, and raw `.publish` is unreachable outside the events package.
 *
 * `runtime_class: envelope` — this proof binds the invariant to the acvp-l1-v2
 * envelope path (validateAcvpBindings, acvp-bindings.ts:115-116).
 */

const VALID = {
  chain_id: 80094,
  contract: "0x" + "a".repeat(40),
  token_id: "1",
  minter: "0x" + "b".repeat(40),
  block_number: 100,
  transaction_hash: "0x" + "c".repeat(64),
  timestamp: "2026-05-31T00:00:00Z",
};

describe("ACVP: schema_enforcement (runtime_class: envelope)", () => {
  it("emit() VALIDATES then REJECTS a malformed payload — no publish, no chain advance", async () => {
    const published: string[] = [];
    const nats: RawNats = { publish: (s: string) => void published.push(s) };
    const signer = await LocalEd25519Signer.fromSeedHex("0".repeat(64), "events-api-1");
    const store = new InMemoryPrevHashStore();
    const emitter = makeEmitter({
      cell: "events-api",
      transport: createNatsTransport(nats),
      signer,
      prevHashStore: store,
    });

    const bad = { chain_id: -1 } as unknown as typeof VALID;
    const r = await emitter.emit(NftMintDetectedId, bad, "x");

    assert.ok(Either.isLeft(r), "a malformed payload is rejected");
    assert.ok((r as Either.Left<SchemaEmitError, never>).left instanceof SchemaEmitError);
    assert.equal(published.length, 0, "a rejected payload NEVER reaches the bus");
    assert.equal(await store.get("events-api:events-api-1"), null, "the chain did NOT advance");
  });

  it("a valid payload is accepted, signed, and chain-linked (the envelope path holds)", async () => {
    const published: Uint8Array[] = [];
    const nats: RawNats = { publish: (_s: string, d: Uint8Array) => void published.push(d) };
    const signer = await LocalEd25519Signer.fromSeedHex("0".repeat(64), "events-api-1");
    const emitter = makeEmitter({
      cell: "events-api",
      transport: createNatsTransport(nats),
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });
    const r = await emitter.emit(NftMintDetectedId, VALID, "mibera-shadow");
    assert.ok(Either.isRight(r));
    assert.equal(published.length, 1);
    const env = JSON.parse(new TextDecoder().decode(published[0]!));
    assert.equal(env.schema_version, "acvp-l1-v2");
    assert.ok(env.signature && env.payload_hash, "signed + payload-hashed");
  });

  it("raw NATS publish is unreachable outside the package (internalPublish not exported)", () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(publicApi, "internalPublish"),
      false,
      "the raw publish capability must stay package-private (FR-7)",
    );
  });
});
