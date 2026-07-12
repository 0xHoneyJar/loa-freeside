/**
 * S4-T3 / M-8 — the private signed ops channel.
 *
 * A refusal emits TWO events: the sanitized public `failed.v1` (operator-safe, no internal cause) and
 * a FULL private ops event here (raw cause + correlation id) for diagnosis. Keeping the full cause off
 * the public topic prevents leaking refusal patterns / internal detail (the M-8 split). The concrete
 * publisher signs + routes to a private subject at deploy; the orchestrator depends only on this port.
 */
export interface PrivateOpsEvent {
  order_id: string;
  /** Correlates the private event to the public lifecycle (the order_id for the MVP). */
  correlation_id: string;
  /** The FULL cause — raw code/reason/retryable and any diagnostic fields. Never sanitized. */
  cause: Record<string, unknown>;
}

export interface PrivateOpsPublisher {
  emit(event: PrivateOpsEvent): Promise<void>;
}

/** Test/dev recorder for the private ops channel. */
export class RecordingPrivateOps implements PrivateOpsPublisher {
  readonly events: PrivateOpsEvent[] = [];
  async emit(event: PrivateOpsEvent): Promise<void> {
    this.events.push(event);
  }
}
