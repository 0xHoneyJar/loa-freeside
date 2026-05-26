import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { publishEnvelope, InMemoryPrevHashStore } from "../src/publisher.js";
import { subscribeEnvelope, type VerificationFailureReason } from "../src/subscriber.js";
import { LocalEd25519Signer, StaticPubkeyVerifier } from "../src/signer.js";
import { nftMintDetectedTopic } from "../src/topics.js";
import { NftMintDetectedSchema } from "../src/schemas/nft-mint-detected.js";
import { GENESIS_PREV_HASH, type EventEnvelope } from "../src/envelope.js";

// --- minimal in-memory fake NATS for roundtrip tests -------------------------

interface FakeMessage {
  subject: string;
  data: Uint8Array;
}

class FakeNats {
  // subject → queue of messages
  #queues = new Map<string, FakeMessage[]>();
  // subject → pending-resolvers waiting for a message
  #waiters = new Map<string, Array<(msg: FakeMessage) => void>>();
  // subject → "subscribed" flag (so we know to flush a queue into an iterator)
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
    const iter = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (cancelled) return { value: undefined, done: true as const };
          // drain queue first
          const q = this.#queues.get(subject) ?? [];
          if (q.length > 0) {
            const msg = q.shift()!;
            this.#queues.set(subject, q);
            return { value: msg, done: false as const };
          }
          // wait
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
    return iter;
  }
}

function matchingSubscriptions(subs: Set<string>, subject: string): string[] {
  const out: string[] = [];
  for (const sub of subs) {
    if (subjectMatches(sub, subject)) out.push(sub);
  }
  return out;
}

/** Minimal NATS subject matcher — supports `>` (multi-token catch-all). */
function subjectMatches(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  if (pattern.endsWith(">")) {
    const prefix = pattern.slice(0, -1); // includes trailing dot
    return subject.startsWith(prefix);
  }
  return false;
}

// --- valid synthetic payload -------------------------------------------------

const VALID_PAYLOAD = {
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

// --- the actual roundtrip + failure-mode tests ------------------------------

describe("publish → subscribe roundtrip", () => {
  it("delivers a valid envelope through verify + schema and into the handler", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const prevHashStore = new InMemoryPrevHashStore();
    const subject = nftMintDetectedTopic({ collectionSlug: "mibera-shadow" });

    const received: Array<{ payload: typeof VALID_PAYLOAD; envelope: EventEnvelope }> = [];
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

    // give the async loop a tick
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(received.length, 1);
    assert.equal(received[0]!.payload.token_id, "234");
    assert.equal(received[0]!.envelope.prev_hash, GENESIS_PREV_HASH);

    sub.unsubscribe(); // best-effort cleanup; we don't await done
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

    await new Promise((r) => setTimeout(r, 10));
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

    await new Promise((r) => setTimeout(r, 10));

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
    // Verifier knows the GOOD key under sonar-api-1
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
      signer: wrongSigner, // signs with a key the verifier doesn't have
      prevHashStore: new InMemoryPrevHashStore(),
    });

    await new Promise((r) => setTimeout(r, 10));
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

    // Publish with a missing required field (token_id)
    const bad = { ...VALID_PAYLOAD, token_id: undefined } as unknown as typeof VALID_PAYLOAD;
    await publishEnvelope({
      nats,
      subject,
      payload: bad,
      emittedBy: "sonar-api",
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(failures, ["payload-schema-invalid"]);
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

    // Simulate publisher OR subscriber missing message #2:
    // publisher emits a 2nd envelope (advances publisher store) but we DROP it
    // before it reaches NATS. We do this by directly advancing the publisher
    // store without publishing.
    const ghostPublisherStore = new InMemoryPrevHashStore();
    // copy current hash forward, then publish a "ghost" envelope to advance the chain in our local store
    const currentHash = await publisherStore.get("sonar-api:sonar-api-1");
    if (currentHash) await ghostPublisherStore.set("sonar-api:sonar-api-1", currentHash);
    // emit ghost to discard (different nats instance — never sees it)
    const discardNats = new FakeNats();
    await publishEnvelope({
      nats: discardNats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "235" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: ghostPublisherStore,
    });

    // Now the publisher's CHAIN view has advanced (ghostPublisherStore knows the
    // ghost envelope's hash). Sync that forward to the real publisher store.
    const advancedHash = await ghostPublisherStore.get("sonar-api:sonar-api-1");
    if (advancedHash) await publisherStore.set("sonar-api:sonar-api-1", advancedHash);

    // 2nd visible publish — prev_hash now references the ghost envelope the
    // subscriber NEVER SAW. Subscriber's chain check must surface the gap.
    await publishEnvelope({
      nats,
      subject,
      payload: { ...VALID_PAYLOAD, token_id: "236" },
      emittedBy: "sonar-api",
      signer,
      prevHashStore: publisherStore,
    });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(handledCount, 1, "only the first envelope reaches the handler");
    assert.deepEqual(failures, ["prev-hash-broken-chain"]);
    sub.unsubscribe();
  });
});
