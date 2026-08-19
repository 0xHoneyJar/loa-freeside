---
title: "SDD — Schema-Emission Coherence Floor"
cycle: cycle-112-schema-emission-floor
status: candidate
date: 2026-05-31
mode: ARCH (plan-here / build-here, v1)
domain: shared
prd: grimoires/loa/cycles/cycle-112-schema-emission-floor/prd.md
crystallization: grimoires/loa/context/2026-05-31-schema-emission-floor-crystallization.md
plannable: true
provenance: /simstim Phase 3 (ARCHITECTURE), grounded in verbatim signatures (packages/events, packages/adapters/coexistence, packages/beacon-schema), 2026-05-31
---

# SDD — Schema-Emission Coherence Floor (cycle-112)

> **Software Design Document.** Realizes the PRD's soundness floor (G-1..G-3) +
> its proof (G-4..G-6) + its on-ramp (G-7, FR-ADOPT-1..8). Completeness/outbox and
> cross-repo (sonar) are **out of scope** — cycle-2 (PRD §10). Every signature
> below is copied from the live tree; line refs are load-bearing.

---

## 1. Design at a glance

The floor is **one new emit path that physically cannot emit a payload that
violates its declared schema, and is shorter to call than the raw path it
replaces.** Five net-new artifacts + one reused pipeline:

```
                         ┌─────────────────────── @0xhoneyjar/events (the package) ──────────────────────┐
 cell code                │                                                                                │
 (parallel-mode-          │   makeEmitter({cell})  ──returns──▶  emit(SchemaId, payload[, specifier])      │
  orchestrator.ts)        │        │ closes over                       │                                    │
     │                    │        │ nats · signer · prevHashStore       │ 1. registry.resolve(SchemaId)     │
     │  emit(             │        │ emittedBy · publisherKey            │ 2. S.decode(schema)(payload) ──┐  │
     │    ParallelMode    │        ▼                                    │    typed failure on mismatch  │  │
     │      Enabled,      │   ┌─ REGISTRY (FR-1) ──────────────┐         │    (FR-3/3a) ◀────────────────┘  │
     │    {…})            │   │ SchemaId → { schema, build() } │ ◀───────┘ 3. buildTopic(specifier)        │
     │                    │   │ central static · collision=err │         │ 4. publishEnvelope(validated) ──┐ │
     └────────────────────┼──▶└────────────────────────────────┘         │    (REUSE, publisher.ts:129)   │ │
                          │                                              │ 5. return receipt (FR-ADOPT-7) │ │
                          │   NatsTransport (FR-7, nominal/branded) ◀────┼────────── only the package ────┘ │
                          │        raw .publish uncallable outside       │           can call .publish       │
                          └──────────────────────────────────────────────┴──────────────────────────────────┘
                                  ▲                                                    │
   CI lint (FR-8/9/9a) ───────────┘  fails on new raw NATS .publish;          NATS ───▶  test-harness consumer
   events-lint bin (FR-ADOPT-5)      allowlist shrink-only (count-delta)                  verifies sig+schema+chain
   teaching errors (FR-ADOPT-6)                                                           (FR-12)
```

