import { z } from "zod";
import { EventEnvelopeSchema, envelopeSigningBytes, type EventEnvelope } from "./envelope.js";
import { jcsCanonicalize, sha256Hex } from "./jcs.js";
import type { Verifier } from "./signer.js";
import type { PrevHashStore } from "./publisher.js";

export type VerificationFailureReason =
  | "envelope-schema-invalid"
  | "payload-schema-invalid"
  | "payload-hash-mismatch"
  | "signature-invalid"
  | "prev-hash-broken-chain"
  | "json-parse-error"
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
   * Zod schema the payload must conform to AFTER envelope verification.
   * The schema is validated against the parsed `payload` field of the envelope.
   */
  schema: z.ZodType<T>;
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

/**
 * Subscribe to a NATS subject, verifying every envelope before invoking the
 * handler. Verification covers: envelope schema, signature, payload-hash
 * recompute, per-event Zod schema, and (when `chainStore` is provided)
 * per-publisher prev_hash continuity.
 *
 * The handler is awaited per-message in order; long-running handlers should
 * either return quickly or use queue groups (`natsSubscribeOpts.queue`) for
 * fan-out parallelism.
 *
 * Returns a {@link SubscribeHandle} for explicit teardown.
 */
export async function subscribeEnvelope<T>(opts: SubscribeOptions<T>): Promise<SubscribeHandle> {
  const sub = opts.nats.subscribe(opts.subject, opts.natsSubscribeOpts);

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
        const envelopeResult = EventEnvelopeSchema.safeParse(parsed);
        if (!envelopeResult.success) {
          await reportFailure("envelope-schema-invalid", {
            subject: msg.subject,
            rawBytes: msg.data,
            error: envelopeResult.error,
          });
          continue;
        }
        envelope = envelopeResult.data;

        // 3. recompute payload hash and check against envelope's claim
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

        // 4. verify signature
        const sigBytes = envelopeSigningBytes(envelope.prev_hash, envelope.payload_hash);
        const sigOk = await opts.verifier.verify(envelope.signing_key_id, sigBytes, envelope.signature);
        if (!sigOk) {
          await reportFailure("signature-invalid", { subject: msg.subject, rawBytes: msg.data, envelope });
          continue;
        }

        // 5. (optional) per-publisher chain continuity
        if (opts.chainStore) {
          const publisherKey = `${envelope.emitted_by}:${envelope.signing_key_id}`;
          const expectedPrev = await opts.chainStore.get(publisherKey);
          if (expectedPrev !== null && expectedPrev !== envelope.prev_hash) {
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
          // Advance our local view of the publisher's chain.
          const envelopeHash = sha256Hex(jcsCanonicalize(envelope));
          await opts.chainStore.set(publisherKey, envelopeHash);
        }

        // 6. per-event payload schema
        const payloadResult = opts.schema.safeParse(envelope.payload);
        if (!payloadResult.success) {
          await reportFailure("payload-schema-invalid", {
            subject: msg.subject,
            rawBytes: msg.data,
            envelope,
            error: payloadResult.error,
          });
          continue;
        }

        // 7. hand off to the application handler. Application errors are
        // routed via `handler-error` (F-002 BB#227) so consumers branching
        // on failure reason can distinguish a buggy handler from a bad
        // envelope.
        try {
          await opts.handler({ payload: payloadResult.data, envelope, subject: msg.subject });
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
