/**
 * Events Trace — server-side NATS subscriber + in-memory ring buffer.
 *
 * The operator-dash's primary observability surface for the cluster's
 * cross-cell events substrate (per cluster-events-pillar-v1 Sprint 3, build
 * doc §6). Subscribes to wildcard subjects, verifies every envelope through
 * @0xhoneyjar/events, and records the outcome + envelope into a ring buffer
 * the dashboard renders.
 *
 * Lifecycle posture:
 *   - Best-effort: if NATS_URL is absent, the subscriber stays disabled and
 *     the panel renders an explanatory message. The dash itself never fails
 *     to boot due to NATS unavailability.
 *   - Fail-soft: any subscriber-side error (broken envelope, sig fail,
 *     chain gap) is recorded into the ring buffer with the typed reason
 *     and surfaces in the panel. NEVER throws from the subscriber loop.
 *   - Single-process: the ring buffer lives in-memory in the dash process.
 *     Multi-instance dashes would each have their own view; for v1 the dash
 *     is single-instance so this is fine.
 */

import { Schema as S } from "@effect/schema";
import {
  GENESIS_PREV_HASH,
  InMemoryPrevHashStore,
  JwksVerifier,
  StaticPubkeyVerifier,
  subscribeEnvelope,
  type EventEnvelope,
  type VerificationFailureReason,
  type Verifier,
} from "@0xhoneyjar/events";

// SubscribeHandle isn't exported from @0xhoneyjar/events; derive its type
// from subscribeEnvelope's return shape (Awaited<ReturnType<>>) so the
// dash doesn't need a fast-follow re-export PR upstream.
type SubscribeHandle = Awaited<ReturnType<typeof subscribeEnvelope>>;
import type {
  EventsTraceSnapshot,
  PerClassSummary,
  TraceOutcome,
  TracedEnvelope,
} from "./events-trace-types.js";

// --- ring buffer constants --------------------------------------------------

/** Cap on the rolling per-class buffer. */
const PER_CLASS_RING_SIZE = 200;
/** Cap on the rolling cross-class feed surfaced in EventsTraceSnapshot. */
const CROSS_CLASS_FEED_SIZE = 100;
/** Cap on raw-bytes capture (for failure forensics; truncated to keep memory bounded). */
const RAW_BYTES_CAP = 1024;

// --- subject defaults -------------------------------------------------------

/**
 * Default catch-all subjects. v1 substrate scope per build doc is
 * Mibera-family + PuruPuru NFT mints; we subscribe to the broad NFT
 * wildcard plus a future-proof catch-all. v2 substrate expansion (vault,
 * staking, marketplace, etc.) adds more wildcards here.
 *
 * Overridable via EVENTS_TRACE_SUBJECTS env (comma-separated).
 */
const DEFAULT_SUBJECTS = ["nft.mint.detected.>"];