**Reuse (do NOT rebuild):** `publishEnvelope` (publisher.ts:129 — the entire
`acvp-l1-v2` JCS→hash→chain→Ed25519 pipeline) and `validateAcvpBindings`
(acvp-bindings.ts, PR #258).

**Net-new:** (A) registry, (B) emit facade + `makeEmitter` factory, (C)
type-boundary (closure-held transport), (D) lint + set-subset gate + `events-lint`
bin, (E) codemod + scaffold generator. Plus (F) pilot migration, (G) the first
in-repo beacon (`freeside-events`), (H) version-coupling assertion.

### 1.1 Plane mapping (ADR-008)

| Plane | This cycle's surface |
|-------|----------------------|
| **Contract** | the registry (`SchemaId → schema`), the `acvp-l1-v2` envelope, the SchemaId type, the beacon `acvp_invariants` declaration |
| **Construct** | `emit()` / `makeEmitter` pure logic: resolve → validate → build subject → (delegate). No I/O of its own beyond the injected transport |
| **Execution** | `NatsTransport` (closure-held capability), the CI lint + set-subset gate, the codemod, the `events-lint` bin, the test-harness consumer |

---

## 2. The registry (FR-1, FR-2, OQ-1) — the keystone

### 2.1 The `SchemaId` type and entry shape

Today there is **no** `event_type → schema` map: `topics.ts` is a string builder
(`buildTopic`, topics.ts:30), `schemas/` holds one schema (`NftMintDetectedSchema`,
nft-mint-detected.ts:21), `publishEnvelope` takes **no** schema (PublishOptions,
publisher.ts:57-75), and the only subscriber passes `schema: S.Unknown`
(events-trace.ts:351). The registry is the missing center.

```ts
// packages/events/src/registry.ts  (NEW)
import { Schema as S } from "@effect/schema";

/** A stable event-family identifier that ALSO carries its payload type as a
 *  phantom (Flatline SKP-005/IMP-001). Decoupled from the concrete NATS subject
 *  (which carries a runtime specifier) — the resolution to OQ-5: the *id* is
 *  static (registry key), the *subject* is built per-call. The phantom `P` is
 *  what lets emit() reject a wrong-typed payload at COMPILE time, not just as a
 *  runtime Left. */
export type SchemaId<P = unknown> = string & {
  readonly __brand: "SchemaId";
  readonly __payload: P;        // phantom — never present at runtime
};
/** Construct a typed id. The schema's inferred Type pins P at the call site. */
export const schemaId = <P>(s: string, _schema: S.Schema<P>): SchemaId<P> => s as SchemaId<P>;

export interface RegistryEntry<P> {
  /** The event family this entry governs, e.g. "nft.mint.detected.v1". */
  readonly id: SchemaId<P>;
  /** Effect.Schema for the payload — the soundness contract.
   *  MUST be validation-only (no S.transform / coercion) — see SKP-004 below. */
  readonly schema: S.Schema<P>;
  /** Opt-in marker: this schema intentionally transforms (coerces) its input.
   *  Default false. When true, the wire payload is the POST-transform value and
   *  the collision test flags it for explicit review (SKP-004). */
  readonly transform?: boolean;
  /** Build the concrete NATS subject from the (optional) runtime specifier.
   *  Wraps the existing buildTopic (topics.ts:30) so subject construction stays
   *  in one place and the version suffix stays canonical. */
  readonly buildSubject: (specifier?: string) => string;
}

/** Extract the payload type a SchemaId governs — used to constrain emit(). */
export type PayloadOf<K> = K extends SchemaId<infer P> ? P : never;
```

> **SKP-004 (signed-bytes integrity).** Registry schemas are **validation-only by
> default**: `emit()` uses `S.validateEither` (no coercion/trim/date-parse), and
> signs the **original** submitted payload — so the signed bytes are exactly what
> the caller passed (after JCS canonicalization, which both sender and receiver
> apply identically). A schema that genuinely needs wire-coercion sets
> `transform: true`, accepting that the signed form is post-transform; the
> collision test (§2.2) asserts every `transform: true` entry is explicitly
> reviewed. A round-trip test asserts `JCS(payload) === JCS(validate(payload))`
> for every non-transform entry.

### 2.2 Central static assembly + build-time collision (FR-1, FR-2)

OQ-1 decision: **hand-assembled central `Record`, collision enforced by a
build-time unit test** (not codegen) for v1. Rationale: v1 has 2 entries (the
existing `nft.mint.detected.v1` + the pilot); a codegen build step is unjustified
complexity now, and the `events:new-schema` generator (FR-ADOPT-3) appends to this
one file deterministically. The codegen path is the documented scale-up once the
entry count crosses ~dozens (NG-7 territory).

```ts
// packages/events/src/registry.ts (cont.)
import { NftMintDetectedSchema } from "./schemas/nft-mint-detected.js";
import { nftMintDetectedTopic } from "./topics.js";

// Each id is constructed WITH its schema, so SchemaId<P>'s phantom P is pinned
// to the schema's inferred Type — emit(id, payload) is then compile-checked.
export const NftMintDetected = schemaId("nft.mint.detected.v1", NftMintDetectedSchema);

const ENTRIES = [
  {
    id: NftMintDetected,
    schema: NftMintDetectedSchema,
    buildSubject: (specifier?: string) =>
      nftMintDetectedTopic({ collectionSlug: specifier }),
  },
  // pilot entry appended here (§7)
] as const satisfies ReadonlyArray<RegistryEntry<any>>;

/** Frozen map; lookup is O(1). */
const REGISTRY: ReadonlyMap<string, RegistryEntry<any>> = new Map(
  ENTRIES.map((e) => [e.id, e]),
);

/** NON-throwing lookup — emit() turns a miss into an Either.Left, never a throw
 *  (SKP-001: a throw must not escape an Either-returning function). */
export function lookupSchema<P>(id: SchemaId<P>): RegistryEntry<P> | undefined {
  return REGISTRY.get(id) as RegistryEntry<P> | undefined;
}
```

**FR-2 (collision = build-time error):** a TS object literal silently allows
duplicate keys (last-wins), so the guarantee is a **CI/build unit test** that runs
in the package's `build` script gate — it also surfaces every `transform: true`
entry for explicit review (SKP-004):

```ts
// packages/events/src/registry.collision.test.ts (NEW — runs in CI build gate)
test("no two registry entries share a SchemaId", () => {
  const ids = ENTRIES.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length); // duplicate id → build FAILS
});
test("every transform:true entry is on the reviewed-transforms list", () => {
  const transforming = ENTRIES.filter((e) => e.transform).map((e) => e.id);
  expect(transforming).toEqual(REVIEWED_TRANSFORMS); // adding one un-reviewed → FAILS
});
test("non-transform schemas round-trip under JCS (signed bytes == submitted)", () => {
  for (const e of ENTRIES.filter((x) => !x.transform)) {
    const sample = sampleFor(e.id);
    expect(jcsCanonicalize(S.validateSync(e.schema)(sample))).toBe(jcsCanonicalize(sample));
  }
});
```

This satisfies FR-2's "build-time error *within the repo*" honestly: it is a
single-repo guarantee (PRD §10/C2-3 carries the cross-repo version). The
collision test is wired into the events package CI so a duplicate cannot merge.

---

## 3. The emit facade + `makeEmitter` factory (FR-3, FR-3a, FR-4, FR-5, FR-ADOPT-1, FR-ADOPT-7)

### 3.1 The ergonomics problem this solves (FR-ADOPT-1, NFR-Ergo-1)

`publishEnvelope` requires a 6-field opts bag every call (publisher.ts:57-75):
`{ nats, subject, payload, emittedBy, signer, prevHashStore }`. That is **more**
typing than the raw `this.nats.publish('parallel.mode.enabled', {...})` it would
replace — the exact reason the adoption council found the floor would be bypassed.
`makeEmitter` closes over everything that is constant for a cell, collapsing the
call site to `emit(SchemaId, payload)`.

```ts
// packages/events/src/emit.ts  (NEW)
import { Either } from "effect";
import { Schema as S } from "@effect/schema";
import { publishEnvelope, type PrevHashStore } from "./publisher.js";
import { lookupSchema, type SchemaId, type PayloadOf } from "./registry.js";
import { Mutex } from "./mutex.js";                 // small per-key async mutex
import type { Signer } from "./signer.js";
import { internalPublish, type NatsTransport } from "./transport.js"; // §4

export interface EmitterDeps {
  readonly cell: string;            // → emitted_by
  readonly transport: NatsTransport; // opaque token; cells cannot reach .publish
  readonly signer: Signer;
  readonly prevHashStore: PrevHashStore;
  readonly publisherKey?: string;
}

/** FR-3a typed failures — values the caller cannot ignore, never thrown. */
export class SchemaEmitError extends Error {
  readonly _tag = "SchemaEmitError";
  constructor(readonly schemaId: string, readonly parseError: unknown) {
    super(`[events] payload failed schema "${schemaId}" — refused to emit`);
  }
}
export class UnknownSchemaIdError extends Error {     // SKP-001 (no throw on typo)
  readonly _tag = "UnknownSchemaIdError";
  constructor(readonly schemaId: string) {
    super(`[events] unknown SchemaId "${schemaId}" — not in registry`);
  }
}
export type EmitError = SchemaEmitError | UnknownSchemaIdError;

export interface EmitReceipt {           // FR-ADOPT-7 (producer-visible receipt)
  readonly event_id: string;
  readonly envelopeHash: string;         // = next prev_hash
  readonly subject: string;
}

export function makeEmitter(deps: EmitterDeps) {
  // SKP-001 (race): serialize chain advances for THIS cell's chain. publishEnvelope
  // does get(prevHash)→…→set(newHash) non-atomically; two concurrent emits would
  // interleave and fork the chain. One mutex per publisherKey closes it.
  const chainLock = new Mutex();

  /** emit(id, payload[, specifier]) — compile-checked: payload MUST be PayloadOf<K>. */
  return async function emit<K extends SchemaId>(
    id: K,
    payload: PayloadOf<K>,            // SKP-005/IMP-001: wrong type → COMPILE error
    specifier?: string,
  ): Promise<Either.Either<EmitReceipt, EmitError>> {
    const entry = lookupSchema(id);
    if (!entry) return Either.left(new UnknownSchemaIdError(id)); // SKP-001: Left, not throw

    // FR-3 + SKP-004: VALIDATE only (no transform/coercion), and sign the ORIGINAL
    // payload — so signed bytes are exactly what the caller submitted. Validation
    // happens BEFORE sign + BEFORE chain-advance (closes publisher.ts:167 seam).
    const valid = S.validateEither(entry.schema)(payload);
    if (Either.isLeft(valid)) {
      return Either.left(new SchemaEmitError(id, valid.left)); // FR-3a
    }

    // FR-4: REUSE publishEnvelope verbatim. Serialized so the chain can't fork.
    return chainLock.withLock(async () => {
      try {
        const result = await publishEnvelope({
          nats: internalPublish(deps.transport), // §4: package-private capability
          subject: entry.buildSubject(specifier),
          payload,                               // SKP-004: ORIGINAL, not transformed
          emittedBy: deps.cell,
          signer: deps.signer,
          prevHashStore: deps.prevHashStore,
          publisherKey: deps.publisherKey,
        });
        return Either.right({
          event_id: result.envelope.event_id,
          envelopeHash: result.envelopeHash, // FR-ADOPT-7
          subject: result.subject,
        });
      } catch (cause) {
        // SKP-003/IMP-007: a publish/store failure is OBSERVABLE, never silent.
        // The caller gets a Left; the cell logs+meters it (see §3.4).
        return Either.left(new SchemaEmitError(id, cause));
      }
    });
  };
}
```

### 3.2 Design decisions

- **Validate-before-sign ordering (FR-3, NFR-Sec-1).** Validation happens at
  emit.ts (step 1) *before* `publishEnvelope` ever computes signing bytes
  (publisher.ts:153) or advances the chain (publisher.ts:167). There is no path
  where an unsigned-but-invalid payload reaches the bus: a `Left` returns early.
  EVT-001 (full-envelope signature binding, publisher.ts:139-156) is untouched.
- **F-003 chain-fork (FR-ADOPT-1, SKP-001 race).** The factory owns a single
  `prevHashStore` *and a single async mutex* per cell, so a cell's concurrent emits
  serialize the get→sign→publish→set sequence and cannot interleave-fork the chain.
  v1 does NOT close the crash-between-publish-and-store window (publisher.ts:105-127)
  — that is the completeness/outbox work (PRD §10/C2-0) — but v1 DOES (a) remove the
  in-process race and (b) make the residual gap **observable**, not silent (§3.4).
- **Typed failure, not throw (FR-3a, IMP-002 / SKP-001).** `Either<EmitReceipt,
  SchemaEmitError | UnknownSchemaIdError>` — the call site must branch, and **no
  code path throws** (an unknown SchemaId from a call-site typo returns a `Left`,
  not an exception that escapes the Either). Effect-native callers lift via
  `Effect.fromEither`; the events package is already Effect.Schema
  (`freeside-effect-transition`). A throwing variant is NOT offered.
- **Compile-time payload binding (SKP-005/IMP-001).** `emit<K extends SchemaId>(id:
  K, payload: PayloadOf<K>)` — because each `SchemaId<P>` carries its payload type
  as a phantom (§2.1), `emit(ParallelModeEnabled, wrongShape)` is a **compile
  error**, not a runtime `Left`. This is what makes "structurally cannot emit
  invalid" a *static* claim, not just a runtime one.
- **Validate-only, sign-original (SKP-004).** `S.validateEither` (no transform) +
  signing the submitted `payload` (not a decoded copy) guarantees the signed bytes
  equal the caller's input under JCS. Schemas needing coercion opt in via
  `transform: true` (§2.1), reviewed by the collision test.
- **OQ-5 (computed subjects) → `emit` specifier + `emitRaw` (§3.3).** Soundness is
  independent of subject-staticness. The 2 computed-subject emits keep a static
  `SchemaId` and pass the discriminator as `specifier`. The genuinely
  caller-constructed-subject case uses the fully-specified `emitRaw` (§3.3), which
  is *itself* lint-gated and allowlisted — not an unguarded hole.

### 3.3 `emitRaw` — the specified escape hatch (SKP-002, SKP-008, IMP-002)

The escape hatch sits at the highest bypass-risk point, so it is fully specified,
not hand-waved:

```ts
// packages/events/src/emit.ts (cont.)
/** Escape hatch for genuinely dynamic subjects (e.g. event-router targetSubject).
 *  SAME soundness as emit(): payload is validated against the SchemaId's schema.
 *  Differs only in that the caller supplies the subject — which MUST share the
 *  SchemaId's family prefix (the registry's buildSubject(undefined) up to the
 *  version segment), asserted before publish. */
return async function emitRaw<K extends SchemaId>(
  id: K, subject: string, payload: PayloadOf<K>,
): Promise<Either.Either<EmitReceipt, EmitError | SubjectFamilyError>> { /* … */ };
```

- **Family-prefix algorithm.** `family = buildSubject(undefined)` stripped of its
  trailing `.v{N}` → the `{aggregate}.{noun}.{verb}` stem. `subject` must
  `startsWith(stem)` AND end with a valid `.v{N}` segment; else `Left(SubjectFamilyError)`.
- **Lint treatment (SKP-002).** `emitRaw` call sites are flagged by the SAME
  `no-raw-nats-publish` rule unless they appear in a **separate `emitRaw-allowlist`**
  (own file, own shrink-only set-gate, §5.2). So `emitRaw` is *visible and bounded*,
  never an unbounded bypass.
- **v1 usage.** Only `event-router.ts` (×2) and `NatsClient.ts` (×1) — the genuinely
  computed-subject sites. The 8 others use plain `emit()`.

### 3.4 Observability of the residual completeness gap (SKP-003, IMP-007)

v1 defers completeness (NG-1) but must not hide the gap:

- **Every `Left` is logged + metered** at the cell (structured log
  `event_emit_failed{schema_id, cell, reason}` + a counter). An emit failure is
  never swallowed — `_ = emit(...)` is itself a lint warning (must consume the Either).
- **Chain-fork classification (SKP-003).** The subscriber's existing
  `prev-hash-broken-chain` reason (subscriber.ts) is split into two observable
  subtypes: **`store-miss`** (the sender's store lagged a real published envelope —
  recovered by a documented startup step: read the chain tip from NATS and resync
  the store) vs **`unexpected-fork`** (a real integrity signal — alarm). Without
  this split, FR-12's proof cannot distinguish a benign restart from tampering.
- **Pilot partial-success semantics (§7.2)** are stated explicitly: state-write
  then emit-`Left` = a *logged, metered divergence*, reconciliation deferred to
  cycle-2 (C2-0). Honest and observable, not silently atomic.

---

## 4. The type-boundary (FR-7, FR-ADOPT-4) — make raw `.publish` uncallable

### 4.1 The inversion

Today the cell **holds** the raw transport and hands it in: `NatsLike` is a
non-exported structural interface (publisher.ts:51-53) passed as the `nats:` field
(publisher.ts:58). Any object with a `.publish(subject, data)` method
structurally satisfies it — so the boundary is unenforced.

> **SKP-001/SKP-002 (the leak my first draft had).** An exported `unwrap()` /
> `wrapTransport()` is NOT a hard boundary — any cell could call
> `wrapTransport(client).unwrap().publish(...)`. The Flatline skeptics were right:
> a documented-`@internal` method + lint is convention, not capability. The fix is
> a **closure-captured raw client that is never exposed** — the only function that
> can publish through it lives inside the events package and is not exported.

The events package constructs the transport (cells never touch the raw client),
and the capability to publish through it is a **module-private function**, not a
method on an exported object:

```ts
// packages/events/src/transport.ts  (NEW)
declare const TransportBrand: unique symbol;

/** Opaque token. A cell can hold one and pass it to makeEmitter, but it has NO
 *  member that yields the raw client — there is nothing to call .publish on. */
export interface NatsTransport {
  readonly [TransportBrand]: true;
}

interface RawNats {
  publish(subject: string, data: Uint8Array, opts?: { headers?: unknown }): void | Promise<unknown>;
}

// The raw client lives ONLY in this module-private WeakMap, keyed by the opaque
// token. No exported accessor returns it.
const RAW = new WeakMap<NatsTransport, RawNats>();

/** The events package builds the transport from connection options — it owns the
 *  raw client end to end. Cells call THIS (with config), never `wrapTransport`. */
export function createNatsTransport(raw: RawNats): NatsTransport {
  const token: NatsTransport = Object.freeze({ [TransportBrand]: true });
  RAW.set(token, raw);
  return token;
}

/** Package-private capability. NOT in index.ts. emit.ts/publishEnvelope import it
 *  directly from "./transport.js"; no code outside packages/events can. */
export function internalPublish(t: NatsTransport): RawNats {
  const raw = RAW.get(t);
  if (!raw) throw new Error("[events] transport not constructed via createNatsTransport");
  return raw;
}
```

`index.ts` exports `createNatsTransport` and the `NatsTransport` *type* — but NOT
`internalPublish`. A cell holding a `NatsTransport` has no member and no exported
function that returns the raw client; the WeakMap is unreachable. This is a
**capability boundary**, not a naming convention.

### 4.2 Lint as defense-in-depth (not the boundary)

The closure (§4.1) is the primary boundary. The lint (§5) is the second layer: it
flags a cell importing `internalPublish` from `packages/events/src/transport.js`
(deep import past the package entrypoint), any `nats`/`@nats-io` client import
outside the composition root, and — per IMP-005 — the unwrap-to-variable-to-publish
dataflow on a raw NATS client type. The lint discriminates by transport *type*,
not the `.publish(` substring, so the ~19 non-ACVP `.publish` sites (Redis/RabbitMQ/
notifier) and the `INatsPublisher` abstraction are untouched (NG-3).

---

## 5. The lint, count-delta gate, and `events-lint` bin (FR-8, FR-9, FR-9a, FR-ADOPT-4/5/6)

### 5.1 Mechanism (OQ-3 decision)

**ESLint custom rule** (`no-raw-nats-publish`) shipped from the events package +
a standalone **count-delta CI script**. Rationale: the module-boundary + brand
(§4) stop *honest* code at compile time, but the lint is what makes a deliberate
bypass *fail CI*, produces teaching output (FR-ADOPT-6), and ships as a runnable
bin (FR-ADOPT-5) for cross-repo self-enforcement (cycle-2 down-payment).

The rule flags, outside `packages/events/**`:
1. an import of `internalPublish` (the package-private capability, §4) from a
   deep `packages/events/src/transport.js` path, or
2. a `.publish(` call whose receiver type resolves to the raw NATS client type
   (via the TS type-checker services — *type*, not substring), or
3. a NATS-client import (`nats`, `@nats-io/*`) in a cell that isn't the
   composition root, or
4. (IMP-005) a dataflow where a raw NATS client is aliased to a variable and then
   `.publish`-ed — not just the direct call form.
5. (events #255) an import of `publishEnvelope` from `"@0xhoneyjar/events"` as a
   value (not `import type`) — the capability that bypasses schema validation.
   Kind: `publishEnvelope-bypass`. Allowlist: `publishEnvelope_allowlist` section
   of `raw-nats-allowlist.yaml`.

…unless the site is in the allowlist (§5.2). `emitRaw` call sites are checked
against the separate `emitRaw-allowlist` (§3.3/§5.2).

### 5.2 Allowlist + monotonic shrink (FR-9, FR-9a — the CRITICAL property)

```yaml
# packages/events/raw-nats-allowlist.yaml  (NEW, machine-readable)
version: 1
# Each entry: a grandfathered raw NATS emit awaiting migration onto emit().
# This SET can ONLY SHRINK — the gate compares entry SETS, not just counts.
# The 11 sites are enumerated verbatim in grounding-notes.md §1.
entries:
  - id: "coexist.shadow.sync.complete@packages/adapters/coexistence/shadow-sync-job.ts:331"
  - id: "parallel.mode.enabled@packages/adapters/coexistence/parallel-mode-orchestrator.ts:265"
  # … all 11 (grounding-notes.md §1); each id = "<subject>@<file>:<line>" …
emitRaw_allowlist:                 # §3.3 — emitRaw is bounded + visible, own set-gate
  - id: "event-router.ts:346"
  - id: "event-router.ts:397"
  - id: "NatsClient.ts:379"
```

```bash
# tools/check-nats-allowlist-shrinks.sh  (NEW — CI gate, FR-9a + IMP-003)
# SET subset, NOT count: the head set MUST be a subset of the base set. A
# count-preserving SWAP (remove a migrated id, add a new raw id) is therefore
# rejected — IMP-003 closed.
comm -13 \
  <(git show "origin/${BASE:-main}:packages/events/raw-nats-allowlist.yaml" | yq -r '.entries[].id' | sort) \
  <(yq -r '.entries[].id' packages/events/raw-nats-allowlist.yaml | sort) \
  > /tmp/added_ids
if [ -s /tmp/added_ids ]; then
  echo "::error::raw-nats allowlist gained id(s) — the floor is shrink-only (additions, not just net count):"
  cat /tmp/added_ids
  echo "A count-preserving swap is still a NEW raw emit. Use the cell's emit()."
  exit 1
fi   # (same set-subset check applied to emitRaw_allowlist)
```

This is what makes G-1's "physically futile" true: a developer can write a raw
emit, but they cannot get its id into the allowlist set — not by appending (count
rises) and not by swapping (the new id is an addition the `comm -13` catches). The
only way to land is `emit()`.

### 5.3 Teaching errors (FR-ADOPT-6) + the bin (FR-ADOPT-5)

Every lint failure names: the file, whether it is a **NEW** raw emit (regression
→ fail) vs an **allowlisted** one (no-op → pass), the one-paragraph doc link, and
the fix command (`freeside events:new-schema` or "use this cell's `emit()`").
Packaged as `bin: { "events-lint": "./dist/cli/events-lint.js" }` in
`@0xhoneyjar/events/package.json` so any consumer (incl. git-tarball sonar in
cycle-2) runs `npx events-lint` without copying CI config.

---

## 6. The codemod + scaffold generator (FR-ADOPT-2, FR-ADOPT-3)

### 6.1 Codemod — move the grandfathered ~11 onto `emit()` (FR-ADOPT-2)

`ts-morph` transform (`tools/codemod/raw-nats-to-emit.ts`): finds
`<recv>.publish('<subject>', <obj>)` where `<recv>` is a NATS transport /
`INatsPublisher`, and rewrites to `await this.emit(<SchemaId>, <obj>[, <specifier>])`,
inserting the `makeEmitter` wiring at the class composition point and registering
the (subject → SchemaId) mapping. The codemod **removes the corresponding
allowlist entry** in the same pass (FR-9). OQ-5's hard case (the 2 computed-subject
emits) is handled by emitting `emitRaw(id, subject, obj)` (§3.2) where the subject
can't be decomposed — flagged in the codemod report for human review, not
auto-forced.

### 6.2 Scaffold generator — one-command new event (FR-ADOPT-3, NFR-Ergo-2)

`freeside events:new-schema <name>` (a `freeside-cli` subcommand) scaffolds, in one
run, a compiling + registry-wired + lint-passing skeleton:
1. `packages/events/src/schemas/<name>.ts` — an `S.Struct({})` stub with the
   Effect.Schema header (mirrors nft-mint-detected.ts).
2. a topic helper in `topics.ts` (or co-located) following the
   `{aggregate}.{noun}.{verb}.v{N}` convention (topics.ts:1-9).
3. the registry entry appended to `ENTRIES` (§2.2) + the index.ts export
   (index.ts:46-49 pattern).
4. a stub `acvp_invariant` row (`schema_enforcement`, `status: aspirational`,
   dated) in the owning beacon + a dated allowlist entry — so a new event lands
   *declared* and is tracked toward `bound`.

NFR-Ergo-2: the skeleton passes `tsc` + the collision test + the lint on first
run; the developer only fills in the `S.Struct` fields.

---

## 7. The pilot (FR-10, FR-11, FR-12) — `parallel.mode.enabled`

### 7.1 Target selection (OQ-2 — settled)

Target: **`packages/adapters/coexistence/parallel-mode-orchestrator.ts:265`**,
the `parallel.mode.enabled` emit. Settled over the `coexist.*` candidates because:
(a) it is the cleanest **state-write → publish** pair (`saveParallelModeConfig`
at :262 → `nats.publish` at :265); (b) `packages/adapters/coexistence/` is the
**canonical** copy (the `themes/sietch/src/packages/jobs/coexistence/` twin is
older); (c) its consumer is a **test harness** (the only `INatsPublisher` impls in
the tree are `createMockNats()` in the `.test.ts` files — the seam is exercised by
tests, not wired to a live bus), which is exactly FR-12's "real *or* test
consumer" and lets the pilot prove the loop with **zero live-infra dependency**.

### 7.2 The pilot schema + migration (FR-10, FR-11)

```ts
// packages/events/src/schemas/parallel-mode-enabled.ts  (NEW)
export const ParallelModeEnabledSchema = S.Struct({
  community_id: S.String,
  guild_id: S.String,
  // The raw emit inlines the FULL config (orchestrator :268). To avoid coupling
  // the event schema to the entire config schema, the pilot schema carries a
  // bounded, stable subset + a config hash for provenance. (The full-config
  // event would be a schema-evolution liability — NG-7.)
  config_hash: S.String.pipe(S.pattern(/^[0-9a-f]{64}$/)), // IMP-004: see below
  mode: S.Literal("parallel", "shadow"),
  enabled_at: S.String.pipe(S.pattern(/^\d{4}-\d{2}-\d{2}T.*Z$/)),
});
```

**`config_hash` canonicalization (IMP-004).** `config_hash` is verifiable only if
its derivation is pinned: `config_hash = sha256Hex(jcsCanonicalize(fullConfig))`,
reusing the package's existing `jcs.ts` (the same JCS the envelope uses,
publisher.ts:134). Any consumer re-deriving it from the config gets byte-identical
results. (An unspecified hash is an un-checkable field.)

