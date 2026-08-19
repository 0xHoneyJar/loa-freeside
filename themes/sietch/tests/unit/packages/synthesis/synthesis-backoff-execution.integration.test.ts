/**
 * BullMQ custom-backoff EXECUTION proof.
 *
 * The existing coverage checks two things that are necessary but not
 * sufficient: that `customSynthesisBackoff` computes 5s/25s/125s, and that the
 * synthesis workers pass it as `WorkerOptions.settings.backoffStrategy`. Both
 * would still pass if BullMQ read the strategy from somewhere else — which is
 * exactly the defect that motivated the fix (the strategy used to be declared
 * on the *Queue* as a `backoffStrategies` map, which BullMQ 5.x ignores).
 *
 * These tests close that gap against the installed BullMQ by running the real
 * retry path: a job configured `backoff: { type: 'custom' }` whose processor
 * throws must land in the DELAYED set — not fail outright with
 * "Unknown backoff strategy custom" — and the delay must come from our
 * strategy. The negative control asserts the failure mode we are protecting
 * against is real, so the positive test cannot pass vacuously.
 *
 * Reference: bullmq/dist/cjs/classes/job.js — moveToFailed resolves the
 * strategy from `opts.settings && opts.settings.backoffStrategy`, where `opts`
 * is the WORKER's options.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Queue, Worker, type WorkerOptions } from 'bullmq';
import { createRequire } from 'module';

import { customSynthesisBackoff } from '../../../../src/packages/synthesis/SynthesisWorker.js';

const require = createRequire(import.meta.url);
const Redis = require('ioredis');
// Reach into the installed package to exercise BullMQ's own resolution helper.
const { Backoffs } = require('bullmq/dist/cjs/classes/backoffs.js');

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  db: 14,
};

const QUEUE_NAME = 'test-synthesis-backoff';

let redis: InstanceType<typeof Redis>;

beforeAll(() => {
  redis = new Redis(connection.port, connection.host, { db: connection.db });
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

/** Resolve a job's remaining delay, in ms, from the delayed-set entry. */
function remainingDelay(job: { delay?: number; timestamp?: number }): number {
  return typeof job.delay === 'number' ? job.delay : Number.NaN;
}

describe('BullMQ custom backoff — resolution', () => {
  it('BullMQ resolves backoff.type "custom" from the WORKER settings we register', () => {
    // This is the exact call bullmq makes in Job.moveToFailed.
    const opts = { settings: { backoffStrategy: customSynthesisBackoff } };

    for (const [attempt, expected] of [[1, 5000], [2, 25000], [3, 125000]] as const) {
      const delay = Backoffs.calculate(
        { type: 'custom' }, attempt, new Error('boom'), {}, opts.settings.backoffStrategy,
      );
      expect(delay).toBe(expected);
    }
  });

  it('throws "Unknown backoff strategy" when the strategy is NOT on the worker settings', () => {
    // Negative control: the pre-fix state (strategy declared queue-side only).
    // Without this, the positive test above could pass vacuously.
    expect(() =>
      Backoffs.calculate({ type: 'custom' }, 1, new Error('boom'), {}, undefined),
    ).toThrow(/Unknown backoff strategy custom/);
  });
});

describe('BullMQ custom backoff — live execution', () => {
  it('retries a failing custom-backoff job into the delayed set using our schedule', async () => {
    const queue = new Queue(QUEUE_NAME, { connection });
    let attempts = 0;
    const workerErrors: string[] = [];

    const options: WorkerOptions = {
      connection,
      // The one line under test — same shape as both synthesis workers.
      settings: { backoffStrategy: customSynthesisBackoff },
    };

    const worker = new Worker(QUEUE_NAME, async () => {
      attempts += 1;
      throw new Error('rate limit timeout');
    }, options);
    worker.on('error', (e) => workerErrors.push(String(e?.message ?? e)));

    try {
      await queue.add('synth', { any: 'payload' }, {
        attempts: 3,
        backoff: { type: 'custom' },
      });

      // Wait for the first attempt to fail and be rescheduled.
      const delayed = await waitFor(async () => {
        const jobs = await queue.getDelayed();
        return jobs.length === 1 ? jobs : null;
      });

      expect(attempts).toBe(1);
      // The retry was SCHEDULED, not abandoned…
      expect(await queue.getFailedCount()).toBe(0);
      // …with our strategy's first interval, not a built-in default.
      expect(remainingDelay(delayed[0])).toBe(customSynthesisBackoff(1));
      // …and BullMQ never hit the unknown-strategy path.
      expect(workerErrors.filter((m) => /Unknown backoff strategy/.test(m))).toEqual([]);
    } finally {
      await worker.close();
      await queue.close();
    }
  }, 20_000);

  it('surfaces "Unknown backoff strategy" when a worker omits the registration', async () => {
    // Negative control on the live path: proves the delayed-set outcome above
    // is caused by the registration and not by BullMQ defaulting somewhere.
    const queue = new Queue(QUEUE_NAME, { connection });
    const workerErrors: string[] = [];

    const worker = new Worker(QUEUE_NAME, async () => {
      throw new Error('rate limit timeout');
    }, { connection }); // no settings.backoffStrategy
    worker.on('error', (e) => workerErrors.push(String(e?.message ?? e)));

    try {
      await queue.add('synth', { any: 'payload' }, {
        attempts: 3,
        backoff: { type: 'custom' },
      });

      await waitFor(async () =>
        workerErrors.some((m) => /Unknown backoff strategy/.test(m)) ? true : null,
      );

      // Nothing was scheduled for retry — the job is stuck, which is the
      // failure this registration exists to prevent.
      expect(await queue.getDelayedCount()).toBe(0);
    } finally {
      await worker.close();
      await queue.close();
    }
  }, 20_000);
});

/** Poll until `probe` returns a non-null value, or time out. */
async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for BullMQ state');
    await new Promise((r) => setTimeout(r, 50));
  }
}
