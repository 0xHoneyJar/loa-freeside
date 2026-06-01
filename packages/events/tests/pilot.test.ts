import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Either } from "effect";
import { makeEmitter, TransportEmitError, type DeadLetterInfo } from "../src/emit.js";
import { lookupSchema } from "../src/registry.js";
import { ParallelModeEnabledId } from "../src/registry.js";
import { configHash, type ParallelModeEnabled } from "../src/schemas/parallel-mode-enabled.js";
import { createNatsTransport, type RawNats } from "../src/transport.js";
import { InMemoryPrevHashStore } from "../src/publisher.js";
import { subscribeEnvelope } from "../src/subscriber.js";
import { LocalEd25519Signer, StaticPubkeyVerifier } from "../src/signer.js";
import { GENESIS_PREV_HASH, type EventEnvelope } from "../src/envelope.js";

// --- minimal in-memory NATS (publish + subscribe), modelled on roundtrip.test --
class FakeNats {
  #subs = new Map<string, Array<(m: { subject: string; data: Uint8Array }) => void>>();
  publish(subject: string, data: Uint8Array): void {
    for (const [pat, hs] of this.#subs) {
      if (pat === subject || (pat.endsWith(">") && subject.startsWith(pat.slice(0, -1)))) {
        for (const h of hs) h({ subject, data });
      }
    }
  }
  subscribe(subject: string): AsyncIterable<{ subject: string; data: Uint8Array }> & {
    unsubscribe: () => void;
  } {
    const q: Array<{ subject: string; data: Uint8Array }> = [];
    let waiter: ((m: { subject: string; data: Uint8Array }) => void) | null = null;
    const push = (m: { subject: string; data: Uint8Array }) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(m);
      } else q.push(m);
    };
    const list = this.#subs.get(subject) ?? [];
    list.push(push);
    this.#subs.set(subject, list);
    let cancelled = false;
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (cancelled) return { value: undefined, done: true as const };
          if (q.length) return { value: q.shift()!, done: false as const };
          return new Promise<{ value: { subject: string; data: Uint8Array }; done: false }>((res) => {
            waiter = (m) => res({ value: m, done: false as const });
          });
        },
      }),
      unsubscribe: () => {
        cancelled = true;
      },
    };
  }
}

const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));

async function buildSigner() {
  const signer = await LocalEd25519Signer.fromSeedHex("0".repeat(64), "freeside-coexistence-1");
  const verifier = new StaticPubkeyVerifier().add("freeside-coexistence-1", signer.publicKeyBytes());
  return { signer, verifier };
}

const VALID: ParallelModeEnabled = {
  community_id: "c-123",
  guild_id: "g-456",
  config_hash: configHash({ mode: "parallel", channels: ["general"], threshold: 5 }),
  mode: "parallel",
  enabled_at: "2026-05-31T00:00:00Z",
};

describe("pilot: parallel.mode.enabled (T4.1/T4.2/T4.3, FR-10/11/12)", () => {
  it("config_hash is deterministic + re-derivable (IMP-004)", () => {
    const subset = { mode: "parallel", channels: ["general"], threshold: 5 };
    assert.equal(configHash(subset), configHash({ ...subset }));
    assert.match(configHash(subset), /^[0-9a-f]{64}$/);
  });

  it("FR-12: registry → emit() → envelope → verifying consumer (registry schema, sig+schema+chain)", async () => {
    const nats = new FakeNats();
    const { signer, verifier } = await buildSigner();
    const transport = createNatsTransport(nats as unknown as RawNats);
    const emitter = makeEmitter({
      cell: "freeside-coexistence",
      transport,
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
    });

    // The verifying consumer resolves the schema FROM THE REGISTRY — the first
    // real exercise of receiver-side soundness (events-trace.ts passes S.Unknown).
    const entry = lookupSchema(ParallelModeEnabledId)!;
    const received: Array<{ payload: ParallelModeEnabled; envelope: EventEnvelope }> = [];
    const sub = await subscribeEnvelope<ParallelModeEnabled>({
      nats: nats as never,
      subject: "parallel.mode.enabled.v1",
      schema: entry.schema as never,
      verifier,
      chainStore: new InMemoryPrevHashStore(),
      handler: async ({ payload, envelope }) => void received.push({ payload, envelope }),
    });

    const r = await emitter.emit(ParallelModeEnabledId, VALID);
    assert.ok(Either.isRight(r), "emit succeeded");
    await tick();

    assert.equal(received.length, 1, "consumer received the event");
    assert.equal(received[0]!.payload.community_id, "c-123"); // schema-validated
    assert.equal(received[0]!.envelope.prev_hash, GENESIS_PREV_HASH); // chain
    assert.equal(received[0]!.envelope.schema_version, "acvp-l1-v2"); // verified envelope
    sub.unsubscribe();
  });
});

describe("pilot: observability + recovery (T4.4/T4.5, SKP-003/IMP-007)", () => {
  const failingTransport = () =>
    createNatsTransport({
      publish: () => {
        throw new Error("nats down");
      },
    });

  it("T4.4: a transport failure is OBSERVABLE — dead-letter fires, not a silent drop", async () => {
    const { signer } = await buildSigner();
    const dead: DeadLetterInfo[] = [];
    const emitter = makeEmitter({
      cell: "freeside-coexistence",
      transport: failingTransport(),
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
      recovery: { maxRetries: 0, deadLetter: (i) => dead.push(i) },
    });
    const r = await emitter.emit(ParallelModeEnabledId, VALID);
    assert.ok(Either.isLeft(r));
    assert.ok((r as Either.Left<TransportEmitError, never>).left instanceof TransportEmitError);
    assert.equal(dead.length, 1, "dead-letter observed the divergence");
    assert.equal(dead[0]!.attempts, 1);
  });

  it("T4.5: transport failures RETRY then dead-letter (transient recovery)", async () => {
    const { signer } = await buildSigner();
    const dead: DeadLetterInfo[] = [];
    const emitter = makeEmitter({
      cell: "freeside-coexistence",
      transport: failingTransport(),
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
      recovery: { maxRetries: 2, backoffMs: 1, sleep: async () => {}, deadLetter: (i) => dead.push(i) },
    });
    const r = await emitter.emit(ParallelModeEnabledId, VALID);
    assert.ok(Either.isLeft(r));
    assert.equal(dead[0]!.attempts, 3, "1 initial + 2 retries before dead-letter");
  });

  it("T4.5: a VALIDATION failure drops immediately — NO retry, NO dead-letter", async () => {
    const { signer } = await buildSigner();
    const dead: DeadLetterInfo[] = [];
    const emitter = makeEmitter({
      cell: "freeside-coexistence",
      transport: failingTransport(),
      signer,
      prevHashStore: new InMemoryPrevHashStore(),
      recovery: { maxRetries: 5, backoffMs: 1, sleep: async () => {}, deadLetter: (i) => dead.push(i) },
    });
    const bad = { community_id: "c" } as unknown as ParallelModeEnabled;
    const r = await emitter.emit(ParallelModeEnabledId, bad);
    assert.ok(Either.isLeft(r));
    assert.equal(dead.length, 0, "validation failures are deterministic — never retried/dead-lettered");
  });
});
