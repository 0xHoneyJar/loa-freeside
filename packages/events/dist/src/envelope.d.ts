import { Schema as S } from "@effect/schema";
/**
 * Envelope wire-format version. Schema-evolution discipline:
 *
 *   - acvp-l1-v1 — INITIAL (PR #227, cycle-events-pillar-v1 Sprint 1).
 *                  signed: UTF-8(prev_hash || payload_hash). KNOWN GAP — routing
 *                  metadata (event_type, emitted_by, etc.) was NOT covered by the
 *                  signature (BB#227 EVT-001). NEVER deployed to production —
 *                  superseded by v2 in the same PR before merge.
 *
 *   - acvp-l1-v2 — CURRENT. signed: sha256(JCS canonical of the envelope
 *                  with `signature: ""` set). Covers ALL semantically
 *                  load-bearing fields (event_id, event_type, schema_version,
 *                  emitted_by, emitted_at, prev_hash, payload_hash,
 *                  signing_key_id, payload). Closes EVT-001's routing-metadata
 *                  forgery vector.
 *
 * Schema bumps for future fields use a NEW versioned subject + ≥30d v1/v2
 * coexistence window (see build doc); subscribers may consume both via
 * separate `subscribeEnvelope` calls.
 */
export declare const SCHEMA_VERSION: "acvp-l1-v2";
/**
 * Canonical event envelope. Effect.Schema enforces presence + type +
 * primitive-shape refinements; semantic constraints (sig verification,
 * chain continuity, per-event payload conformance) are the
 * publisher/subscriber's responsibility.
 *
 * `S.Struct({...})` rejects undeclared fields by default — the cluster-098
 * `.strict()` equivalent. Adding a field without a schema bump is a
 * substrate violation and will fail decode at both the publisher's
 * defense-in-depth gate and the subscriber's verify step.
 */
export declare const EventEnvelopeSchema: S.Struct<{
    event_id: S.filter<S.Schema<string, string, never>>;
    event_type: S.filter<S.Schema<string, string, never>>;
    schema_version: S.Literal<["acvp-l1-v2"]>;
    emitted_by: S.filter<S.Schema<string, string, never>>;
    emitted_at: S.filter<S.Schema<string, string, never>>;
    prev_hash: S.filter<S.Schema<string, string, never>>;
    payload_hash: S.filter<S.Schema<string, string, never>>;
    signing_key_id: S.filter<S.Schema<string, string, never>>;
    signature: S.filter<S.Schema<string, string, never>>;
    payload: typeof S.Unknown;
}>;
export type EventEnvelope = S.Schema.Type<typeof EventEnvelopeSchema>;
export type EventEnvelopePayload = unknown;
/**
 * Sentinel prev_hash for the first envelope in a per-publisher chain.
 * Hex-encoded 32 zero bytes — cycle-098 L1 convention.
 */
export declare const GENESIS_PREV_HASH: string;
/**
 * Compute the bytes that get signed for an envelope.
 *
 * **acvp-l1-v2 (current)**: returns the UTF-8 bytes of the SHA-256 hex of
 * the JCS-canonical form of the envelope with the `signature` field set to
 * the empty string. This binds EVERY non-signature field of the envelope
 * to the signature — event_type, emitted_by, schema_version, event_id,
 * emitted_at, prev_hash, payload_hash, signing_key_id, AND payload — so
 * an attacker who tampers any of them invalidates the signature.
 *
 * The empty-string convention (vs. omitting the `signature` key) keeps the
 * JCS canonical form structurally identical to the eventual published
 * envelope, which simplifies the verifier: it just substitutes `""` for
 * the actual signature before recomputing.
 *
 * Closes BB#227 EVT-001 (routing-metadata forgery — superseded the
 * acvp-l1-v1 `(prev_hash || payload_hash)` concatenation which left
 * `event_type`/`emitted_by`/etc. unsigned).
 */
export declare function envelopeSigningBytes(envelopeWithoutSignature: Omit<EventEnvelope, "signature">): Uint8Array;
//# sourceMappingURL=envelope.d.ts.map