Migration at `parallel-mode-orchestrator.ts`:
- replace the `INatsPublisher` dependency with a `makeEmitter`-produced `emit`
  (wired at the `createParallelModeOrchestrator` factory, :628);
- `this.nats.publish('parallel.mode.enabled', {...})` (:265) → `const r = await
  this.emit(ParallelModeEnabled, {...}); if (Either.isLeft(r)) { this.log.error(...);
  this.metrics.eventEmitFailed.inc(...); }` (§3.4 — observable, never silent);
- delete the `parallel.mode.enabled` allowlist id (FR-9). The other two emits in
  this file (:320, :483) ride the same codemod pass or stay allowlisted (NG-4).

**Partial-success semantics (SKP-005/IMP-007 — stated, not hidden).** The state
write (`saveParallelModeConfig`, :262) happens *before* the emit (:265). In v1
(soundness, not completeness), if `emit` returns `Left` the config is **already
committed** and the event is **not** sent. This is the known completeness gap
(NG-1/C2-0) — v1's contract is: **the divergence is logged + metered (§3.4), never
silent**, and reconciliation is cycle-2. v1 does NOT claim state⟺event atomicity;
it claims (a) what *is* emitted is schema-valid, and (b) a failure to emit is
observable. The FR-12 test asserts both the happy path AND that an injected
`Left` produces the divergence log/metric (so the gap is *proven observable*, not
assumed).

