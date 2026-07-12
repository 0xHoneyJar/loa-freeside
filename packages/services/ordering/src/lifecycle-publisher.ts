import type { OrderStore } from './store.js';

/**
 * Lifecycle event publisher PORT (SDD §13 H-4 / M-10).
 *
 * Events are drained FROM the durable outbox and published here — the orchestrator never
 * publishes directly (no dual-write). The MVP path uses any `LifecyclePublisher`; the
 * production adapter wraps each payload in the Hounfour signed envelope (ed25519 + JCS,
 * `@freeside/events`) and publishes to durable JetStream. Lifecycle SIGNING is sequenced
 * after the first useful order (SDD §13 M-10) and swaps in HERE, behind this interface.
 */
export interface LifecyclePublisher {
  publish(subject: string, payload: unknown): Promise<void>;
}

/** Test/dev publisher that records what it would have published. */
export class RecordingPublisher implements LifecyclePublisher {
  readonly published: Array<{ subject: string; payload: unknown }> = [];
  async publish(subject: string, payload: unknown): Promise<void> {
    this.published.push({ subject, payload });
  }
}

/**
 * Drain the outbox: publish each pending event, then mark it published.
 *
 * `markPublished` runs only AFTER a successful publish, so a crash between publish and mark
 * re-publishes on restart — at-least-once, consumers dedupe by `order_id` + subject. This is
 * the H-4 guarantee: a terminal event always reaches the topic from durable stored state,
 * even if the process died after persisting but before publishing.
 */
export async function publishOutbox(store: OrderStore, publisher: LifecyclePublisher): Promise<number> {
  const pending = await store.pendingOutbox();
  for (const entry of pending) {
    await publisher.publish(entry.subject, entry.payload);
    await store.markPublished(entry.seq);
  }
  return pending.length;
}
