import { z } from "zod";

export const SCHEMA_VERSION = "acvp-l1-v1" as const;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex chars (sha256)");
const Base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/, "must be base64url-encoded (no padding)");

const Iso8601Utc = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/,
    "must be ISO-8601 UTC with trailing Z (e.g. 2026-05-26T21:30:00.123Z)",
  );

const Topic3Segment = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}\.v[1-9]\d*$/,
    "must be Hounfour {aggregate}.{noun}.{verb}[.{specifier}].v{N>=1} (lowercase, dot-separated)",
  );

const CellSlug = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "must be lowercase kebab-case cell slug (e.g. sonar-api)");

const SigningKeyIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/, "must be a stable opaque kid (alphanumeric + _.:- )");

export const EventEnvelopeSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: Topic3Segment,
    schema_version: z.literal(SCHEMA_VERSION),
    emitted_by: CellSlug,
    emitted_at: Iso8601Utc,

    prev_hash: Hex64,
    payload_hash: Hex64,
    signing_key_id: SigningKeyIdSchema,
    signature: Base64Url,

    payload: z.unknown(),
  })
  .strict();

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type EventEnvelopePayload = unknown;

/**
 * Sentinel prev_hash for the first envelope in a per-publisher chain.
 * Hex-encoded 32 zero bytes — cycle-098 L1 convention.
 */
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * Compute the bytes that get signed.
 *
 * Spec: UTF-8 bytes of the concatenation `${prev_hash}${payload_hash}` (no separator).
 * Both sides are 64-char lowercase hex; concat is 128 chars (128 bytes UTF-8).
 *
 * Deterministic + simple — sender and receiver agree on what was signed without ambiguity.
 */
export function envelopeSigningBytes(prevHash: string, payloadHash: string): Uint8Array {
  return new TextEncoder().encode(`${prevHash}${payloadHash}`);
}
