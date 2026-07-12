import { Schema as S } from "@effect/schema";
import { EventEnvelopeSchema, GENESIS_PREV_HASH, envelopeSigningBytes, } from "./envelope.js";
import { jcsCanonicalize, sha256Hex } from "./jcs.js";
// --- prebuilt decoders -------------------------------------------------------
// `onExcessProperty: "error"` — extra fields in the envelope are REJECTED
// (mirrors zod's `.strict()`). Critical because the envelope is hashed:
// an extra field would change the canonical form and silently break
// chain continuity.
const decodeEnvelopeEither = (input) => S.decodeUnknownEither(EventEnvelopeSchema)(input, { onExcessProperty: "error" });
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
export async function subscribeEnvelope(opts) {
    const sub = opts.nats.subscribe(opts.subject, opts.natsSubscribeOpts);
    const initialPolicy = opts.initialPrevHashPolicy ?? "any";
    const decodePayloadEither = S.decodeUnknownEither(opts.schema);
    const reportFailure = async (reason, detail) => {
        if (!opts.onVerificationFailure)
            return;
        try {
            await opts.onVerificationFailure(reason, detail);
        }
        catch {
            // failure-callback failures are themselves silent — subscriber must stay alive
        }
    };
    const consume = async () => {
        for await (const msg of sub) {
            let envelope;
            try {
                // 1. parse JSON
                let parsed;
                try {
                    parsed = JSON.parse(new TextDecoder().decode(msg.data));
                }
                catch (error) {
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
                    }
                    else if (expectedPrev !== envelope.prev_hash) {
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
                }
                catch (error) {
                    await reportFailure("handler-error", {
                        subject: msg.subject,
                        rawBytes: msg.data,
                        envelope,
                        error,
                    });
                }
            }
            catch (error) {
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
        async unsubscribe() {
            if (sub.drain) {
                await sub.drain();
            }
            else if (sub.unsubscribe) {
                sub.unsubscribe();
            }
            await done.catch(() => undefined);
        },
    };
}
//# sourceMappingURL=subscriber.js.map