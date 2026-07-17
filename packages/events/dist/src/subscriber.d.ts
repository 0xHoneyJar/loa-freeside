import { Schema as S } from "@effect/schema";
import { type EventEnvelope } from "./envelope.js";
import type { Verifier } from "./signer.js";
import type { PrevHashStore } from "./publisher.js";
export type VerificationFailureReason = "envelope-schema-invalid" | "payload-schema-invalid" | "payload-hash-mismatch" | "signature-invalid" | "prev-hash-broken-chain" | "initial-anchor-policy-violation" | "json-parse-error"
/**
 * Delivery subject doesn't match the envelope's claimed `event_type` (rd-3
 * F-001 BB#227). A valid envelope republished onto a different NATS
 * subject is rejected here — closes the cross-subject replay vector that
 * EVT-001's metadata binding alone doesn't catch (sig still verifies
 * because envelope contents are unchanged; only the NATS delivery channel
 * differs).
 */
 | "subject-mismatch"
/** Application handler threw an exception; subscriber stayed alive (F-002 BB#227). */
 | "handler-error"
/** Uncaught exception inside the subscriber's verify-and-route loop body itself (F-002 BB#227). */
 | "internal-error";
export interface EnvelopeHandlerContext<T> {
    payload: T;
    envelope: EventEnvelope;
    subject: string;
}
export type EnvelopeHandler<T> = (ctx: EnvelopeHandlerContext<T>) => void | Promise<void>;
/**
 * Bootstrap-time replay defense for first-message-from-unknown-publisher
 * (EVT-002 BB#227).
 *
 *   - `'any'` — DEFAULT, backward-compatible. The subscriber accepts any
 *     `prev_hash` on the first envelope it sees from a publisher (the chain
 *     check is skipped because there is no prior hash to compare against).
 *     This is the historical behavior and is appropriate for subscribers
 *     that intentionally late-join a publisher's chain.
 *
 *   - `'genesis'` — STRICT. The first envelope from a publisher MUST have
 *     `prev_hash === GENESIS_PREV_HASH`. Replay of a mid-chain envelope is
 *     surfaced as `initial-anchor-policy-violation`. Choose this for
 *     subscribers that start at the beginning of a publisher's chain.
 *
 *   - `<hex-string>` — PINNED ANCHOR. The first envelope from a publisher
 *     MUST have `prev_hash === <hex-string>`. Use this when an
 *     out-of-band sync has established a known anchor (e.g. operator
 *     pinned the publisher's chain tip at restart time). String must
 *     match the 64-lowercase-hex format of `prev_hash`.
 */
export type InitialPrevHashPolicy = "any" | "genesis" | string;
interface NatsMessageLike {
    subject: string;
    data: Uint8Array;
}
interface NatsSubscriptionLike extends AsyncIterable<NatsMessageLike> {
    unsubscribe?: () => void;
    drain?: () => Promise<void>;
}
interface NatsLike {
    subscribe(subject: string, opts?: unknown): NatsSubscriptionLike;
}
export interface SubscribeOptions<T> {
    nats: NatsLike;
    subject: string;
    /**
     * Effect.Schema the payload must conform to AFTER envelope verification.
     * Validated against the parsed `payload` field of the envelope.
     */
    schema: S.Schema<T>;
    verifier: Verifier;
    handler: EnvelopeHandler<T>;
    /**
     * Optional per-publisher chain store. When provided, the subscriber tracks
     * each publisher's `prev_hash` continuity and surfaces `prev-hash-broken-chain`
     * via {@link SubscribeOptions.onVerificationFailure} if the chain breaks
     * (gap, replay, or tamper). Without a store, prev_hash is NOT checked by
     * the subscriber — sig + schema validation still apply.
     *
     * The store key is the envelope's `emitted_by:signing_key_id`, matching the
     * publisher's default `publisherKey`.
     */
    chainStore?: PrevHashStore;
    /**
     * Bootstrap policy for the FIRST envelope from each publisher (EVT-002
     * BB#227). Defaults to `'any'` (backward-compatible — current behavior).
     * Set to `'genesis'` to require the first envelope to carry
     * `prev_hash === GENESIS_PREV_HASH`, closing the mid-chain-replay vector.
     * Only relevant when `chainStore` is also provided.
     */
    initialPrevHashPolicy?: InitialPrevHashPolicy;
    /**
     * Called for every verification failure. NEVER throws and is best-effort
     * (failures here do not propagate). Subscriber stays alive across failures
     * — this is the fail-soft surface the build doc calls for.
     */
    onVerificationFailure?: (reason: VerificationFailureReason, detail: {
        subject: string;
        rawBytes: Uint8Array;
        envelope?: EventEnvelope;
        error?: unknown;
    }) => void | Promise<void>;
    /**
     * Optional NATS-level subscribe options (queue group, max, etc.). Passed
     * through verbatim.
     */
    natsSubscribeOpts?: unknown;
}
export interface SubscribeHandle {
    unsubscribe(): Promise<void>;
    /** Resolves when the underlying NATS subscription's async iterator completes. */
    done: Promise<void>;
}
/**
 * Subscribe to a NATS subject, verifying every envelope before invoking the
 * handler. Verification covers: envelope schema (Effect.Schema), full-envelope
 * signature recompute (acvp-l1-v2 — closes EVT-001), payload-hash recompute,
 * per-event Zod/Effect schema, optional per-publisher prev_hash continuity,
 * and optional initial-anchor policy (EVT-002 closes mid-chain replay
 * during bootstrap).
 *
 * The handler is awaited per-message in order; long-running handlers should
 * either return quickly or use queue groups (`natsSubscribeOpts.queue`) for
 * fan-out parallelism.
 *
 * Returns a {@link SubscribeHandle} for explicit teardown.
 */
export declare function subscribeEnvelope<T>(opts: SubscribeOptions<T>): Promise<SubscribeHandle>;
export {};
//# sourceMappingURL=subscriber.d.ts.map