### 7.3 The verifying consumer (FR-12)

A test-harness consumer (extending the existing `subscribeEnvelope` path,
subscriber.ts) that — unlike events-trace.ts:351 which passes `S.Unknown` —
resolves the schema from the **registry** and asserts all three: Ed25519 signature
(EVT-001), payload-schema decode (`decodePayloadEither`, subscriber.ts:299), and
prev-hash chain continuity. This is the first exercise of the receiver-side
soundness capability the crystallization brief flagged as currently unexercised,
and it closes the loop: registry → emit() → envelope → receiver-recheck, one repo,
one process.

---

## 8. Coverage — beacon declaration + CI assertion (FR-13, FR-14)

### 8.1 The invariant (FR-13)

The owning building's `packages/protocol/beacon.yaml` declares (shape grounded in
`sample-beacon-v3.yaml:63-69`):

```yaml
acvp_invariants:
  - id: schema_enforcement
    scope: "Every NATS event emitted via emit() is payload-validated against its
            registry schema before signing; raw .publish is unreachable outside
            packages/events."
    proof_artifact: "tests/acvp/schema_enforcement.test.ts"
    runtime_class: envelope          # acvp-bindings.ts:115-116 — without this, schema_enforcement is "skip"
    status: active                   # backed by the proof above (beacon-v3.ts:196-200)
```

