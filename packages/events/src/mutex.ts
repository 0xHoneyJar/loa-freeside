/**
 * Minimal per-instance async mutex (cycle-112 T1.4).
 *
 * `makeEmitter` holds ONE `Mutex` per cell so that a cell's concurrent emits
 * serialize the `get(prevHash) -> sign -> publish -> set(newHash)` sequence and
 * cannot interleave-fork the hash chain (Flatline SDD SKP-001).
 *
 * Timeout semantics — the SKP-001/SKP-002 reconciliation (BB F2):
 *
 *   `withLock` returns/rejects to the CALLER after `timeoutMs` (so a stalled
 *   publish never hangs the caller — SKP-002), BUT the lock itself is released
 *   only when the operation TRULY settles, never on timeout (SKP-001).
 *
 * The earlier design released the lock on timeout while the detached
 * `publishEnvelope` kept running (JS cannot cancel a promise). A subsequent emit
 * would then acquire the freed lock, read the SAME (not-yet-advanced) prev_hash,
 * and publish — so both ops reach NATS with an identical prev_hash: a hash-chain
 * fork, exactly the SKP-001 guarantee the mutex exists to provide. (Fencing only
 * the sender's `prevHashStore.set` does NOT help: both envelopes still reach the
 * bus with the same prev_hash; the store stays consistent but subscribers see the
 * fork. The only fork-PREVENTING fix is to not let the next op proceed until the
 * in-flight op resolves.)
 *
 * Consequence: a genuinely-hung op (NATS permanently unreachable) holds the
 * chain until it settles. That is the correct trade — you cannot safely advance a
 * hash chain while a prior link's fate is unknown — and it is observable (the
 * caller's TimeoutError flows to emit()'s dead-letter + alert).
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
  /** Max time before `withLock` REJECTS to the caller with {@link TimeoutError}.
   *  The lock is NOT released on timeout — it is held until the operation truly
   *  settles (F2: prevents the chain fork). Default 5000ms. */
  readonly timeoutMs?: number;
}

export class Mutex {
  /** Resolves when the current holder releases. A promise chain models the
   *  FIFO queue: each `withLock` waits on the prior tail, then becomes the tail. */
  #tail: Promise<void> = Promise.resolve();

  /**
   * Run `fn` while holding the lock. Waiters acquire in FIFO order. The lock is
   * released ONLY when `fn` settles (success or failure) — NOT when `timeoutMs`
   * fires. On timeout the caller gets a {@link TimeoutError} but the next waiter
   * stays blocked until `fn` actually resolves (F2: no fork via the timeout door).
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
    // — holders always release on settle — so this cannot deadlock on a throw.
    await priorTail;

    // Start the operation. Bind lock release to the op SETTLING, not to the
    // timeout race below (F2). Both `.then` handlers ignore their argument.
    const op = (async () => fn())();
    void op.then(release, release);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError("operation", timeoutMs)), timeoutMs);
        op.then(resolve, reject);
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // NOTE: the lock is released by `op.then(release, release)` above, when the
      // operation truly settles — deliberately NOT here, so a timed-out op cannot
      // free the chain while its publish is still in flight (F2).
    }
  }
}
