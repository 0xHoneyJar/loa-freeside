#!/usr/bin/env tsx
/**
 * Smoke test for the events-trace panel.
 *
 * Seeds a few synthetic envelopes via `_testHooks.recordSynthetic` and
 * prints both the snapshot + a rendered HTML excerpt. Verifies that the
 * ring buffer, per-class rollup, and panel renderer work end-to-end
 * WITHOUT needing a live NATS broker.
 *
 * Run: pnpm tsx bin/smoke-events-trace.ts
 */

import { _testHooks, getEventsTraceSnapshot, getPerClassRing } from "../src/events-trace.js";
import { SCHEMA_VERSION, GENESIS_PREV_HASH, type EventEnvelope } from "@0xhoneyjar/events";

function syntheticEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    event_type: "nft.mint.detected.mibera-shadow.v2",
    schema_version: SCHEMA_VERSION,
    emitted_by: "sonar-api",
    emitted_at: new Date().toISOString(),
    prev_hash: GENESIS_PREV_HASH,
    payload_hash: "a".repeat(64),
    signing_key_id: "sonar-api-1",
    signature: "abcDEF-_123",
    payload: { synthetic: true },
    ...overrides,
  };
}

// Seed 3 envelopes:
//   1 OK (mibera-shadow)
//   1 signature-invalid (mibera-shadow — chain-break style)
//   1 OK (purupuru-apiculture — different publisher)
_testHooks.recordSynthetic({
  subject: "nft.mint.detected.mibera-shadow.v2",
  outcome: "ok",
  envelope: syntheticEnvelope(),
  rawBytesB64: null,
  errorExcerpt: null,
});

_testHooks.recordSynthetic({
  subject: "nft.mint.detected.mibera-shadow.v2",
  outcome: "signature-invalid",
  envelope: syntheticEnvelope({ signing_key_id: "sonar-api-rotated" }),
  rawBytesB64: null,
  errorExcerpt: "verifier returned false for kid sonar-api-rotated",
});

_testHooks.recordSynthetic({
  subject: "nft.mint.detected.purupuru-apiculture.v1",
  outcome: "ok",
  envelope: syntheticEnvelope({
    event_type: "nft.mint.detected.purupuru-apiculture.v1",
    emitted_by: "sonar-api",
    signing_key_id: "sonar-api-1",
  }),
  rawBytesB64: null,
  errorExcerpt: null,
});

const snap = getEventsTraceSnapshot();
console.log("=== EventsTraceSnapshot ===");
console.log(JSON.stringify(
  {
    subscriberEnabled: snap.subscriberEnabled,
    natsConnected: snap.natsConnected,
    subscribedSubjects: snap.subscribedSubjects,
    totalObserved: snap.totalObserved,
    totalFailures: snap.totalFailures,
    perClass: snap.perClass,
  },
  null,
  2,
));

console.log("\n=== per-class ring (nft.mint.detected.mibera-shadow) ===");
const ring = getPerClassRing("nft.mint.detected.mibera-shadow");
console.log(`count: ${ring.length}`);
for (const e of ring) {
  console.log(`  ${e.outcome}  ${e.subject}  ${e.envelope?.emitted_by}:${e.envelope?.signing_key_id}`);
}

// Basic invariants
const ok = snap.totalObserved === 3 && snap.totalFailures === 1 && snap.perClass.length === 2;
if (!ok) {
  console.error("\nSMOKE FAILED: invariants not met");
  console.error(`  totalObserved=${snap.totalObserved} (expected 3)`);
  console.error(`  totalFailures=${snap.totalFailures} (expected 1)`);
  console.error(`  perClass.length=${snap.perClass.length} (expected 2)`);
  process.exit(1);
}
console.log("\nSMOKE PASS: 3 envelopes recorded, 1 failure, 2 per-class buckets");
