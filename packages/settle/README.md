# @freeside/settle — The Settle Substrate

Makes *"is this claim `settled` or merely `claimed`?"* a mechanical, first-class
primitive. One shared substrate, N pluggable per-domain instruments.

Two distinct seams (the load-bearing flatline correction — they are NOT the same):

- **Pre-action GATE** (`SyncGate.checkSync`) — synchronous, fail-closed, and
  **unbypassable**. In a must-settle domain a `claimed` action cannot proceed; it
  abstains. This is the structural guarantee (G-2).
- **Post-hoc DETECTOR** (Sprint 2) — async safety net that scans the trail and
  surfaces what slips. Surfaces, never gates.

## Architecture (four-folder discipline)

```
src/
  domain/   tier · claim/bar/verdict · posture · snapshot   (pure types + total orders)
  ports/    settle-instrument · verifier · gate · classifier · snapshot · trail
  live/     classifier · verifier · snapshot-signer/-store · trail · gate · gated-facade
            _internal/must-settle-capability   (package-private; reachable only via the facade)
  mock/     deterministic doubles for every port
  config/   determinism-map.json   (sha-pinned in classifier.live.ts)
```

## Trust model (why it can't be gamed)

- **Producer is untrusted.** Its `self_reported_tier` is never read to decide.
- **Verifier is independent** (SKP-006): recomputes `earned_tier` by re-executing
  the instrument; shares no code path with any producer (import-lint enforced).
- **Snapshots are ed25519-signed** by the verifier; only the gate's configured
  trusted key can mint `settled`. Forged/expired/untrusted snapshots → abstain.
- **The gate is unbypassable** (SKP-001b): the raw must-settle capability is
  package-private; the only public path (`performGatedAction`) calls the gate
  first; an import-boundary test fails if anything else reaches the raw capability.
- **Classifier is fail-closed** (SKP-006): an unknown domain → `FAIL_CLOSED`.
- **Zero runtime dependencies** (threat A-8): `node:crypto` + `node:fs` only.

See `THREAT-MODEL.md` for the full actor/asset/boundary analysis.

## Usage

```ts
import {
  SyncGate, GlobClassifier, InMemorySnapshotStore, Ed25519SnapshotSigner,
  AppendOnlyFileTrail, IndependentVerifier, performGatedAction,
} from "@freeside/settle";

// evidence-prep (async, BEFORE the action): instrument runs, verifier recomputes,
// signer signs an immutable snapshot, store.put(...). Then at the call-site:
const gate = new SyncGate({
  classifier: new GlobClassifier(),
  store, trail: new AppendOnlyFileTrail("/path/trail.jsonl"),
  trustedVerifierPublicKey: signer.publicKey,
  now: () => logicalClock,
});

const outcome = performGatedAction(
  gate,
  { domain: "money/transfer", claim: { id: "claim-123" } },
  () => doTheHighBlastRadiusThing(),   // runs ONLY if the gate proceeds
);
```

## Develop

```bash
npm install
npx tsc --noEmit   # types
npm test           # vitest — the counter-example teeth
```
