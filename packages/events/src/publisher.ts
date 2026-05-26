import { randomUUID } from "node:crypto";
import { Schema as S } from "@effect/schema";
import {
  EventEnvelopeSchema,
  GENESIS_PREV_HASH,
  SCHEMA_VERSION,
  envelopeSigningBytes,
  type EventEnvelope,
} from "./envelope.js";
import { jcsCanonicalize, sha256Hex } from "./jcs.js";
import type { Signer } from "./signer.js";

// `onExcessProperty: "error"` mirrors Zod's `.strict()` — extra fields are
// REJECTED at decode time. Critical for the envelope contract: an extra
// field in a hashed envelope changes the hash and would silently break
// chain continuity for any subscriber that recomputes.
const decodeEnvelope = (input: unknown) =>
  S.decodeUnknownSync(EventEnvelopeSchema)(input, { onExcessProperty: "error" });

/**
 * Per-publisher hash-chain store.
 *
 * Each publisher (e.g. `sonar-api`) maintains an ordered chain — every emitted
 * envelope's `prev_hash` is the sha256 of the prior emitted envelope's full
 * JCS-canonical form. The store persists the most-recent hash per publisher.
 *
 * In-memory implementations (e.g. {@link InMemoryPrevHashStore}) are fine for
 * single-process publishers. Multi-instance publishers should back this with
 * Redis or another shared substrate so the chain remains continuous across
 * restarts and load-balanced sender instances.
 */
export interface PrevHashStore {
  get(publisherKey: string): Promise<string | null>;
  set(publisherKey: string, hash: string): Promise<void>;
}

export class InMemoryPrevHashStore implements PrevHashStore {
  #map = new Map<string, string>();

  async get(publisherKey: string): Promise<string | null> {
    return this.#map.get(publisherKey) ?? null;
  }

  async set(publisherKey: string, hash: string): Promise<void> {
    this.#map.set(publisherKey, hash);
  }
}

// --- minimal NATS publisher interface (avoid hard nats.js dep) --------------

interface NatsLike {
  publish(subject: string, data: Uint8Array, opts?: { headers?: unknown }): void | Promise<unknown>;
}

// --- options + result -------------------------------------------------------

export interface PublishOptions<P> {
  nats: NatsLike;
  subject: string;
  payload: P;
  /** Cell slug that emits — populates `emitted_by`. e.g. "sonar-api". */
  emittedBy: string;
  signer: Signer;
  prevHashStore: PrevHashStore;
  /**
   * Logical identifier for this publisher's per-instance chain. Defaults to
   * `${emittedBy}:${signer.keyId}` — most publishers want exactly one chain
   * per (cell, signing key) pair.
   */
  publisherKey?: string;
  /** Override timestamp (mostly for tests). */
  nowIso?: () => string;
  /** Override event_id generation (mostly for tests). */
  newEventId?: () => string;
}

export interface PublishResult {
  envelope: EventEnvelope;
  /** sha256 of the JCS-canonical envelope — next publish's prev_hash. */
  envelopeHash: string;
  /** Subject the envelope was published on. */
  subject: string;
}

/**
 * Wrap a payload in an ACVP envelope, sign it, and publish on NATS.
 *
 * Flow (acvp-l1-v2):
 *   1. canonicalize payload via JCS → payload_hash = sha256(canonical)
 *   2. prev_hash = store.get(publisherKey) ?? GENESIS_PREV_HASH
 *   3. assemble unsigned envelope (signature: "" placeholder)
 *   4. signing bytes = UTF-8(sha256-hex(JCS(envelope-with-empty-sig))) —
 *      this binds ALL non-signature fields to the signature (EVT-001 closed)
 *   5. signature = sign(signing bytes)
 *   6. attach real signature; validate via Effect.Schema (defense in depth)
 *   7. canonicalize signed envelope → envelopeHash = sha256(canonical)
 *   8. nats.publish(subject, canonical-envelope-bytes)
 *   9. store.set(publisherKey, envelopeHash)
 *
 * Throws if envelope validation fails (defensive — should never happen if
 * inputs are well-formed). NATS publish errors propagate to the caller; the
 * caller is responsible for fail-soft behavior (log + continue without
 * breaking the upstream domain write).
 *
 * **Known limitation — publish/store atomicity (F-003 BB#227)**
 *
 * `nats.publish` and `prevHashStore.set` are two separate async steps with
 * no rollback. A crash (or store-write failure) between them leaves the
 * publisher's chain tip stale; the next publish reuses a `prev_hash` that
 * was already consumed, forking the chain. Subscribers with `chainStore`
 * enabled will surface `prev-hash-broken-chain` on the second envelope.
 *
 * Single-instance publishers running in healthy processes do not hit this
 * gap in practice; the failure mode is bounded to crash/restart windows.
 *
 * The recommended Sprint-2+ mitigation:
 *
 *   1. Back `prevHashStore` with Redis using a CAS pipeline that conditions
 *      the `SET publisherKey newHash` on the NATS publish acknowledgement
 *      (e.g. via JetStream's PubAck.seq as the conditional token), OR
 *   2. Accept at-least-once semantics and add subscriber-side chain reset
 *      logic — wire `onVerificationFailure("prev-hash-broken-chain", ...)`
 *      to a recovery callback that updates the subscriber's chain store to
 *      the current envelope's hash and emits an audit event.
 *
 * Multi-instance publishers MUST use a shared store (Redis, etc.); the
 * default `InMemoryPrevHashStore` is single-process only.
 */
export async function publishEnvelope<P>(opts: PublishOptions<P>): Promise<PublishResult> {
  const publisherKey = opts.publisherKey ?? `${opts.emittedBy}:${opts.signer.keyId}`;
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  const newEventId = opts.newEventId ?? randomUUID;

  const canonicalPayload = jcsCanonicalize(opts.payload);
  const payloadHash = sha256Hex(canonicalPayload);

  const prevHash = (await opts.prevHashStore.get(publisherKey)) ?? GENESIS_PREV_HASH;

  // EVT-001 closed: signing bytes derived from the FULL envelope (with
  // signature placeholder), so any tamper to any field invalidates the sig.
  const unsignedEnvelope: Omit<EventEnvelope, "signature"> = {
    event_id: newEventId(),
    event_type: opts.subject,
    schema_version: SCHEMA_VERSION,
    emitted_by: opts.emittedBy,
    emitted_at: nowIso(),
    prev_hash: prevHash,
    payload_hash: payloadHash,
    signing_key_id: opts.signer.keyId,
    payload: opts.payload,
  };

  const sigBytes = envelopeSigningBytes(unsignedEnvelope);
  const signature = await opts.signer.sign(sigBytes);

  const envelope: EventEnvelope = { ...unsignedEnvelope, signature };

  // Defense in depth: ensure the envelope conforms to its own contract
  // before we hash + publish it. If any field is malformed, fail loud HERE
  // rather than propagating an invalid envelope into the chain.
  const validated = decodeEnvelope(envelope);

  const canonicalEnvelope = jcsCanonicalize(validated);
  const envelopeHash = sha256Hex(canonicalEnvelope);

  await opts.nats.publish(opts.subject, new TextEncoder().encode(canonicalEnvelope));
  await opts.prevHashStore.set(publisherKey, envelopeHash);

  return { envelope: validated, envelopeHash, subject: opts.subject };
}
