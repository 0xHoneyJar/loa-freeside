# @0xhoneyjar/events

> ACVP-enveloped cross-cell event substrate for the freeside cluster.

The first instance of cycle-098 L1 envelope discipline applied to the service-plane: every cluster cell that publishes an event wraps it in a hash-chained + Ed25519-signed envelope; every consumer verifies before routing. **One built, N inherited** — future cell-to-cell integrations are subscribe-to-subject + decode-envelope, no per-pair contract.

**Schema: Effect.Schema** (`@effect/schema`, NOT zod) — per cluster memory `freeside-effect-transition`, new protocol-layer types use Effect.Schema; legacy zod stays in identity-api's user-JWT and other established packages. Sibling pattern: `freeside-auth/packages/protocol/src/svc-jwt-claims.ts` (W2.5 T-2.1, the first Effect.Schema artifact in the cluster).

**Wire-format version: `acvp-l1-v2`** — signature covers the JCS-canonical form of the full envelope (with `signature: ""` placeholder), so every semantically load-bearing field (event_type, emitted_by, schema_version, event_id, emitted_at, prev_hash, payload_hash, signing_key_id, payload) is cryptographically bound. v1 (PR #227 first commit) was never deployed — superseded in-PR after BB review found the routing-metadata forgery vector.

Lives in the [Events Pillar v1](../../grimoires/loa/specs/enhance-events-pillar-v1-nft-mints.md) cycle. Sibling to the [auth substitution roadmap](../../grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md) — same shape (vendor-pattern → substrate → adoption), different plane (events vs identity).

## Install

```bash
pnpm add @0xhoneyjar/events
pnpm add nats  # peer dep — consumers bring their own connection
```

## Quick start (publisher)

```typescript
import { connect } from "nats";
import {
  publishEnvelope,
  LocalEd25519Signer,
  InMemoryPrevHashStore,
  nftMintDetectedTopic,
} from "@0xhoneyjar/events";

const nats = await connect({ servers: process.env.NATS_URL });
const signer = await LocalEd25519Signer.fromSeedHex(process.env.SIGNING_SEED_HEX!, "sonar-api-1");
const prevHashStore = new InMemoryPrevHashStore();

await publishEnvelope({
  nats,
  subject: nftMintDetectedTopic({ collectionSlug: "mibera-shadow" }),  // "nft.mint.detected.mibera-shadow.v1"
  payload: {
    chain_id: 80094,
    contract: "0x048327A187b944ddac61c6e202BfccD20d17c008",
    token_id: "234",
    minter: "0xabc...",
    block_number: 12345678,
    transaction_hash: "0xdef...",
    timestamp: new Date().toISOString(),
  },
  emittedBy: "sonar-api",
  signer,
  prevHashStore,
});
```

## Quick start (subscriber)

```typescript
import { connect } from "nats";
import {
  subscribeEnvelope,
  JwksVerifier,
  NftMintDetectedSchema,
} from "@0xhoneyjar/events";

const nats = await connect({ servers: process.env.NATS_URL });
const verifier = await JwksVerifier.fromUrl(process.env.JWKS_URL!);

import type { NftMintDetected } from "@0xhoneyjar/events";

await subscribeEnvelope({
  nats,
  subject: "nft.mint.detected.>",  // wildcard catch-all
  schema: NftMintDetectedSchema,
  verifier,
  handler: async ({ payload, envelope }) => {
    // payload is typed as NftMintDetected (= S.Schema.Type<typeof NftMintDetectedSchema>)
    console.log(`mint of token ${payload.token_id} on ${payload.contract}`);
  },
  onVerificationFailure: (reason, raw) => {
    // surfaces subject-mismatch, broken-sig, broken-chain, schema-violation
    // never throws — subscriber stays alive
  },
});
```

## Architecture

| Layer | What | File |
|-------|------|------|
| Envelope | Effect.Schema for the wire-shape (event_id, type, hashes, sig, payload) | `src/envelope.ts` |
| JCS | RFC 8785 canonicalization (byte-deterministic JSON) | `src/jcs.ts` |
| Signer | Ed25519 sign/verify via @noble/curves; JWKS lookup | `src/signer.ts` |
| Topics | Hounfour 3-segment topic builders (`{aggregate}.{noun}.{verb}.v{N}`) | `src/topics.ts` |
| Publisher | publishEnvelope: canonicalize → hash → sign → publish → store prev_hash | `src/publisher.ts` |
| Subscriber | subscribeEnvelope: parse → schema → subject-bind → hash → sig → chain → payload-schema → advance → handler | `src/subscriber.ts` |
| Schemas | Per-event Effect.Schema definitions (start: NftMintDetected) | `src/schemas/` |

## Design invariants

- **Hash chain is per-publisher (scoped to signer, not topic).** Each `(emittedBy, signing_key_id)` pair maintains its own `prev_hash` chain. A subscriber that re-publishes (e.g. characters republishing enriched events) maintains a SEPARATE chain — chain ownership belongs to *who signed it*, not *where it was published*. This composes cleanly with ACVP's identity model and makes subscriber re-publish non-destructive by construction.
- **JCS canonicalization is non-negotiable.** Payload hash MUST be computed from JCS-canonical JSON. Two implementations of this library MUST agree byte-for-byte on the canonical form of the same input. Do NOT substitute `JSON.stringify(payload)` — key ordering is unspecified.
- **Versioned topic suffix is non-negotiable.** `nft.mint.detected.v1`. Schema evolution requires a NEW versioned subject; subscribers must coexist v1 + v2 during overlap (≥30d).
- **Fail-soft, never crash.** Publisher: NATS errors propagate to the caller (caller decides fail-soft for the upstream domain write). Subscriber: broken envelope → surface via `onVerificationFailure` callback, NEVER throw. Typed `VerificationFailureReason` discriminates `envelope-schema-invalid` · `payload-schema-invalid` · `payload-hash-mismatch` · `signature-invalid` · `prev-hash-broken-chain` · `json-parse-error` · `handler-error` · `internal-error`.
- **TLS-only.** No plaintext NATS connections.
- **Identity fallback for display**: nym → shortened address. NEVER ENS (per the auth substitution roadmap; ENS is excised from THJ surfaces).

## Verifier choice (StaticPubkeyVerifier vs JwksVerifier)

| Verifier | Use when |
|---|---|
| `StaticPubkeyVerifier` | Tests; bootstrap-time pinned keys; internal services with a small known publisher set. Fully in-memory; no network. |
| `JwksVerifier` | Production subscribers consuming from the cluster's JWKS endpoint (per ADR-009 §D-5: `apps/gateway`). Fetches + caches; bounded by `timeoutMs` (default 5s) and refreshed on TTL expiry. Empty-but-200 responses preserve the existing cache rather than self-DoS. |

## Bootstrap-time replay defense (EVT-002 BB#227)

When `chainStore` is provided, the subscriber's behavior for the FIRST envelope from each publisher is controlled by `initialPrevHashPolicy`:

| Value | Behavior |
|---|---|
| `'any'` (default) | Accept any `prev_hash` on first envelope. Appropriate for subscribers that intentionally late-join a publisher's chain. Backward-compatible. |
| `'genesis'` | Require `prev_hash === GENESIS_PREV_HASH`. Replay of a mid-chain envelope as "first" is surfaced as `initial-anchor-policy-violation`. Choose this for subscribers that start at the beginning of a publisher's chain. |
| `<hex-string>` | Pinned anchor — first envelope MUST have `prev_hash === <hex>`. Use when an out-of-band sync has established a known anchor (e.g. operator pinned the publisher's chain tip at restart time). |

## Sprint 1 known limitations

The substrate is correct-by-construction in the happy path; these gaps are bounded and explicitly named for downstream consumers.

- **Publish/store atomicity (F-003)** — `publishEnvelope` does `nats.publish` then `prevHashStore.set` as two non-atomic steps. A crash between them forks the publisher's chain. Single-instance publishers in healthy processes don't hit this in practice; the failure mode is bounded to crash/restart windows. Sprint 2+ mitigation: back `prevHashStore` with Redis using a CAS pipeline conditioned on JetStream's `PubAck.seq`, OR accept at-least-once + add subscriber-side chain reset (see below).
- **Subscriber chain recovery (F-005)** — Once a chain gap is detected, every subsequent envelope from the same publisher will continue to fail the check (their `prev_hash` references the missed envelope). Recovery requires operator action — the `onVerificationFailure("prev-hash-broken-chain", ...)` callback can update the local chain store to admit the gap (see `subscriber.ts` for the exact reset pattern). Sprint 2+ adds a first-class `onChainGap` option.
- **Multi-instance publishers** — `InMemoryPrevHashStore` is single-process only. Multi-instance publishers MUST provide a shared store (Redis, etc.) or all their chains will fork on every load-balancer round-trip.
- **Deprecated transport package** — both `@effect/schema@0.75` (merged into main `effect` package post-publish) and `nats@2.x` (moved to `@nats-io/transport-node`) carry deprecation warnings on install. Tracked as follow-up beads in the coordinator. Not blocking; migration is a separate Sprint coordinated with downstream consumers.

## Provenance

- ACVP doctrine: `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md`
- L1 audit envelope prior art: `loa-freeside/.claude/scripts/audit-envelope.sh` + `.claude/data/trajectory-schemas/agent-network-envelope.schema.json`
- Hounfour topic naming: `loa-hounfour/src/schemas/domain-event.ts` (`{aggregate}.{noun}.{verb}`)
- Cluster topology: ADR-009 §D-5 federation discovery; §D-7 cluster-meta cycle type
- TEND audit baseline: `loa-freeside/grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md`