`runtime_class: envelope` is load-bearing: `acvp-bindings.ts:115-116` maps
`schema_enforcement` to `"skip"` *unless* `runtime_class === "envelope"`. The proof
artifact is a real test that exercises the emit()→reject path.

> **Owning-building note — RESOLVED (grounding-notes.md §4).** loa-freeside (the
> platform monolith) has **no in-repo beacon** — the 8 registered buildings in
> `registry.yaml` are all external `*-api` repos. So this cycle creates the **first
> in-repo beacon**: `packages/events/beacon.yaml`, slug **`freeside-events`**
> (visibility: internal), registered in `registry.yaml::modules`. That is the exact
> closure the meta-gap (arrakis-vl8f) asked for — the protocol-definer finally
> declares the invariant for the protocol it defines. S5 gains the small "create
> beacon + register slug" sub-task.

### 8.2 CI assertion (FR-14)

`validateAcvpBindings` must report `contract_status: "bound"` (acvp-bindings.ts:64)
for the pilot building's `schema_enforcement` invariant, asserted CI-visibly. The
existing `acvp-bindings` job (cluster-compliance.yml:255) stays **report-only** for
other buildings (NG-4) — but a dedicated CI step asserts the pilot's `bound`
status. No allowlist entry for `schema_enforcement` (it is `active`, proof-backed,
not aspirational).

