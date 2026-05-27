import { Schema as S } from "@effect/schema";
import { jcsCanonicalize, sha256Hex } from "./jcs.js";
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
export const SCHEMA_VERSION = "acvp-l1-v2";
// --- shape refinements -------------------------------------------------------
const Hex64Schema = S.String.pipe(S.pattern(/^[0-9a-f]{64}$/, { message: () => "must be 64 lowercase hex chars (sha256)" }));
const Base64UrlSchema = S.String.pipe(S.pattern(/^[A-Za-z0-9_-]+$/, { message: () => "must be base64url-encoded (no padding)" }));
const Iso8601UtcSchema = S.String.pipe(S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/, {
    message: () => "must be ISO-8601 UTC with trailing Z (e.g. 2026-05-26T21:30:00.123Z)",
}));
const Topic3SegmentSchema = S.String.pipe(S.pattern(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}\.v[1-9]\d*$/, {
    message: () => "must be Hounfour {aggregate}.{noun}.{verb}[.{specifier}].v{N>=1} (lowercase, dot-separated)",
}));
const CellSlugSchema = S.String.pipe(S.pattern(/^[a-z][a-z0-9-]*$/, {
    message: () => "must be lowercase kebab-case cell slug (e.g. sonar-api)",
}));
const SigningKeyIdSchema = S.String.pipe(S.pattern(/^[A-Za-z0-9_.:-]{1,128}$/, {
    message: () => "must be a stable opaque kid (alphanumeric + _.:- )",
}));
const EventIdSchema = S.String.pipe(S.pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, {
    message: () => "must be a UUID",
}));
// --- envelope schema ---------------------------------------------------------
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
export const EventEnvelopeSchema = S.Struct({
    event_id: EventIdSchema,
    event_type: Topic3SegmentSchema,
    schema_version: S.Literal(SCHEMA_VERSION),
    emitted_by: CellSlugSchema,
    emitted_at: Iso8601UtcSchema,
    prev_hash: Hex64Schema,
    payload_hash: Hex64Schema,
    signing_key_id: SigningKeyIdSchema,
    signature: Base64UrlSchema,
    payload: S.Unknown,
});
/**
 * Sentinel prev_hash for the first envelope in a per-publisher chain.
 * Hex-encoded 32 zero bytes — cycle-098 L1 convention.
 */
export const GENESIS_PREV_HASH = "0".repeat(64);
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
export function envelopeSigningBytes(envelopeWithoutSignature) {
    // construct the "to-be-signed" envelope shape: signature is the empty
    // string placeholder so both sides hash structurally-identical objects
    const tbs = {
        ...envelopeWithoutSignature,
        signature: "",
    };
    const canonical = jcsCanonicalize(tbs);
    const digestHex = sha256Hex(canonical);
    return new TextEncoder().encode(digestHex);
}
//# sourceMappingURL=envelope.js.map