function resolveSubjects(): string[] {
  const raw = process.env.EVENTS_TRACE_SUBJECTS;
  if (!raw) return DEFAULT_SUBJECTS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// --- store ------------------------------------------------------------------

/**
 * In-memory store. Single source of truth for the dashboard panel.
 *
 * Thread-safety: Node is single-threaded; the subscriber's async loop and
 * the dashboard's read paths interleave at await points only. We use plain
 * mutation (push/shift on arrays) which is safe under that model.
 */
class EventsTraceStore {
  #perClass = new Map<string, TracedEnvelope[]>();
  #crossFeed: TracedEnvelope[] = [];
  #totalObserved = 0;
  #totalFailures = 0;

  record(observed: TracedEnvelope): void {
    this.#totalObserved += 1;
    if (observed.outcome !== "ok") this.#totalFailures += 1;

    const cls = this.#deriveEventClass(observed);
    const ring = this.#perClass.get(cls) ?? [];
    ring.push(observed);
    if (ring.length > PER_CLASS_RING_SIZE) ring.shift();
    this.#perClass.set(cls, ring);

    this.#crossFeed.push(observed);
    if (this.#crossFeed.length > CROSS_CLASS_FEED_SIZE) this.#crossFeed.shift();
  }

  snapshot(opts: { subscriberEnabled: boolean; natsConnected: boolean; subscribedCount: number; subscribedSubjects: string[]; lastLifecycleError: string | null }): EventsTraceSnapshot {
    const perClass: PerClassSummary[] = [];
    for (const [eventClass, ring] of this.#perClass.entries()) {
      const last = ring.length > 0 ? ring[ring.length - 1] : null;
      const okCount = ring.filter((e) => e.outcome === "ok").length;
      const distinctPublishers = new Set(
        ring
          .filter((e) => e.envelope !== undefined)
          .map((e) => `${e.envelope!.emitted_by}:${e.envelope!.signing_key_id}`),
      ).size;
      perClass.push({
        eventClass,
        totalObserved: ring.length,
        okCount,
        failureCount: ring.length - okCount,
        lastSeenMs: last?.observedAtMs ?? null,
        lastOutcome: last?.outcome ?? null,
        distinctPublishers,
      });
    }
    // Stable order: lastSeen DESC (most-recent class first).
    perClass.sort((a, b) => (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0));

    // Recent envelopes: cross-class feed in reverse-chronological order.
    const recentEnvelopes = [...this.#crossFeed].reverse();

    return {
      subscriberEnabled: opts.subscriberEnabled,
      natsConnected: opts.natsConnected,
      subscribedCount: opts.subscribedCount,
      subscribedSubjects: opts.subscribedSubjects,
      perClass,
      totalObserved: this.#totalObserved,
      totalFailures: this.#totalFailures,
      recentEnvelopes,
      lastLifecycleError: opts.lastLifecycleError,
    };
  }

  /**
   * Returns the per-class ring buffer (or empty if class never observed).
   * Used by GET /api/events?class=<class> for raw forensics.
   */
  getPerClass(eventClass: string): TracedEnvelope[] {
    return this.#perClass.get(eventClass) ?? [];
  }

  /**
   * Derive event class from envelope.event_type by stripping `.v{N}` suffix.
   * For failed-to-parse envelopes, bucket under "_unparseable".
   */
  #deriveEventClass(observed: TracedEnvelope): string {
    if (!observed.envelope) return "_unparseable";
    const parts = observed.envelope.event_type.split(".");
    if (parts.length >= 2 && /^v\d+$/.test(parts[parts.length - 1]!)) {
      return parts.slice(0, -1).join(".");
    }
    return observed.envelope.event_type;
  }
}

// --- module-singleton + subscriber lifecycle --------------------------------

// `let` (not `const`) so `_testHooks.reset()` can replace the instance for
// test isolation (BB#229 F-002 — the previous `(store as any).constructor.call(store)`
// pattern can't reinitialize ES private fields).
let store = new EventsTraceStore();

interface SubscriberLifecycle {
  /** Whether the subscriber was wired (NATS_URL was present at boot). */
  enabled: boolean;
  /**
   * Set to Date.now() AT THE END of a successful startup (NATS connected
   * + at least one subscribe succeeded). Used as the idempotency check —
   * re-entry returns early only after startup ACTUALLY completed (BB#229
   * rd-2 F-001 — previously the flag was set before any work, blocking
   * retry forever after a first-call NATS_URL-absent or connect-failed).
   */
  startedAt: number | null;
  /**
   * Set when a startup attempt is in-flight, to prevent two concurrent
   * callers from launching parallel subscribe loops. Distinct from
   * startedAt (which marks SUCCESSFUL completion).
   */
  startupInFlight: boolean;
  /** Live NATS connection status — updated by the nc.closed() watcher (BB#229 F-001). */
  connected: boolean;
  /**
   * Count of subscriptions that successfully attached (one per resolved
   * subject). When every subject's subscribe call throws, this stays 0
   * AND `connected` may still be true — operators need both signals to
   * tell "connected but listening to nothing" from "fully healthy".
   * (BB#229 rd-2 F-002 closure.)
   */
  subscribedCount: number;
  subjects: string[];
  lastError: string | null;
  /** SubscribeHandles (one per subject), held for teardown if ever needed. */
  handles: SubscribeHandle[];
}

const lifecycle: SubscriberLifecycle = {
  enabled: false,
  startedAt: null,
  startupInFlight: false,
  connected: false,
  subscribedCount: 0,
  subjects: [],
  lastError: null,
  handles: [],
};

/**
 * Boot the subscriber. Best-effort: returns without throwing even when
 * NATS_URL is absent. The lifecycle state object reflects the outcome and
 * is what the dashboard panel reads to surface "subscriber disabled (no
 * NATS_URL)" or "subscriber up · 200 envelopes seen" messages.
 */
export async function startEventsTraceSubscriber(): Promise<void> {
  // Idempotent — returns early only after startup ACTUALLY completed (BB#229
  // F-004 idempotency goal, refined by BB#229 rd-2 F-001 — the previous
  // `started=true-before-work` pattern blocked retry forever after a first
  // failed boot). Two guards: `startedAt` (success marker, set at the END
  // of a successful startup) + `startupInFlight` (concurrent-startup race
  // guard). NATS_URL absent or connect failure → leave startedAt null so
  // a future explicit retry can attempt again.
  if (lifecycle.startedAt !== null) return;
  if (lifecycle.startupInFlight) return;
  lifecycle.startupInFlight = true;
  try {
    await runStartup();
  } finally {
    lifecycle.startupInFlight = false;
  }
}

async function runStartup(): Promise<void> {
  const natsUrl = process.env.NATS_URL;
  const subjects = resolveSubjects();
  lifecycle.subjects = subjects;

  if (!natsUrl) {
    lifecycle.enabled = false;
    lifecycle.connected = false;
    lifecycle.lastError =
      "NATS_URL env var not set — events-trace subscriber disabled. Set NATS_URL to enable.";
    return;
  }

  lifecycle.enabled = true;
  let nc: import("nats").NatsConnection;
  try {
    const { connect } = await import("nats");
    const connectOpts: Parameters<typeof connect>[0] = { servers: natsUrl };
    // If NATS_TLS_CA is set, load it (matches the cluster's ECS TLS pattern).
    if (process.env.NATS_TLS_CA) {
      const fs = await import("node:fs/promises");
      connectOpts.tls = { caFile: process.env.NATS_TLS_CA };
    }
    nc = await connect(connectOpts);
    lifecycle.connected = true;

    // BB#229 F-001: watch the NATS connection lifecycle. Without this,
    // `lifecycle.connected` stays `true` forever even after the broker
    // drops — the panel would falsely report a healthy pipeline while
    // events stop arriving. The .closed() promise resolves when the
    // connection terminates (clean or unclean); flip the flag + capture
    // the error so the dashboard reflects reality.
    void nc.closed().then((closeErr) => {
      lifecycle.connected = false;
      lifecycle.lastError = closeErr
        ? `NATS connection closed: ${closeErr.message || String(closeErr)}`
        : "NATS connection closed (clean teardown)";
    });
  } catch (err) {
    lifecycle.connected = false;
    lifecycle.lastError = `NATS connect failed: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  // Build verifier. Prefer JWKS via JWKS_URL; fall back to no-verify in
  // dev when no key source is configured (verifier returns false for every
  // envelope → all surface as signature-invalid in the panel, which is
  // visually obvious + correct: the dash can't claim a sig is valid if it
  // has no key material to verify against).
  let verifier: Verifier;
  const jwksUrl = process.env.EVENTS_JWKS_URL;
  if (jwksUrl) {
    try {
      verifier = await JwksVerifier.fromUrl(jwksUrl, { timeoutMs: 5_000 });
    } catch (err) {
      lifecycle.lastError = `JWKS verifier init failed (${jwksUrl}): ${err instanceof Error ? err.message : String(err)}`;
      // Fall back to no-key verifier — all sigs will surface as invalid
      verifier = new StaticPubkeyVerifier();
    }
  } else {
    // No JWKS configured. Use empty StaticPubkeyVerifier — every envelope
    // will surface as signature-invalid in the panel. Operators see this
    // explicitly + can wire EVENTS_JWKS_URL when ready.
    verifier = new StaticPubkeyVerifier();
    if (!lifecycle.lastError) {
      lifecycle.lastError =
        "EVENTS_JWKS_URL not set — every envelope will surface as signature-invalid until a key source is configured.";
    }
  }

  // Subscribe to every configured subject. Per-subscription chainStore so
  // each subject tracks its own publishers' chains independently.
  for (const subject of subjects) {
    try {
      const handle = await subscribeEnvelope({
        nats: nc,
        subject,
        // Catch-all schema: any payload shape passes (the dash is generic
        // observability, not per-event business logic). subscribeEnvelope
        // still enforces envelope + sig + chain.
        schema: S.Unknown as S.Schema<unknown>,
        verifier,
        chainStore: new InMemoryPrevHashStore(),
        handler: (ctx) => {
          // Success path — record the OK envelope into the ring buffer.
          store.record(buildTracedEnvelope({
            subject: ctx.subject,
            outcome: "ok",
            envelope: ctx.envelope,
            rawBytes: null,
            errorExcerpt: null,
          }));
        },
        onVerificationFailure: (reason, detail) => {
          store.record(buildTracedEnvelope({
            subject: detail.subject,
            outcome: reason,
            envelope: detail.envelope,
            rawBytes: detail.rawBytes,
            errorExcerpt: detail.error
              ? String(detail.error).slice(0, 500)
              : null,
          }));
        },
      });
      lifecycle.handles.push(handle);
      lifecycle.subscribedCount += 1;
    } catch (err) {
      lifecycle.lastError = `subscribe(${subject}) failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // BB#229 rd-2 F-001: mark startup-completed ONLY when at least one
  // subscription attached. If every subscribe threw, leave startedAt=null
  // so a future explicit retry (e.g. when JWKS comes back, when the
  // broker recovers) can attempt again.
  //
  // BB#229 rd-2 F-002: if subscribedCount===0 we already wrote lastError
  // above (per-subject); the snapshot reads subscribedCount to surface
  // "connected but listening to nothing" → dashboard distinguishes
  // healthy from no-actual-observation.
  if (lifecycle.subscribedCount > 0) {
    lifecycle.startedAt = Date.now();
  }
}

function buildTracedEnvelope(args: {
  subject: string;
  outcome: TraceOutcome;
  envelope: EventEnvelope | undefined;
  rawBytes: Uint8Array | null;
  errorExcerpt: string | null;
}): TracedEnvelope {
  return {
    observedAtMs: Date.now(),
    subject: args.subject,
    outcome: args.outcome,
    envelope: args.envelope,
    rawBytesB64: args.rawBytes
      ? Buffer.from(args.rawBytes.subarray(0, RAW_BYTES_CAP)).toString("base64")
      : null,
    errorExcerpt: args.errorExcerpt,
  };
}

// --- read-only accessors for app.ts + render.ts -----------------------------

export function getEventsTraceSnapshot(): EventsTraceSnapshot {
  return store.snapshot({
    subscriberEnabled: lifecycle.enabled,
    natsConnected: lifecycle.connected,
    subscribedCount: lifecycle.subscribedCount,
    subscribedSubjects: lifecycle.subjects,
    lastLifecycleError: lifecycle.lastError,
  });
}

export function getPerClassRing(eventClass: string): TracedEnvelope[] {
  return store.getPerClass(eventClass);
}

/**
 * Test-only hook — direct store access for synthetic-envelope smoke tests
 * (FakeNats-style). The exported store is the SAME instance the subscriber
 * writes to, so a test can call `recordSynthetic(...)` to seed observations
 * without needing a live NATS broker.
 */
export const _testHooks = {
  recordSynthetic(observed: Omit<TracedEnvelope, "observedAtMs"> & { observedAtMs?: number }): void {
    store.record({
      observedAtMs: observed.observedAtMs ?? Date.now(),
      ...observed,
    });
  },
  reset(): void {
    // BB#229 F-002: replace the store instance for test isolation.
    // (Previous `(store as any).constructor.call(store)` couldn't reinit
    // ES private fields — calls on instances of classes with `#` fields
    // throw rather than reinitialize state.)
    store = new EventsTraceStore();
  },
  GENESIS_PREV_HASH,
  VerificationFailureReason: undefined as unknown as VerificationFailureReason,
};