---

## 9. The ramp (FR-ADOPT-8) + version coupling (OQ-4)

### 9.1 Rollout ordering (FR-ADOPT-8)

Strictly ordered so no engineer hits a wall before the door exists:
1. **Land facade + registry + codemod** (the ergonomic path exists and the 11 are
   moved). Lint not yet blocking.
2. **Lint report-only ≥1 sprint** (`no-raw-nats-publish` warns; count-delta script
   runs but `exit 0` with annotation).
3. **Flip count-delta to fail-block** (FR-9a active).
4. **Stagger the aspirational expiries.** The current `.freeside/acvp-aspirational-
   allowlist.yaml` stacks **every** entry on `expires: "2026-08-30"` (sonar-api ×3,
   identity-api ×1) — the exact anti-pattern FR-ADOPT-8 names. This cycle restaggers
   them to distinct dates so they don't all fail-block CI on the same day.

### 9.2 Version coupling (OQ-4 — lean yes)

Add a compile-time assertion that `SCHEMA_VERSION` (envelope.ts, = `"acvp-l1-v2"`)
equals the contract validator's `ACVP_L1_SCHEMA_VERSION`:

```ts
// IMP-008: the equality is meaningful ONLY if both are LITERAL types, not the
// widened `string`. Both constants must be `as const` (or typed to a literal).
// SCHEMA_VERSION (envelope.ts:24) and ACVP_L1_SCHEMA_VERSION must each be `"acvp-l1-v2"`,
// not `string`, or the conditional below trivially passes and gives false confidence.
type _AssertEqual<A extends B, B extends A> = true;
const _versionsAgree: _AssertEqual<typeof SCHEMA_VERSION, typeof ACVP_L1_SCHEMA_VERSION> = true;
```

