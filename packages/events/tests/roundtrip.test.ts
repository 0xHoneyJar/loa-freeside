import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Schema as S } from "@effect/schema";

import { publishEnvelope, InMemoryPrevHashStore } from "../src/publisher.js";
import { subscribeEnvelope, type VerificationFailureReason } from "../src/subscriber.js";
import { LocalEd25519Signer, StaticPubkeyVerifier } from "../src/signer.js";
import { nftMintDetectedTopic } from "../src/topics.js";
import { NftMintDetectedSchema, type NftMintDetected } from "../src/schemas/nft-mint-detected.js";
import { GENESIS_PREV_HASH, type EventEnvelope } from "../src/envelope.js";
import { jcsCanonicalize, sha256Hex } from "../src/jcs.js";

// --- minimal in-memory fake NATS for roundtrip tests -------------------------

interface FakeMessage {
  subject: string;
  data: Uint8Array;
}

class FakeNats {
  #queues = new Map<string, FakeMessage[]>();
  #waiters = new Map<string, Array<(msg: FakeMessage) => void>>();
  #subscriptions = new Set<string>();

  publish(subject: string, data: Uint8Array): void {
    const msg: FakeMessage = { subject, data };
    const subs = matchingSubscriptions(this.#subscriptions, subject);
    for (const s of subs) {
      const waiters = this.#waiters.get(s);
      if (waiters && waiters.length > 0) {
        const resolve = waiters.shift()!;
        resolve(msg);
      } else {
        const q = this.#queues.get(s) ?? [];
        q.push(msg);
        this.#queues.set(s, q);
      }
    }
  }

  subscribe(subject: string): AsyncIterable<FakeMessage> & { unsubscribe: () => void } {
    this.#subscriptions.add(subject);
    let cancelled = false;
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (cancelled) return { value: undefined, done: true as const };
          const q = this.#queues.get(subject) ?? [];
          if (q.length > 0) {
            const msg = q.shift()!;
            this.#queues.set(subject, q);
            return { value: msg, done: false as const };
          }
          return new Promise<{ value: FakeMessage; done: false }>((resolve) => {
            const waiters = this.#waiters.get(subject) ?? [];
            waiters.push((m) => resolve({ value: m, done: false as const }));
            this.#waiters.set(subject, waiters);
          });
        },
      }),
      unsubscribe: () => {
        cancelled = true;
        this.#subscriptions.delete(subject);
      },
    };
  }
}

function matchingSubscriptions(subs: Set<string>, subject: string): string[] {
  const out: string[] = [];
  for (const sub of subs) if (subjectMatches(sub, subject)) out.push(sub);
  return out;
}

function subjectMatches(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  if (pattern.endsWith(">")) return subject.startsWith(pattern.slice(0, -1));
  return false;
}

// --- valid synthetic payload -------------------------------------------------

const VALID_PAYLOAD: NftMintDetected = {
  chain_id: 80094,
  contract: "0x048327a187b944ddac61c6e202bfccd20d17c008",
  token_id: "234",
  minter: "0x000000000000000000000000000000000000abcd",
  block_number: 12345678,
  transaction_hash: "0x" + "ab".repeat(32),
  timestamp: "2026-05-26T21:30:00Z",
};

async function buildSigner() {
  const signer = await LocalEd25519Signer.fromSeedHex("0".repeat(64), "sonar-api-1");
  const verifier = new StaticPubkeyVerifier().add("sonar-api-1", signer.publicKeyBytes());
  return { signer, verifier };
}

// --- helpers for waiting (deterministic — TODO follow-up bead wdd) -----------

async function tick(ms = 10): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// --- the actual roundtrip + failure-mode tests ------------------------------

