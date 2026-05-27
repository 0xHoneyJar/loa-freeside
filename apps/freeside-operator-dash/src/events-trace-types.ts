import type { EventEnvelope, VerificationFailureReason } from "@0xhoneyjar/events";

/**
 * Outcome of envelope verification, recorded per-message.
 *
 * - "ok" — all checks passed (sig + payload-hash + envelope-schema; per-event
 *   payload schema is intentionally skipped for the dash since it's a
 *   generic catch-all subscriber across all event types)
 * - <VerificationFailureReason> — one of the library's typed failure reasons
 *   (e.g. "signature-invalid", "prev-hash-broken-chain"). The dash records
 *   the reason verbatim so operators can filter / triage in the panel.
 */
export type TraceOutcome = "ok" | VerificationFailureReason;

/**
 * A single recorded envelope observation with its verification status.
 *
 * `envelope` is undefined when verification failed BEFORE the envelope
 * could be parsed (json-parse-error, envelope-schema-invalid). In that
 * case `rawBytes` holds the original message payload for forensics.
 */
export interface TracedEnvelope {
  /** Server time the envelope was received (ms epoch). */
  observedAtMs: number;
  /** NATS subject the message arrived on. */
  subject: string;
  /** Verification outcome — "ok" or the typed failure reason. */
  outcome: TraceOutcome;
  /** Parsed envelope (undefined when verification couldn't decode it). */
  envelope?: EventEnvelope;
  /** Raw bytes (truncated to 1KB for storage). For forensics on failures. */
  rawBytesB64: string | null;
  /** Optional error excerpt for failure modes (truncated). */
  errorExcerpt: string | null;
}

/**
 * Per-event-class rollup summary — what the dash table shows at-a-glance.
 *
 * The event_class is derived from envelope.event_type by stripping the
 * trailing version segment: `nft.mint.detected.mibera-shadow.v1` →
 * `nft.mint.detected.mibera-shadow`. This groups versioned topics together
 * so v1 + v2 share a row during the coexistence window.
 */
export interface PerClassSummary {
  /** The event class (event_type without trailing `.v{N}`). */
  eventClass: string;
  /** Total envelopes observed for this class since boot. */
  totalObserved: number;
  /** Envelopes that passed verification (outcome === "ok"). */
  okCount: number;
  /** Envelopes that failed verification (any outcome !== "ok"). */
  failureCount: number;
  /** Most-recent envelope's observedAtMs (or null if none). */
  lastSeenMs: number | null;
  /** Most-recent envelope's outcome (or null if none). */
  lastOutcome: TraceOutcome | null;
  /** Distinct (emitted_by, signing_key_id) pairs that have published. */
  distinctPublishers: number;
}

/**
 * Snapshot of the events-trace state at dashboard render time.
 *
 * The full ring buffer (last N envelopes per class) is available via
 * GET /api/events — this summary is the HTML-render representation.
 */
export interface EventsTraceSnapshot {
  /** Whether the subscriber is wired (i.e. NATS_URL was present at boot). */
  subscriberEnabled: boolean;
  /** Whether the NATS connection is currently up. */
  natsConnected: boolean;
  /**
   * Number of subscriptions that successfully attached. When `natsConnected`
   * is true but `subscribedCount === 0`, the broker socket is alive but the
   * subscriber is listening on no subjects — dashboard must surface this as
   * unhealthy. BB#229 rd-2 F-002 closure.
   */
  subscribedCount: number;
  /** The subjects/wildcards the subscriber is listening to. */
  subscribedSubjects: string[];
  /** Per-class rollup. Empty array if no envelopes observed yet. */
  perClass: PerClassSummary[];
  /** Total envelopes observed across all classes since boot. */
  totalObserved: number;
  /** Total failures across all classes since boot. */
  totalFailures: number;
  /** Most-recent N envelopes across ALL classes (for the panel's live feed). */
  recentEnvelopes: TracedEnvelope[];
  /** Optional last error from the subscriber lifecycle (connect/subscribe). */
  lastLifecycleError: string | null;
}
