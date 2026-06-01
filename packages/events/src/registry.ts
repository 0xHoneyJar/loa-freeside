import { Schema as S } from "@effect/schema";
import { NftMintDetectedSchema } from "./schemas/nft-mint-detected.js";
import { nftMintDetectedTopic } from "./topics.js";

/**
 * The `event_type -> payload-schema` registry — the keystone of the
 * schema-emission floor (cycle-112).
 *
 * Today the cluster has no central map from an event family to its payload
 * schema: `topics.ts` builds subject strings, `schemas/` holds per-event
 * schemas, `publishEnvelope` takes no schema, and the subscriber takes the
 * schema as a per-call option. This module is the missing center: it lets
 * `emit()` (and any subscriber) resolve the payload schema for an event family
 * from one place, so a publisher can validate its payload at emit time — before
 * it signs and before it advances the hash chain.
 *
 * Design (PRD/SDD FR-1, FR-2):
 *  - A `SchemaId<P>` is a stable, branded event-family identifier that ALSO
 *    carries its payload type as a phantom. This is what lets `emit(id, payload)`
 *    reject a wrong-typed payload at COMPILE time (Flatline SDD SKP-005/IMP-001),
 *    not merely as a runtime failure.
 *  - The id is decoupled from the concrete NATS subject (which carries a runtime
 *    specifier, e.g. a collection slug). The id is static (the registry key); the
 *    subject is built per-call via `buildSubject` (OQ-5 resolution).
 *  - The registry is a central STATIC declaration: all bindings are resolvable
 *    at build time from this one module. Cells reference entries; they never
 *    mutate the registry at import time (which could not be statically
 *    collision-checked).
 */

declare const PayloadBrand: unique symbol;

/**
 * A stable event-family identifier carrying its payload type as a phantom `P`.
 * `P` never exists at runtime — the value is just the family string (e.g.
 * `"nft.mint.detected.v1"`).
 */
export type SchemaId<P = unknown> = string & {
  readonly __brand: "SchemaId";
  readonly [PayloadBrand]: P;
};

/**
 * Construct a typed `SchemaId`. The schema's inferred Type pins `P` at the call
 * site, so downstream `emit(id, payload)` is compile-checked against it.
 */
export const schemaId = <P>(family: string, _schema: S.Schema<P>): SchemaId<P> =>
  family as unknown as SchemaId<P>;

/** Extract the payload type a `SchemaId` governs — used to constrain `emit()`. */
export type PayloadOf<K> = K extends SchemaId<infer P> ? P : never;

export interface RegistryEntry<P> {
  /** The event family this entry governs, e.g. `"nft.mint.detected.v1"`. */
  readonly id: SchemaId<P>;
  /**
   * Effect.Schema for the payload — the soundness contract.
   *
   * MUST be validation-only (no `S.transform` / coercion) UNLESS `transform` is
   * set (see below). `emit()` validates with `S.validateEither` and signs the
   * ORIGINAL submitted payload, so for a validation-only schema the signed bytes
   * are exactly what the caller passed (after JCS canonicalization, which both
   * sender and receiver apply identically). Flatline SDD SKP-004.
   */
  readonly schema: S.Schema<P>;
  /**
   * Opt-in marker: this schema intentionally transforms (coerces) its input, so
   * the wire payload is the POST-transform value. Default `false`. When `true`
   * the entry MUST appear in {@link REVIEWED_TRANSFORMS} (the collision test
   * enforces this) so a lossy transform is a reviewed decision, not a silent
   * signed-bytes divergence.
   */
  readonly transform?: boolean;
  /**
   * Build the concrete NATS subject from the (optional) runtime specifier.
   * Wraps the existing `buildTopic`/topic helpers so subject construction stays
   * in one place and the version suffix stays canonical.
   */
  readonly buildSubject: (specifier?: string) => string;
}

// --- the entries -------------------------------------------------------------

/** SchemaId for the one pre-existing payload schema, now registered. Named
 *  `...Id` to avoid colliding with the `NftMintDetected` payload *type* that
 *  `schemas/nft-mint-detected.ts` already exports. */
export const NftMintDetectedId: SchemaId<S.Schema.Type<typeof NftMintDetectedSchema>> = schemaId(
  "nft.mint.detected.v1",
  NftMintDetectedSchema,
);

// Each id is constructed WITH its schema (via `schemaId`), so `SchemaId<P>`'s
// phantom `P` is pinned to the schema's inferred Type. New entries are appended
// here (and exported), typically via `freeside events:new-schema` (cycle-112 S3).
const ENTRIES = [
  {
    id: NftMintDetectedId,
    schema: NftMintDetectedSchema,
    buildSubject: (specifier?: string) => nftMintDetectedTopic({ collectionSlug: specifier }),
  },
  // pilot + migrated entries appended here (cycle-112 S3/S4)
] as const satisfies ReadonlyArray<RegistryEntry<any>>;

/**
 * The set of family ids whose entry sets `transform: true`. Adding a
 * transforming schema requires adding its id here — the collision test fails
 * otherwise, forcing the lossy-transform decision to be explicit (SKP-004).
 */
export const REVIEWED_TRANSFORMS: ReadonlyArray<string> = [];

/** Frozen lookup map; resolution is O(1). Keyed by the family string. */
const REGISTRY: ReadonlyMap<string, RegistryEntry<any>> = new Map(
  ENTRIES.map((e) => [e.id as string, e] as const),
);

/** The registered entries (read-only view) — used by the collision/round-trip tests. */
export const REGISTRY_ENTRIES: ReadonlyArray<RegistryEntry<any>> = ENTRIES;

/**
 * NON-throwing lookup. `emit()` turns a miss into an `Either.Left`, never a
 * throw — a typo in a SchemaId string at a call site must not escape the Either
 * boundary (Flatline SDD SKP-001, FR-3a).
 */
export function lookupSchema<P>(id: SchemaId<P>): RegistryEntry<P> | undefined {
  return REGISTRY.get(id as string) as RegistryEntry<P> | undefined;
}