describe("publish → subscribe roundtrip (acvp-l1-v2)", () => {
  it("delivers a valid envelope through verify + schema and into the handler", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const prevHashStore = new InMemoryPrevHashStore();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const received: Array<{ payload: NftMintDetected; envelope: EventEnvelope }> = [];
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      handler: async ({ payload, envelope }) => {
        received.push({ payload, envelope });
      },
    });

    await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore,
    });

    await tick();

    assert.equal(received.length, 1);
    assert.equal(received[0]!.payload.token_id, "234");
    assert.equal(received[0]!.envelope.prev_hash, GENESIS_PREV_HASH);
    assert.equal(received[0]!.envelope.schema_version, "acvp-l1-v2");
    sub.unsubscribe();
  });

  it("delivers via wildcard subscription", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const prevHashStore = new InMemoryPrevHashStore();
    const subject = nftMintDetectedTopic({ collectionSlug: "purupuru-apiculture" });

    const received: Array<EventEnvelope> = [];
    const sub = await subscribeEnvelope({
      nats,
      subject: "nft.mint.detected.>",
      schema: NftMintDetectedSchema,
      verifier,
      handler: async ({ envelope }) => {
        received.push(envelope);
      },
    });

    await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore,
    });

    await tick();
    assert.equal(received.length, 1);
    assert.equal(received[0]!.event_type, subject);
    sub.unsubscribe();
  });

  it("advances prev_hash across two consecutive publishes (per-publisher chain)", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const prevHashStore = new InMemoryPrevHashStore();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const received: Array<EventEnvelope> = [];
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      handler: async ({ envelope }) => {
        received.push(envelope);
      },
    });

    const a = await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore,
    });
    const b = await publishEnvelope({
      nats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "235", block_number: 12345679 },
      emittedBy: "sonar-api",
      signer,
      prevHashStore,
    });

    await tick();

    assert.equal(received.length, 2);
    assert.equal(received[0]!.prev_hash, GENESIS_PREV_HASH);
    assert.equal(received[1]!.prev_hash, a.envelopeHash);
    assert.equal(b.envelope.prev_hash, a.envelopeHash);
    sub.unsubscribe();
  });

  it("surfaces signature-invalid when a wrong key signs the envelope", async () => {
    const nats = new FakeNats();
    const goodSigner = await LocalEd25519Signer.fromSeedHex("0".repeat(64), "sonar-api-1");
    const wrongSigner = await LocalEd25519Signer.fromSeedHex("1".repeat(64), "sonar-api-1");
    const verifier = new StaticPubkeyVerifier().add("sonar-api-1", goodSigner.publicKeyBytes());

    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const failures: VerificationFailureReason[] = [];
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      handler: async () => {
        throw new Error("handler should not be called for invalid sig");
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer: wrongSigner,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    await tick();
    assert.deepEqual(failures, ["signature-invalid"]);
    sub.unsubscribe();
  });

  it("rd-3 F-001: surfaces subject-mismatch when envelope replayed onto a different NATS subject", async () => {
    // Attacker captures a valid envelope for subject-A and republishes on
    // subject-B. The envelope is byte-identical (sig still verifies) but
    // the delivery channel differs. A wildcard subscriber that catches the
    // replay must surface subject-mismatch BEFORE running the handler.
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const originalSubject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });
    const otherSubject = nftMintDetectedTopic({ collectionSlug: "purupuru-apiculture" });

    // Produce a valid envelope on the original subject (via discard nats)
    const discardNats = new FakeNats();
    const issued = await publishEnvelope({
      nats: discardNats,
      subject: originalSubject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    const failures: VerificationFailureReason[] = [];
    let handlerCalled = 0;
    const sub = await subscribeEnvelope({
      nats,
      // wildcard so the subscriber receives the replay regardless of subject
      subject: "nft.mint.detected.>",
      schema: NftMintDetectedSchema,
      verifier,
      handler: async () => {
        handlerCalled++;
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    // Replay the byte-identical envelope onto the WRONG subject
    const replayBytes = new TextEncoder().encode(jcsCanonicalize(issued.envelope));
    nats.publish(otherSubject, replayBytes);

    await tick();
    assert.equal(handlerCalled, 0, "handler must not be invoked for subject-mismatched replay");
    assert.deepEqual(failures, ["subject-mismatch"]);
    sub.unsubscribe();
  });

  it("rd-3 F-002: chain tip does NOT advance when payload schema validation fails", async () => {
    // A signed-but-payload-invalid envelope should be rejected by per-event
    // schema check AND must NOT advance the subscriber's chain — otherwise
    // the next valid envelope appears continuous after an event the
    // application never accepted.
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const subscriberChain = new InMemoryPrevHashStore();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });
    const publisherKey = "sonar-api:sonar-api-1";

    let handled = 0;
    const failures: VerificationFailureReason[] = [];
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      chainStore: subscriberChain,
      handler: async () => {
        handled++;
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    // 1. publish a VALID envelope — chain advances to envHash1
    const publisherStore = new InMemoryPrevHashStore();
    const valid1 = await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    await tick();
    assert.equal(handled, 1);
    assert.equal(await subscriberChain.get(publisherKey), valid1.envelopeHash);

    // 2. publish a SIGNED but SCHEMA-INVALID envelope (chain MUST NOT advance)
    const bad = { ...VALID_PAYLOAD, token_id: undefined } as unknown as NftMintDetected;
    await publishEnvelope({
      nats,
      subject,
      payload: bad,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    await tick();
    // payload-schema-invalid was surfaced; handler still at 1
    assert.equal(handled, 1);
    assert.deepEqual(failures, ["payload-schema-invalid"]);
    // critical: chain tip is STILL valid1 — not advanced past the bad envelope
    assert.equal(
      await subscriberChain.get(publisherKey),
      valid1.envelopeHash,
      "chain must not advance on payload-schema-invalid",
    );

    sub.unsubscribe();
  });

  it("EVT-001: surfaces signature-invalid when event_type is tampered in transit", async () => {
    // Simulate an attacker who captures a valid envelope and modifies the
    // event_type before re-publishing on the new subject. Under acvp-l1-v1
    // this was an undetectable forgery; under acvp-l1-v2 the sig binds the
    // full envelope so signature verification MUST fail.
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const originalSubject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });
    const tamperedSubject = nftMintDetectedTopic({ collectionSlug: "other-collection" });

    // Publish into a discard nats to get a valid envelope, then replay-with-tamper
    const discardNats = new FakeNats();
    await publishEnvelope({
      nats: discardNats,
      subject: originalSubject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    // Manually publish a tampered version of the same envelope on a different
    // subject (signature stays the same but event_type is swapped)
    const failures: VerificationFailureReason[] = [];
    const sub = await subscribeEnvelope({
      nats,
      subject: tamperedSubject,
      schema: NftMintDetectedSchema,
      verifier,
      handler: async () => {
        throw new Error("handler should not be called for forged event_type");
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    // Manually craft the tampered envelope (event_type swapped, signature kept)
    const signedEnvelope = (
      await publishEnvelope({
        nats: discardNats,
        subject: originalSubject,
        payload: VALID_PAYLOAD,
        emittedBy: "sonar-api",
        signer,
        prevHashStore: new InMemoryPrevHashStore(),
      })
    ).envelope;

    const tamperedEnvelope = { ...signedEnvelope, event_type: tamperedSubject };
    const tamperedBytes = new TextEncoder().encode(jcsCanonicalize(tamperedEnvelope));
    nats.publish(tamperedSubject, tamperedBytes);

    await tick();
    assert.deepEqual(failures, ["signature-invalid"]);
    sub.unsubscribe();
  });

  it("surfaces payload-schema-invalid when payload fails the per-event schema", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const failures: VerificationFailureReason[] = [];
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      handler: async () => {
        throw new Error("handler should not be called for invalid schema");
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    const bad = { ...VALID_PAYLOAD, token_id: undefined } as unknown as NftMintDetected;
    await publishEnvelope({
      nats,
      subject,
      payload: bad,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    await tick();
    assert.deepEqual(failures, ["payload-schema-invalid"]);
    sub.unsubscribe();
  });

  it("surfaces handler-error when the application handler throws (F-002)", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const failures: VerificationFailureReason[] = [];
    let handlerInvocations = 0;
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      handler: async () => {
        handlerInvocations++;
        throw new Error("application code is buggy");
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });
    await publishEnvelope({
      nats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "235" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    await tick(20);
    assert.equal(handlerInvocations, 2, "subscriber stays alive across handler throws");
    assert.deepEqual(failures, ["handler-error", "handler-error"]);
    sub.unsubscribe();
  });

  it("surfaces prev-hash-broken-chain when chainStore detects a gap", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const publisherStore = new InMemoryPrevHashStore();
    const subscriberStore = new InMemoryPrevHashStore();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const failures: VerificationFailureReason[] = [];
    let handledCount = 0;
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      chainStore: subscriberStore,
      handler: async () => {
        handledCount++;
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    // 1st publish lands cleanly
    await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    // Simulate a missing envelope by advancing the publisher's chain
    // without actually delivering the envelope to `nats`.
    const ghostStore = new InMemoryPrevHashStore();
    const currentHash = await publisherStore.get("sonar-api:sonar-api-1");
    if (currentHash) await ghostStore.set("sonar-api:sonar-api-1", currentHash);
    const discardNats = new FakeNats();
    await publishEnvelope({
      nats: discardNats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "235" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: ghostStore,
    });
    const advancedHash = await ghostStore.get("sonar-api:sonar-api-1");
    if (advancedHash) await publisherStore.set("sonar-api:sonar-api-1", advancedHash);

    // 2nd visible publish — prev_hash points at the ghost envelope subscriber never saw
    await publishEnvelope({
      nats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "236" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    await tick();
    assert.equal(handledCount, 1, "only the first envelope reaches the handler");
    assert.deepEqual(failures, ["prev-hash-broken-chain"]);
    sub.unsubscribe();
  });

  it("EVT-002: initialPrevHashPolicy 'genesis' rejects mid-chain replay as first envelope", async () => {
    // Attacker captures envelope from publisher who has been running a while
    // (so its prev_hash is some non-genesis value) and replays it as the
    // FIRST envelope a fresh subscriber sees. With initialPrevHashPolicy='any'
    // (default) this is accepted (legacy behavior); with 'genesis' it's
    // rejected with `initial-anchor-policy-violation`.
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const failures: VerificationFailureReason[] = [];
    let handled = 0;
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      chainStore: new InMemoryPrevHashStore(),
      initialPrevHashPolicy: "genesis",
      handler: async () => {
        handled++;
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    // Advance the publisher's chain past genesis (3 publishes into a discard nats)
    const publisherStore = new InMemoryPrevHashStore();
    const discardNats = new FakeNats();
    for (let i = 0; i < 3; i++) {
      await publishEnvelope({
        nats: discardNats,
        subject,
        payload: { ...VALID_PAYLOAD, token_id: String(100 + i) },
        emittedBy: "sonar-api",
        signer,
        prevHashStore: publisherStore,
      });
    }
    // Now publish the "replay" to the live subscriber — first time seeing this
    // publisher, but prev_hash is NOT genesis.
    await publishEnvelope({
      nats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "999" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    await tick();
    assert.equal(handled, 0);
    assert.deepEqual(failures, ["initial-anchor-policy-violation"]);
    sub.unsubscribe();
  });

  it("EVT-002: initialPrevHashPolicy 'genesis' accepts a genesis-anchored first envelope", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const received: EventEnvelope[] = [];
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      chainStore: new InMemoryPrevHashStore(),
      initialPrevHashPolicy: "genesis",
      handler: async ({ envelope }) => {
        received.push(envelope);
      },
    });

    await publishEnvelope({
      nats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    await tick();
    assert.equal(received.length, 1);
    assert.equal(received[0]!.prev_hash, GENESIS_PREV_HASH);
    sub.unsubscribe();
  });

  it("EVT-002: initialPrevHashPolicy <hex-string> accepts pinned anchor only", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    // Advance publisher chain by 1 to get a known non-genesis anchor
    const publisherStore = new InMemoryPrevHashStore();
    const discardNats = new FakeNats();
    const first = await publishEnvelope({
      nats: discardNats,
      subject,
      payload: VALID_PAYLOAD,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });
    const anchor = first.envelopeHash; // this is what publisher's NEXT prev_hash will be

    // Subscriber pins this anchor as the expected first prev_hash
    const failures: VerificationFailureReason[] = [];
    let handled = 0;
    const sub = await subscribeEnvelope({
      nats,
      subject,
      schema: NftMintDetectedSchema,
      verifier,
      chainStore: new InMemoryPrevHashStore(),
      initialPrevHashPolicy: anchor,
      handler: async () => {
        handled++;
      },
      onVerificationFailure: (reason) => {
        failures.push(reason);
      },
    });

    // Publish the next envelope (whose prev_hash WILL be `anchor`)
    await publishEnvelope({
      nats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "777" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    await tick();
    assert.equal(handled, 1);
    assert.equal(failures.length, 0);
    sub.unsubscribe();
  });
});