Cheap, closes Flatline IMP-010 (two literals that agree today with no compile-time
link) — and IMP-008 (the assertion is only real if the literal types are
preserved; a unit test additionally asserts `SCHEMA_VERSION === ACVP_L1_SCHEMA_VERSION`
at runtime as belt-and-suspenders).

---

## 10. Security & non-functional (NFR-Sec-1, NFR-Perf-1, NFR-Compat-1/2, NFR-Ergo-1/2)

- **NFR-Sec-1.** Validate-before-sign (§3.2) creates no unsigned-payload-on-bus
  path: a `Left` returns before `publishEnvelope`. The brand (§4) does not alter
  the signing-bytes derivation (publisher.ts:139-156); EVT-001 stays closed.
- **NFR-Perf-1.** Emit-time `S.validateEither` is one schema pass over a payload
  that `publishEnvelope` already JCS-canonicalizes + SHA-256s + Ed25519-signs
  (publisher.ts:134-164) — negligible relative to the existing cost. The per-cell
  chain mutex (§3.2) serializes a cell's own emits but does not cross cells. No
  threshold asserted for v1 (Flatline IMP-011 dispositioned qualitative).
- **NFR-Compat-1.** Wire format unchanged (`acvp-l1-v2`); `subscribeEnvelope`
  consumers (events-trace.ts) unaffected — the change is publish-side.
- **NFR-Compat-2.** Registry is additive; un-migrated cells keep their allowlisted
  raw emits (not broken). The codemod is opt-in per-site.
- **NFR-Ergo-1/2 (the adoption gates).** `emit(id, payload)` is 2 args vs the raw
  `publish(subject, obj)` 2 args — and removes the per-call signer/store/transport
  threading entirely (net fewer tokens). The generator output passes CI unedited.

---

## 11. Testing strategy

