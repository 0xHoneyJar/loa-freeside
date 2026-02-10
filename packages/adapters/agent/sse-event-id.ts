/**
 * SSE Event ID Generators
 * Sprint S14-T1: Distributed SSE Event ID Design (Finding B)
 *
 * Provides monotonic (single-server) and composite (multi-region) event ID
 * generators for Server-Sent Events.
 *
 * ADR: SSE IDs are for client-side ordering and same-server resume only.
 * Cross-server replay is NOT supported — handled by STREAM_RESUME_LOST FSM.
 * Composite format adds server-origin detection for multi-region.
 * See Bridgebuilder PR #47 Comment 4.
 *
 * @see SDD §4.6.1 SSE Event IDs
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Parsed result from a Last-Event-ID header */
export interface ParsedEventId {
  /** The sequence number portion */
  sequence: number;
  /** The server ID portion (undefined for monotonic format) */
  serverId?: string;
}

/** SSE Event ID generator interface */
export interface SseEventIdGenerator {
  /** Generate the next event ID string */
  next(): string;
  /**
   * Create a new generator that continues from a Last-Event-ID.
   * For same-server resume, continues from that sequence.
   * For cross-server (serverId mismatch), returns a fresh generator
   * starting from 0 — the STREAM_RESUME_LOST FSM handles the reconnect.
   */
  fromLastEventId(lastId: string): SseEventIdGenerator;
}

// --------------------------------------------------------------------------
// Parser
// --------------------------------------------------------------------------

/**
 * Parse a Last-Event-ID header value into sequence + optional serverId.
 * Handles both monotonic ("42") and composite ("srv1:42") formats.
 *
 * @param id - The raw Last-Event-ID string
 * @returns Parsed event ID with sequence and optional serverId
 */
export function parseLastEventId(id: string): ParsedEventId {
  const colonIdx = id.indexOf(':');
  if (colonIdx === -1) {
    // Monotonic format: "42"
    const sequence = parseInt(id, 10);
    return { sequence: Number.isFinite(sequence) ? sequence : 0 };
  }

  // Composite format: "srv1:42"
  const serverId = id.slice(0, colonIdx);
  const sequence = parseInt(id.slice(colonIdx + 1), 10);
  return {
    sequence: Number.isFinite(sequence) ? sequence : 0,
    serverId: serverId || undefined,
  };
}

// --------------------------------------------------------------------------
// Monotonic Generator (default, single-server)
// --------------------------------------------------------------------------

/**
 * Monotonic integer counter — current behavior.
 * Emits: "1", "2", "3", ...
 */
export class MonotonicEventIdGenerator implements SseEventIdGenerator {
  private seq: number;

  constructor(startFrom = 0) {
    this.seq = startFrom;
  }

  next(): string {
    return String(++this.seq);
  }

  fromLastEventId(lastId: string): SseEventIdGenerator {
    const parsed = parseLastEventId(lastId);
    return new MonotonicEventIdGenerator(parsed.sequence);
  }
}

// --------------------------------------------------------------------------
// Composite Generator (multi-region)
// --------------------------------------------------------------------------

/**
 * Composite event ID with server origin — for multi-region deployments.
 * Emits: "srv1:1", "srv1:2", "srv1:3", ...
 *
 * Clients can detect server switches by comparing the serverId prefix.
 * Cross-server reconnect defers to STREAM_RESUME_LOST FSM (no replay buffer).
 *
 * F-3 Contract: serverId MUST be a short, stable identifier (e.g., AWS region
 * like "us-east-1" or a hostname slug). Recommended max length: 32 chars.
 * The SSE spec does not define a max length for the `id` field, but some client
 * libraries may truncate long IDs. Avoid UUIDs or other long-form identifiers.
 * The sequence portion uses JavaScript `number` (safe to 2^53 - 1 = ~285,616
 * years at 1000 events/sec).
 */
export class CompositeEventIdGenerator implements SseEventIdGenerator {
  private seq: number;
  private readonly serverId: string;

  constructor(serverId: string, startFrom = 0) {
    this.serverId = serverId;
    this.seq = startFrom;
  }

  next(): string {
    return `${this.serverId}:${++this.seq}`;
  }

  fromLastEventId(lastId: string): SseEventIdGenerator {
    const parsed = parseLastEventId(lastId);

    if (parsed.serverId && parsed.serverId !== this.serverId) {
      // Different server — start fresh. STREAM_RESUME_LOST handles reconnect.
      return new CompositeEventIdGenerator(this.serverId, 0);
    }

    // Same server or monotonic format — continue from last sequence
    return new CompositeEventIdGenerator(this.serverId, parsed.sequence);
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create an event ID generator based on configuration.
 * Returns Monotonic by default, Composite when SSE_SERVER_ID env var is set.
 *
 * @param config - Optional config override
 * @returns Event ID generator instance
 */
export function createEventIdGenerator(config?: { serverId?: string }): SseEventIdGenerator {
  const serverId = config?.serverId ?? process.env.SSE_SERVER_ID;
  if (serverId) {
    return new CompositeEventIdGenerator(serverId);
  }
  return new MonotonicEventIdGenerator();
}
