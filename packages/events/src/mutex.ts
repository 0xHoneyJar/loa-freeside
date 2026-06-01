/**
 * Minimal per-instance async mutex (cycle-112 T1.4).
 *
 * `makeEmitter` holds ONE `Mutex` per cell so that a cell's concurrent emits
 * serialize the `get(prevHash) -> sign -> publish -> set(newHash)` sequence and
 * cannot interleave-fork the hash chain (Flatline SDD SKP-001).
 *
 * Critically, `withLock` bounds how long the critical section may hold the lock
 * (`timeoutMs`). The Flatline SPRINT review (SKP-002) flagged that a NATS
 * publish can stall — slow-consumer penalty, buffer-full backpressure, network
 * partition — and a naive mutex would then make every subsequent emit hang
 * forever. Here the held operation is raced against `timeoutMs`: if it exceeds,
 * `withLock` rejects with {@link TimeoutError} AND releases the lock in
 * `finally`, so the queue drains. (A JS promise cannot be truly cancelled, so a
 * genuinely-hung operation keeps running detached — but it no longer blocks the
 * chain.)
 */

export class TimeoutError extends Error {
  readonly _tag = "TimeoutError";
  constructor(
    readonly phase: "operation",
    readonly timeoutMs: number,
  ) {
    super(`[events] mutex ${phase} exceeded ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;

interface WithLockOptions {
  /** Max time the critical section may hold the lock before it is abandoned
   *  (lock released, {@link TimeoutError} raised). Default 5000ms. */
  readonly timeoutMs?: number;
}

export class Mutex {
  /** Resolves when the current holder releases. A promise chain models the
   *  FIFO queue: each `withLock` waits on the prior tail, then becomes the tail. */
  #tail: Promise<void> = Promise.resolve();

  /**
   * Run `fn` while holding the lock. Waiters acquire in FIFO order. The lock is
   * ALWAYS released after `fn` settles or times out (`finally`).
   */
  async withLock<T>(fn: () => Promise<T>, opts: WithLockOptions = {}): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;

    // Reserve our slot: the next waiter will wait on `released`.
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const priorTail = this.#tail;
    this.#tail = priorTail.then(() => released);

    // Wait for our turn (the prior holder to release). `priorTail` never rejects
    // — holders always release in `finally` — so this cannot deadlock on a throw.
    await priorTail;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError("operation", timeoutMs)), timeoutMs);
        fn().then(resolve, reject);
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release(); // drains the queue even if `fn` timed out / threw / hung
    }
  }
}
