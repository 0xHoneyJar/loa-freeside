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

  it("SKP-002: the CALLER is unblocked at timeout, even while the op is still in flight", async () => {
    const m = new Mutex();
    let resolveOp!: () => void;
    const opGate = new Promise<void>((r) => (resolveOp = r));
    // The op does not settle until we let it; the CALLER must still get a
    // TimeoutError at timeoutMs rather than hang.
    const first = m.withLock(() => opGate, { timeoutMs: 20 });
    await assert.rejects(first, (err: unknown) => err instanceof TimeoutError);
    resolveOp(); // settle the op so the lock releases (cleanup)
  });

  it("SKP-001/F2: a timed-out op HOLDS the chain until it settles — next op waits, no fork", async () => {
    const m = new Mutex();
    const order: string[] = [];
    let resolveA!: () => void;
    const aGate = new Promise<void>((r) => (resolveA = r));

    const a = m.withLock(
      async () => {
        await aGate;
        order.push("A");
      },
      { timeoutMs: 20 },
    );
    const b = m.withLock(async () => void order.push("B"), { timeoutMs: 1000 });

    await assert.rejects(a, (err: unknown) => err instanceof TimeoutError); // A's caller unblocked
    await tick(30);
    // The fork-prevention guarantee: B must NOT have run while A's op is still
    // in flight (the lock is held until A settles, NOT freed on timeout).
    assert.deepEqual(order, [], "B must not proceed while the timed-out op is still in flight");

    resolveA();
    await b;
    assert.deepEqual(order, ["A", "B"], "B runs only after A settles → no chain fork");
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
