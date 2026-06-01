import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Mutex, TimeoutError } from "../src/mutex.js";

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("Mutex (T1.4, SKP-001/SKP-002)", () => {
  it("serializes concurrent critical sections (no interleave)", async () => {
    const m = new Mutex();
    const log: string[] = [];
    const section = (name: string) =>
      m.withLock(async () => {
        log.push(`${name}:start`);
        await tick(10);
        log.push(`${name}:end`);
      });

    await Promise.all([section("A"), section("B"), section("C")]);

    // Each section's start must be immediately followed by its own end.
    assert.deepEqual(log, ["A:start", "A:end", "B:start", "B:end", "C:start", "C:end"]);
  });

  it("preserves FIFO acquisition order", async () => {
    const m = new Mutex();
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => m.withLock(async () => void order.push(n))));
    assert.deepEqual(order, [1, 2, 3, 4]);
  });

  it("SKP-002: a stalled operation times out, releases the lock, and the queue drains", async () => {
    const m = new Mutex();
    let secondRan = false;

    // First op never resolves; bounded by a short timeout.
    const first = m.withLock(() => new Promise<void>(() => {}), { timeoutMs: 30 });
    // Second op is queued behind the stalled first.
    const second = m.withLock(async () => {
      secondRan = true;
    });

    await assert.rejects(first, (err: unknown) => err instanceof TimeoutError);
    await second; // must NOT hang — the lock was released on timeout
    assert.equal(secondRan, true, "queue drained after the stalled op timed out");
  });

  it("releases the lock when the operation throws", async () => {
    const m = new Mutex();
    await assert.rejects(
      m.withLock(async () => {
        throw new Error("boom");
      }),
    );
    // Next acquire must still succeed.
    let ran = false;
    await m.withLock(async () => {
      ran = true;
    });
    assert.equal(ran, true);
  });
});
