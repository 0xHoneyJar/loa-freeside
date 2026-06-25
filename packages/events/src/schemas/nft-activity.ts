import { Schema as S } from "@effect/schema";

/**
 * Payload schema for `nft.activity.recorded.*.v1` events — the CHAIN-AGNOSTIC
 * NFT ownership-activity family.
 *
 * Where `nft.mint.detected.*` is EVM-specific (0x addresses, chain_id, token_id),
 * this family is the canonical verb stream BOTH EVM and SVM producers normalize
 * into, so a consumer (the Score API) reads ONE shape and never branches on chain.
 * Producer-side normalization lives in `sonar-api/src/canonical`; this is the
 * shared contract it emits.
 *
 * Design (cycle canonical-event-normalization, FAGAN-hardened ×2):
 *  - `verb` carries the activity (mint/transfer/sale/burn) IN the payload, so the
 *    subject family stays single (`nft.activity.recorded.<slug>.v1`).
 *  - Addresses are OPAQUE strings (0x-hex for EVM, base58 for SVM) — equality/dedup
 *    is chain-agnostic; a consumer that must PARSE an id reads the typed `metadata`.
 *  - `value` is a DECIMAL STRING of the raw smallest-unit integer (wei / lamports),
 *    NOT a float — uint256 wei exceeds 2^53 and the SVM price column is bigint.
 *    `decimals` lets the consumer compute the human amount exactly, and is REQUIRED
 *    whenever `value` is set (cross-field filter below).
 *  - `metadata` is a TYPED discriminated union (`EvmMetadata | SvmMetadata` on `chain`).
 *    The top-level `chain` MUST equal `metadata.chain` (cross-field filter) so the two
 *    can never diverge.
 *  - `collection_key` charset matches the topic SEGMENT grammar (`/^[a-z][a-z0-9-]*$/`)
 *    so a validating key is ALWAYS a sendable subject specifier (no validate-but-fail-at-emit
 *    skew — the assumed-schema class the cluster has antibodies for).
 *
 * NOTE: `tx` / `asset_ref` are opaque by design — the schema does NOT enforce an
 * EVM tx-hash shape (a producer may validate independently via {@link EVM_TX_HASH_RX},
 * which is a helper, NOT applied here). SVM signatures/mints aren't 0x-hex.
 *
 * Effect.Schema per cluster memory `freeside-effect-transition` (cross-cell wire =
 * protocol layer). Validation-only (no transform): `emit()` signs the original payload
 * (registry SKP-004). Non-additive change → publish under `*.v2` with a ≥30d overlap.
 */

const OneOrMoreDigits = /^\d+$/;
const Iso8601Utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const EvmAddress = /^0x[0-9a-f]{40}$/;
const EvmTxHash = /^0x[0-9a-f]{64}$/;
const CollectionKey = /^[a-z][a-z0-9-]*$/; // matches topics.ts SEGMENT_RX → a valid key is a valid subject specifier

/** EVM-specific enrichment (typed) — present when `chain === "evm"`. */
export const EvmActivityMetadataSchema = S.Struct({
  chain: S.Literal("evm"),
  chain_id: S.Number.pipe(S.int(), S.positive()),
  contract: S.String.pipe(S.pattern(EvmAddress, { message: () => "evm contract: lowercase 0x + 40 hex" })),
  token_id: S.String.pipe(S.pattern(OneOrMoreDigits, { message: () => "token_id: non-negative decimal string" })),
  log_index: S.Number.pipe(S.int(), S.nonNegative()),
  block_number: S.Number.pipe(S.int(), S.nonNegative()),
});

/** SVM-specific enrichment (typed) — present when `chain === "svm"`. */
export const SvmActivityMetadataSchema = S.Struct({
  chain: S.Literal("svm"),
  collection_mint: S.String,
  nft_mint: S.String,
  instruction_index: S.Number.pipe(S.int(), S.nonNegative()),
  slot: S.Number.pipe(S.int(), S.nonNegative()),
  marketplace: S.optional(S.String),
  delegate: S.optional(S.NullOr(S.String)),
});

export const NftActivitySchema = S.Struct({
  /** The activity (in the payload so the subject family stays single). */
  verb: S.Literal("mint", "transfer", "sale", "burn"),

  /** Opaque chain discriminator — MUST equal metadata.chain (filter below). */
  chain: S.Literal("evm", "svm"),

  /** Generic collection key — same charset as a topic segment (sendable as a specifier). */
  collection_key: S.String.pipe(S.pattern(CollectionKey, { message: () => "collection_key must match /^[a-z][a-z0-9-]*$/ (topic-segment grammar)" })),

  /** The NFT identity — tokenId (EVM) or nft_mint (SVM). Opaque for equality/dedup. */
  asset_ref: S.String.pipe(S.minLength(1)),

  /** Owner-level sender — null for `mint`; resolved seller for `sale`. */
  from: S.NullOr(S.String.pipe(S.minLength(1))),

  /** Owner-level recipient — null for `burn`; resolved buyer for `sale`. */
  to: S.NullOr(S.String.pipe(S.minLength(1))),

  /** Raw smallest-unit value as a DECIMAL STRING (wei | lamports) — null when n/a. No float precision loss. */
  value: S.NullOr(S.String.pipe(S.pattern(OneOrMoreDigits, { message: () => "value: non-negative decimal string of smallest units" }))),

  /** Decimals for `value` (18 EVM wei, 9 SOL lamports) — required when `value` is set (filter below). */
  decimals: S.NullOr(S.Number.pipe(S.int(), S.nonNegative())),

  /** The transaction — txHash (EVM, 0x) or signature (SVM, base58). Opaque (see NOTE). */
  tx: S.String.pipe(S.minLength(1)),

  /** On-chain block time as ISO-8601 UTC (envelope-consistent). */
  timestamp: S.String.pipe(S.pattern(Iso8601Utc, { message: () => "ISO-8601 UTC with trailing Z" })),

  /** Typed chain-specific richness (discriminated on `chain`). */
  metadata: S.Union(EvmActivityMetadataSchema, SvmActivityMetadataSchema),
}).pipe(
  // top-level chain must match the typed metadata discriminant (no divergence).
  S.filter((a) => a.chain === a.metadata.chain, {
    message: () => "top-level `chain` must equal metadata.chain",
  }),
  // a value without decimals can't be turned into a human amount — require both or neither.
  S.filter((a) => a.value === null || a.decimals !== null, {
    message: () => "`decimals` is required when `value` is set",
  }),
);

export type NftActivity = S.Schema.Type<typeof NftActivitySchema>;
export type EvmActivityMetadata = S.Schema.Type<typeof EvmActivityMetadataSchema>;
export type SvmActivityMetadata = S.Schema.Type<typeof SvmActivityMetadataSchema>;

/** EVM tx-hash pattern — a producer-side helper. NOT applied by NftActivitySchema (tx is opaque). */
export const EVM_TX_HASH_RX = EvmTxHash;
