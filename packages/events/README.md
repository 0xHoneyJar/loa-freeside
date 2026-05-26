# @0xhoneyjar/events

> ACVP-enveloped cross-cell event substrate for the freeside cluster.

The first instance of cycle-098 L1 envelope discipline applied to the service-plane: every cluster cell that publishes an event wraps it in a hash-chained + Ed25519-signed envelope; every consumer verifies before routing. **One built, N inherited** — future cell-to-cell integrations are subscribe-to-subject + decode-envelope, no per-pair contract.

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

await subscribeEnvelope({
  nats,
  subject: "nft.mint.detected.>",  // wildcard catch-all
  schema: NftMintDetectedSchema,
  verifier,
  handler: async ({ payload, envelope }) => {
    // payload is typed as z.infer<typeof NftMintDetectedSchema>
    console.log(`mint of token ${payload.token_id} on ${payload.contract}`);
  },
  onVerificationFailure: (reason, raw) => {
    // surfaces broken-sig, broken-chain, schema-violation
    // never throws — subscriber stays alive
  },
});
```

## Architecture

| Layer | What | File |
|-------|------|------|
| Envelope | Zod schema for the wire-shape (event_id, type, hashes, sig, payload) | `src/envelope.ts` |
| JCS | RFC 8785 canonicalization (byte-deterministic JSON) | `src/jcs.ts` |
| Signer | Ed25519 sign/verify via @noble/curves; JWKS lookup | `src/signer.ts` |
| Topics | Hounfour 3-segment topic builders (`{aggregate}.{noun}.{verb}.v{N}`) | `src/topics.ts` |
| Publisher | publishEnvelope: canonicalize → hash → sign → publish → store prev_hash | `src/publisher.ts` |
| Subscriber | subscribeEnvelope: receive → verify sig + chain + schema → route payload | `src/subscriber.ts` |
| Schemas | Per-event Zod schemas (start: NftMintDetected) | `src/schemas/` |

## Design invariants

- **Hash chain is per-publisher.** Each publisher (e.g. `sonar-api`) maintains its own `prev_hash` chain. A subscriber that re-publishes (e.g. characters republishing enriched events) maintains a SEPARATE chain.
- **JCS canonicalization is non-negotiable.** Payload hash MUST be computed from JCS-canonical JSON. Two implementations of this library MUST agree byte-for-byte on the canonical form of the same input.
- **Versioned topic suffix is non-negotiable.** `nft.mint.detected.v1`. Schema evolution requires a NEW versioned subject; subscribers must coexist v1 + v2 during overlap (≥30d).
- **Fail-soft, never crash.** Publisher: NATS down → caller's domain write still succeeds (the envelope publish is best-effort + logged). Subscriber: broken envelope → surface via callback, do NOT throw.
- **TLS-only.** No plaintext NATS connections.
- **Identity fallback for display**: nym → shortened address. NEVER ENS (per the auth substitution roadmap; ENS is excised from THJ surfaces).

## Provenance

- ACVP doctrine: `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md`
- L1 audit envelope prior art: `loa-freeside/.claude/scripts/audit-envelope.sh` + `.claude/data/trajectory-schemas/agent-network-envelope.schema.json`
- Hounfour topic naming: `loa-hounfour/src/schemas/domain-event.ts` (`{aggregate}.{noun}.{verb}`)
- Cluster topology: ADR-009 §D-5 federation discovery; §D-7 cluster-meta cycle type
- TEND audit baseline: `loa-freeside/grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md`
