import { Schema as S } from "@effect/schema";
import {
  EventEnvelopeSchema,
  GENESIS_PREV_HASH,
  envelopeSigningBytes,
  type EventEnvelope,
} from "./envelope.js";
import { jcsCanonicalize, sha256Hex } from "./jcs.js";
import type { Verifier } from "./signer.js";
import type { PrevHashStore } from "./publisher.js";

export type VerificationFailureReason =
  | "envelope-schema-invalid"
  | "payload-schema-invalid"
  | "payload-hash-mismatch"
  | "signature-invalid"
  | "prev-hash-broken-chain"
  | "initial-anchor-policy-violation"
  | "json-parse-error"
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

// --- minimal NATS subscriber interface (avoid hard nats.js dep) --------------

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

// --- options + result -------------------------------------------------------

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
  onVerificationFailure?: (
    reason: VerificationFailureReason,
    detail: { subject: string; rawBytes: Uint8Array; envelope?: EventEnvelope; error?: unknown },
  ) => void | Promise<void>;

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

// --- prebuilt decoders -------------------------------------------------------

// `onExcessProperty: "error"` — extra fields in the envelope are REJECTED
// (mirrors zod's `.strict()`). Critical because the envelope is hashed:
// an extra field would change the canonical form and silently break
// chain continuity.
const decodeEnvelopeEither = (input: unknown) =>
  S.decodeUnknownEither(EventEnvelopeSchema)(input, { onExcessProperty: "error" });

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
export async function subscribeEnvelope<T>(opts: SubscribeOptions<T>): Promise<SubscribeHandle> {
  const sub = opts.nats.subscribe(opts.subject, opts.natsSubscribeOpts);
  const initialPolicy: InitialPrevHashPolicy = opts.initialPrevHashPolicy ?? "any";
  const decodePayloadEither = S.decodeUnknownEither(opts.schema);

  const reportFailure = async (
    reason: VerificationFailureReason,
    detail: { subject: string; rawBytes: Uint8Array; envelope?: EventEnvelope; error?: unknown },
  ): Promise<void> => {
    if (!opts.onVerificationFailure) return;
    try {
      await opts.onVerificationFailure(reason, detail);
    } catch {
      // failure-callback failures are themselves silent — subscriber must stay alive
    }
  };

  const consume = async (): Promise<void> => {
    for await (const msg of sub) {
      let envelope: EventEnvelope | undefined;
      try {
        // 1. parse JSON
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder().decode(msg.data));
        } catch (error) {
          await reportFailure("json-parse-error", { subject: msg.subject, rawBytes: msg.data, error });
          continue;
        }

        // 2. validate envelope shape
        const envelopeResult = decodeEnvelopeEither(parsed);
        if (envelopeResult._tag === "Left") {
          await reportFailure("envelope-schema-invalid", {
            subject: msg.subject,
            rawBytes: msg.data,
            error: envelopeResult.left,
          });
          continue;
        }
        envelope = envelopeResult.right;

        // 3. delivery-subject binding (rd-3 F-001 BB#227)
        // Reject when the NATS subject the message arrived on does not
        // match the envelope's claimed `event_type`. EVT-001 binds metadata
        // INSIDE the envelope to the signature, but an attacker who keeps
        // the envelope intact and republishes on a DIFFERENT subject would
        // still produce a sig-valid message — the cross-subject replay
        // vector. The subject-binding check closes it: a wildcard
        // subscriber that catches the replay surfaces `subject-mismatch`
        // BEFORE the handler runs.
        if (msg.subject !== envelope.event_type) {
          await reportFailure("subject-mismatch", {
            subject: msg.subject,
            rawBytes: msg.data,
            envelope,
          });
          continue;
        }

        // 4. recompute payload hash and check against envelope's claim
        const canonicalPayload = jcsCanonicalize(envelope.payload);
        const recomputedPayloadHash = sha256Hex(canonicalPayload);
        if (recomputedPayloadHash !== envelope.payload_hash) {
          await reportFailure("payload-hash-mismatch", {
            subject: msg.subject,
            rawBytes: msg.data,
            envelope,
          });
          continue;
        }

        // 5. verify signature (acvp-l1-v2: full-envelope binding)
        // Reconstruct the unsigned envelope shape, derive signing bytes,
        // verify against the envelope's claimed signature + signing_key_id.
        const { signature, ...unsigned } = envelope;
        const sigBytes = envelopeSigningBytes(unsigned);
        const sigOk = await opts.verifier.verify(envelope.signing_key_id, sigBytes, signature);
        if (!sigOk) {
          await reportFailure("signature-invalid", { subject: msg.subject, rawBytes: msg.data, envelope });
          continue;
        }

        // 6. (optional) per-publisher chain continuity check + EVT-002
        // bootstrap anchor. The chain TIP UPDATE is deferred to step 8 —
        // after per-event payload schema validates — so the chain tracks
        // APPLICATION-ACCEPTED envelopes, not merely cryptographically
        // well-formed ones (rd-3 F-002 BB#227). A signed-but-payload-invalid
        // envelope therefore does NOT advance the chain; the next valid
        // envelope's prev_hash still references the last accepted entry.
        if (opts.chainStore) {
          const publisherKey = `${envelope.emitted_by}:${envelope.signing_key_id}`;
          const expectedPrev = await opts.chainStore.get(publisherKey);
          if (expectedPrev === null) {
            const requiredAnchor = initialPolicy === "any"
              ? null
              : initialPolicy === "genesis"
                ? GENESIS_PREV_HASH
                : initialPolicy;
            if (requiredAnchor !== null && envelope.prev_hash !== requiredAnchor) {
              await reportFailure("initial-anchor-policy-violation", {
                subject: msg.subject,
                rawBytes: msg.data,
                envelope,
              });
              continue;
            }
          } else if (expectedPrev !== envelope.prev_hash) {
            await reportFailure("prev-hash-broken-chain", {
              subject: msg.subject,
              rawBytes: msg.data,
              envelope,
            });
            // Do NOT auto-advance the store on broken chain.
            //
            // Known limitation (F-005 BB#227): once a gap is detected, every
            // subsequent envelope from the same publisher will continue to
            // fail this check (its prev_hash references the missed envelope's
            // hash, which the subscriber never recorded). Recovery requires
            // operator action — the recommended pattern is:
            //
            //   onVerificationFailure: async (reason, detail) => {
            //     if (reason !== "prev-hash-broken-chain" || !detail.envelope) return;
            //     // emit an audit / alert here for forensic forensics
            //     // then unconditionally advance the local chain to admit the gap:
            //     await chainStore.set(
            //       `${detail.envelope.emitted_by}:${detail.envelope.signing_key_id}`,
            //       sha256Hex(jcsCanonicalize(detail.envelope)),
            //     );
            //   };
            //
            // Sprint 2+ will add a first-class `onChainGap` option that
            // returns `'skip' | 'reset'` for this exact recovery surface.
            continue;
          }
        }

        // 7. per-event payload schema (BEFORE chain advance per rd-3 F-002)
        const payloadResult = decodePayloadEither(envelope.payload);
        if (payloadResult._tag === "Left") {
          await reportFailure("payload-schema-invalid", {
            subject: msg.subject,
            rawBytes: msg.data,
            envelope,
            error: payloadResult.left,
          });
          continue;
        }

        // 8. advance the chain tip — only after EVERY check has passed
        // (rd-3 F-002 BB#227). The chain tracks accepted envelopes, so
        // semantic invariants like payload-schema-validity ARE part of
        // "accepted". A future application-side acceptance signal could
        // defer this further (e.g. only advance after handler returns),
        // but Sprint 1 keeps the boundary at "library-accepted" — the
        // application-level "processed" boundary is the consumer's
        // responsibility (and trivially encodeable in the handler).
        if (opts.chainStore) {
          const publisherKey = `${envelope.emitted_by}:${envelope.signing_key_id}`;
          const envelopeHash = sha256Hex(jcsCanonicalize(envelope));
          await opts.chainStore.set(publisherKey, envelopeHash);
        }

        // 9. hand off to the application handler. Application errors are
        // routed via `handler-error` (F-002 BB#227) so consumers branching
        // on failure reason can distinguish a buggy handler from a bad
        // envelope.
        try {
          await opts.handler({ payload: payloadResult.right, envelope, subject: msg.subject });
        } catch (error) {
          await reportFailure("handler-error", {
            subject: msg.subject,
            rawBytes: msg.data,
            envelope,
            error,
          });
        }
      } catch (error) {
        // any uncaught error in the verify-and-route loop body itself — keep
        // the subscription alive (F-002 BB#227: distinct from handler-error,
        // which is application-layer; internal-error is a library bug).
        await reportFailure("internal-error", {
          subject: msg.subject,
          rawBytes: msg.data,
          envelope,
          error,
        });
      }
    }
  };

  const done = consume();

  return {
    done,
    async unsubscribe(): Promise<void> {
      if (sub.drain) {
        await sub.drain();
      } else if (sub.unsubscribe) {
        sub.unsubscribe();
      }
      await done.catch(() => undefined);
    },
  };
}