| Layer | Test | Asserts |
|-------|------|---------|
| Unit | `registry.collision.test.ts` | duplicate SchemaId → fail (FR-2); un-reviewed `transform:true` → fail; non-transform JCS round-trip (SKP-004) |
| Type | `emit.type-test.ts` (tsd / `@ts-expect-error`) | `emit(ParallelModeEnabled, wrongShape)` is a COMPILE error (SKP-005/IMP-001) |
| Unit | `emit.test.ts` | valid → `Right(receipt)`; invalid → `Left(SchemaEmitError)` with NO publish + NO chain-advance; unknown id → `Left(UnknownSchemaIdError)` NOT a throw (SKP-001); concurrent emits don't fork the chain (mutex, SKP-001) |
| Unit | `transport.test.ts` | a cell-held `NatsTransport` has NO member yielding the raw client; `internalPublish` not reachable from the package entrypoint (SKP-001/002) |
| Unit | `emitRaw.test.ts` | wrong subject-family → `Left(SubjectFamilyError)`; payload still validated (SKP-008) |
| Unit | `events-lint` | NEW raw emit / `internalPublish` deep-import / unwrap-to-var dataflow → fail w/ teaching msg; allowlisted → pass; non-allowlisted `emitRaw` → fail (FR-8/ADOPT-4/6, IMP-005) |
| Unit | set-subset gate script | allowlist gains an id (append OR count-preserving swap) → exit 1 (FR-9a/IMP-003) |
| Integration | pilot loop | `parallel.mode.enabled` via emit() → harness consumer verifies sig+schema+chain (FR-10/11/12) |
| Integration | divergence-observability | injected emit-`Left` after state-write → divergence log + metric fire (SKP-003/005, IMP-007) |
| CI | `validateAcvpBindings` | `freeside-events` `schema_enforcement` → `contract_status: bound` (FR-14) |
| Build | version-coupling | literal-typed `SCHEMA_VERSION === ACVP_L1_SCHEMA_VERSION` (OQ-4/IMP-008) |

---

## 12. Sprint decomposition preview (feeds Phase 5)

Dependency-ordered; the ramp (FR-ADOPT-8) forces facade-before-lint.

1. **S1 — Registry + emit facade + type-boundary** (FR-1/2/3/3a/4/5/7, ADOPT-1/7).
   The keystone. Phantom `SchemaId<P>`, validate-only + sign-original, non-throwing
   `lookupSchema`, the per-cell chain **mutex**, the closure-held `NatsTransport`
   (`createNatsTransport`/`internalPublish`, no exported `unwrap`), `emitRaw`,
   collision+round-trip tests, version-coupling assertion. The hardening from the
   Flatline SDD review (§13) lands here.
2. **S2 — Lint + set-subset gate + events-lint bin** (FR-8/9/9a, ADOPT-4/5/6),
   shipped **report-only**. Both allowlist sets (raw + emitRaw) enumerated from
   `grounding-notes.md §1`; the gate is set-subset (IMP-003), not count.
3. **S3 — Codemod + scaffold generator** (FR-ADOPT-2/3): move the grounded 11 onto
   `emit()`/`emitRaw`, `freeside events:new-schema`.
4. **S4 — Pilot migration + verifying consumer + divergence test** (FR-10/11/12,
   §3.4) on `parallel.mode.enabled`.
5. **S5 — Coverage + ramp** (FR-13/14, ADOPT-8): create `packages/events/beacon.yaml`
   + register the `freeside-events` slug (the first in-repo beacon, §8.1), CI `bound`
   assertion, flip the set-gate to fail-block, restagger the aspirational allowlist
   dates.

> S1→S2→S3 are the on-ramp ("build the door"); S4→S5 are the proof + the
> fail-block ("close the gap"). The order is the adoption guarantee, not just
> convenience.

---

## 13. Flatline SDD-review disposition (2026-05-31)

3-model (claude-headless + codex-headless + gemini-headless), 299s, **100%
agreement: 7 HIGH_CONSENSUS, 0 DISPUTED, 10 BLOCKERS.** Raw: `flatline-sdd-review.json`.
All findings were mechanism-level corrections (none challenged the cycle's scope);
all integrated. The 17 findings collapsed to 9 fixes:

| Fix | Findings | Where integrated |
|-----|----------|------------------|
| Closure-held transport (no exported `unwrap`/`wrapTransport`) — capability, not convention | SKP-001, SKP-002, IMP-005 | §4.1/§4.2 |
| Phantom `SchemaId<P>` → compile-time payload binding | SKP-005, IMP-001 | §2.1, §3.1 |
| Non-throwing `lookupSchema` → `Left(UnknownSchemaIdError)` | SKP-001 | §2.2, §3.1 |
| `S.validateEither` (no transform) + sign-original; `transform` opt-in + round-trip test | SKP-004 | §2.1, §2.2, §3.1 |
| `emitRaw` fully specified + lint-gated + own shrink-only allowlist | SKP-002, SKP-008, IMP-002 | §3.3, §5.1/§5.2 |
| Allowlist gate = **set-subset**, not count (kills count-preserving swap) | IMP-003 | §5.2 |
| Per-cell chain **mutex** (serialize get→sign→publish→set) | SKP-001 | §3.1, §3.2 |
| Emit-`Left` observable (log+metric); chain-fork `store-miss` vs `unexpected-fork`; pilot partial-success stated | SKP-003, SKP-005, IMP-007 | §3.4, §7.2 |
| `config_hash = sha256(JCS(config))`; version constants literal-typed | IMP-004, IMP-008 | §7.2, §9.2 |

**Net effect.** The type-boundary went from convention (a leaky exported `unwrap`)
to a real capability boundary; the "structurally cannot emit invalid" claim is now
*compile-time* true (phantom types), not just runtime; the shrink-only gate is
swap-proof; and the residual completeness gap (deferred by scope) is *observable*
rather than silent. The cycle's shape — soundness + adoption, in-repo pilot — is
unchanged.

---

*Generated via /simstim Phase 3 (ARCHITECTURE), grounded in verbatim signatures;
hardened by Phase 4 (Flatline SDD, 3-model, 100% agreement — §13). Open items now
all closed in `grounding-notes.md` (11-site enumeration, beacon slug). Next: Phase
5 — sprint planning.*
