import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Either } from "effect";
import { Schema as S } from "@effect/schema";
import {
  makeEmitter,
  SchemaEmitError,
  UnknownSchemaIdError,
  SubjectFamilyError,
  SubjectBuildError,
  MissingSignerError,
} from "../src/emit.js";
import { NftMintDetectedId, schemaId } from "../src/registry.js";
import { createNatsTransport, type RawNats } from "../src/transport.js";
import { InMemoryPrevHashStore } from "../src/publisher.js";
import { LocalEd25519Signer } from "../src/signer.js";
import { GENESIS_PREV_HASH, type EventEnvelope } from "../src/envelope.js";
import { jcsCanonicalize, sha256Hex } from "../src/jcs.js";

const SEED = "0".repeat(64);

const VALID_MINT = {
  chain_id: 80094,
  contract: "0x" + "a".repeat(40),
  token_id: "1",
  minter: "0x" + "b".repeat(40),
  block_number: 100,
  transaction_hash: "0x" + "c".repeat(64),
  timestamp: "2026-05-31T00:00:00Z",
};

function recordingNats() {
  const envelopes: EventEnvelope[] = [];
  const nats: RawNats = {
    publish: (_subject: string, data: Uint8Array) => {
      envelopes.push(JSON.parse(new TextDecoder().decode(data)) as EventEnvelope);
    },
  };
  return { nats, envelopes };
}

async function mkEmitter(rec: ReturnType<typeof recordingNats>, store = new InMemoryPrevHashStore()) {
  const signer = await LocalEd25519Signer.fromSeedHex(SEED, "test-1");
  return makeEmitter({
    cell: "test-cell",
    transport: createNatsTransport(rec.nats),
    signer,
    prevHashStore: store,
  });
}

describe("emit (T1.6, FR-3/3a/4/5)", () => {
  it("valid payload → Right(receipt), publishes exactly once", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    const r = await emitter.emit(NftMintDetectedId, VALID_MINT, "mibera-shadow");
    assert.ok(Either.isRight(r), "expected Right");
    assert.equal(rec.envelopes.length, 1);
    const receipt = (r as Either.Right<never, any>).right;
    assert.ok(receipt.event_id, "receipt carries event_id (FR-ADOPT-7)");
    assert.ok(receipt.envelopeHash, "receipt carries envelopeHash");
    assert.equal(receipt.subject, "nft.mint.detected.mibera-shadow.v1");
  });

  it("invalid payload → Left(SchemaEmitError), NO publish, NO chain advance", async () => {
    const rec = recordingNats();
    const store = new InMemoryPrevHashStore();
    const emitter = await mkEmitter(rec, store);
    const bad = { chain_id: 1 } as unknown as typeof VALID_MINT;
    const r = await emitter.emit(NftMintDetectedId, bad, "x");
    assert.ok(Either.isLeft(r), "expected Left");
    assert.ok((r as Either.Left<SchemaEmitError, never>).left instanceof SchemaEmitError);
    assert.equal(rec.envelopes.length, 0, "must not publish a bad payload");
    assert.equal(await store.get("test-cell:test-1"), null, "chain must not advance");
  });

  it("unknown SchemaId → Left(UnknownSchemaIdError), not a throw", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    const bogus = schemaId<typeof VALID_MINT>("nope.nope.v1", S.Unknown as any);
    const r = await emitter.emit(bogus, VALID_MINT);
    assert.ok(Either.isLeft(r));
    assert.ok((r as Either.Left<UnknownSchemaIdError, never>).left instanceof UnknownSchemaIdError);
    assert.equal(rec.envelopes.length, 0);
  });

  it("SKP-001: concurrent emits do NOT fork the chain", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    const results = await Promise.all([
      emitter.emit(NftMintDetectedId, VALID_MINT, "a"),
      emitter.emit(NftMintDetectedId, VALID_MINT, "b"),
      emitter.emit(NftMintDetectedId, VALID_MINT, "c"),
    ]);
    assert.ok(results.every(Either.isRight), "all three succeed");
    assert.equal(rec.envelopes.length, 3);

    // The published envelopes must form one linear chain (no fork).
    assert.equal(rec.envelopes[0].prev_hash, GENESIS_PREV_HASH);
    for (let i = 1; i < rec.envelopes.length; i++) {
      const priorHash = sha256Hex(jcsCanonicalize(rec.envelopes[i - 1]));
      assert.equal(
        rec.envelopes[i].prev_hash,
        priorHash,
        `envelope ${i} must chain on envelope ${i - 1}`,
      );
    }
  });

  it("T1.10: makeEmitter with no usable signer throws MissingSignerError", () => {
    const rec = recordingNats();
    assert.throws(
      () =>
        makeEmitter({
          cell: "no-key-cell",
          transport: createNatsTransport(rec.nats),
          signer: undefined as never,
          prevHashStore: new InMemoryPrevHashStore(),
        }),
      (err: unknown) => err instanceof MissingSignerError,
    );
  });

  it("BB F5: a bad specifier → Left(SubjectBuildError), NEVER a throw", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    // buildTopic rejects non-kebab segments; emit() must funnel that throw into
    // the typed Left (FR-3a: never throw), symmetric with emitRaw.
    const r = await emitter.emit(NftMintDetectedId, VALID_MINT, "BAD SLUG!");
    assert.ok(Either.isLeft(r), "a bad specifier is a Left, not a throw");
    assert.ok((r as Either.Left<SubjectBuildError, never>).left instanceof SubjectBuildError);
    assert.equal(rec.envelopes.length, 0, "nothing published when the subject can't be built");
  });
});

describe("emitRaw (T1.7, SKP-008)", () => {
  it("subject in the SchemaId family → Right; payload still validated", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    const r = await emitter.emitRaw(NftMintDetectedId, "nft.mint.detected.dynamic.v1", VALID_MINT);
    assert.ok(Either.isRight(r));
    assert.equal(rec.envelopes.length, 1);
    assert.equal(rec.envelopes[0].event_type, "nft.mint.detected.dynamic.v1");
  });

  it("subject outside the family → Left(SubjectFamilyError), no publish", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    const r = await emitter.emitRaw(NftMintDetectedId, "totally.different.v1", VALID_MINT);
    assert.ok(Either.isLeft(r));
    assert.ok((r as Either.Left<SubjectFamilyError, never>).left instanceof SubjectFamilyError);
    assert.equal(rec.envelopes.length, 0);
  });

  it("emitRaw validates the payload too (bad payload → Left even with valid family)", async () => {
    const rec = recordingNats();
    const emitter = await mkEmitter(rec);
    const bad = { chain_id: 1 } as unknown as typeof VALID_MINT;
    const r = await emitter.emitRaw(NftMintDetectedId, "nft.mint.detected.x.v1", bad);
    assert.ok(Either.isLeft(r));
    assert.equal(rec.envelopes.length, 0);
  });
});
