/**
 * Tracing Overhead Benchmark
 * Sprint S-13: Distributed Tracing
 *
 * Verifies that tracing overhead is acceptable for production use.
 * Context: Real-world operations (DB queries, RPC calls) take 1-100ms,
 * so tracing overhead in microseconds is negligible (<0.01%).
 *
 * These tests validate absolute performance, not percentage overhead
 * of trivial operations (which would be meaningless).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Tracer,
  createTraceContext,
  runWithTraceContext,
  generateTraceId,
  generateSpanId,
  getCorrelationId,
  resetTracer,
} from '../../../src/infrastructure/tracing/index.js';

// Suppress logging during benchmarks
process.env['LOG_LEVEL'] = 'silent';

// Number of iterations for benchmarks
const ITERATIONS = 10_000;
const WARMUP_ITERATIONS = 1_000;

/**
 * Measure execution time in nanoseconds
 */
function measureNs(fn: () => void, iterations: number): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = process.hrtime.bigint();
  return Number(end - start) / iterations;
}

describe('Tracing Overhead Benchmark', () => {
  let tracer: Tracer;

  beforeAll(async () => {
    await resetTracer();
    tracer = new Tracer({ enabled: true, samplingRate: 1.0 });
  });

  afterAll(async () => {
    await tracer.shutdown();
  });

  describe('ID Generation', () => {
    it('traceId generation should be < 5µs', () => {
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        generateTraceId();
      }

      const avgNs = measureNs(() => generateTraceId(), ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  generateTraceId: ${avgUs.toFixed(2)}µs per call`);
      // 5µs is negligible vs 1-100ms DB/RPC operations
      expect(avgUs).toBeLessThan(5);
    });

    it('spanId generation should be < 5µs', () => {
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        generateSpanId();
      }

      const avgNs = measureNs(() => generateSpanId(), ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  generateSpanId: ${avgUs.toFixed(2)}µs per call`);
      expect(avgUs).toBeLessThan(5);
    });
  });

  describe('Context Operations', () => {
    it('createTraceContext should be < 10µs', () => {
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        createTraceContext();
      }

      const avgNs = measureNs(() => createTraceContext(), ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  createTraceContext: ${avgUs.toFixed(2)}µs per call`);
      // 10µs is negligible vs real work
      expect(avgUs).toBeLessThan(10);
    });

    it('runWithTraceContext absolute overhead should be < 5µs', () => {
      const context = createTraceContext();

      // Very simple baseline to isolate tracing overhead
      const baselineWork = () => 1 + 1;

      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        baselineWork();
        runWithTraceContext(context, baselineWork);
      }

      const baselineNs = measureNs(baselineWork, ITERATIONS);
      const tracedNs = measureNs(
        () => runWithTraceContext(context, baselineWork),
        ITERATIONS
      );

      const overheadUs = (tracedNs - baselineNs) / 1000;

      console.log(`  Baseline: ${(baselineNs / 1000).toFixed(2)}µs`);
      console.log(`  Traced: ${(tracedNs / 1000).toFixed(2)}µs`);
      console.log(`  Absolute overhead: ${overheadUs.toFixed(2)}µs`);

      // The absolute overhead of AsyncLocalStorage context is what matters
      // 5µs overhead is negligible vs 1ms+ real operations
      expect(overheadUs).toBeLessThan(5);
    });

    it('getCorrelationId should be < 1µs', () => {
      const context = createTraceContext();

      runWithTraceContext(context, () => {
        // Warmup
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
          getCorrelationId();
        }

        const avgNs = measureNs(() => getCorrelationId(), ITERATIONS);
        const avgUs = avgNs / 1000;

        console.log(`  getCorrelationId: ${avgUs.toFixed(2)}µs per call`);
        expect(avgUs).toBeLessThan(1);
      });
    });
  });

  describe('Span Operations', () => {
    it('span creation should be < 10µs', () => {
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const span = tracer.startSpan('benchmark');
        span.end();
      }

      const avgNs = measureNs(() => {
        const span = tracer.startSpan('benchmark');
        span.end();
      }, ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  Span create+end: ${avgUs.toFixed(2)}µs per span`);
      expect(avgUs).toBeLessThan(10);
    });

    it('span with attributes should be < 15µs', () => {
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const span = tracer.startSpan('benchmark', {
          attributes: {
            'attr.string': 'value',
            'attr.number': 42,
            'attr.boolean': true,
          },
        });
        span.setAttribute('dynamic', 'value');
        span.end();
      }

      const avgNs = measureNs(() => {
        const span = tracer.startSpan('benchmark', {
          attributes: {
            'attr.string': 'value',
            'attr.number': 42,
            'attr.boolean': true,
          },
        });
        span.setAttribute('dynamic', 'value');
        span.end();
      }, ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  Span with attrs: ${avgUs.toFixed(2)}µs per span`);
      expect(avgUs).toBeLessThan(15);
    });

    it('nested spans should be < 20µs', () => {
      // Warmup
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const parent = tracer.startSpan('parent');
        parent.run(() => {
          const child = tracer.startSpan('child');
          child.end();
        });
        parent.end();
      }

      const avgNs = measureNs(() => {
        const parent = tracer.startSpan('parent');
        parent.run(() => {
          const child = tracer.startSpan('child');
          child.end();
        });
        parent.end();
      }, ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  Nested spans: ${avgUs.toFixed(2)}µs per pair`);
      expect(avgUs).toBeLessThan(20);
    });
  });

  describe('Realistic Workload Overhead', () => {
    it('tracing overhead on 1ms work should be < 5%', () => {
      // Simulate 1ms of work (realistic DB query time)
      const simulateWork = () => {
        const target = Date.now() + 1;
        while (Date.now() < target) {
          // Busy wait to simulate 1ms work
        }
        return 42;
      };

      // Handler without tracing
      const unTracedHandler = () => {
        return simulateWork();
      };

      // Handler with tracing (full instrumentation)
      const tracedHandler = () => {
        return tracer.startActiveSpan('handler', (span) => {
          span.setAttribute('handler.name', 'benchmark');
          const result = simulateWork();
          span.setAttribute('result', result);
          span.addEvent('work_completed');
          return result;
        });
      };

      // Fewer iterations due to 1ms work each
      const iterations = 100;

      // Warmup
      for (let i = 0; i < 10; i++) {
        unTracedHandler();
        tracedHandler();
      }

      const baselineNs = measureNs(unTracedHandler, iterations);
      const tracedNs = measureNs(tracedHandler, iterations);

      const overheadPercent = ((tracedNs - baselineNs) / baselineNs) * 100;
      const overheadUs = (tracedNs - baselineNs) / 1000;

      console.log(`  Baseline (1ms work): ${(baselineNs / 1_000_000).toFixed(2)}ms`);
      console.log(`  Traced: ${(tracedNs / 1_000_000).toFixed(2)}ms`);
      console.log(`  Overhead: ${overheadUs.toFixed(0)}µs (${overheadPercent.toFixed(2)}%)`);

      // With 1ms baseline, 20µs overhead is 2%
      // Target: <5% overhead on realistic operations
      expect(overheadPercent).toBeLessThan(5);
    });
  });

  describe('Disabled Tracing', () => {
    it('disabled tracer should add minimal overhead', async () => {
      const disabledTracer = new Tracer({ enabled: false });

      // NoOpSpan should be nearly instant
      const avgNs = measureNs(() => {
        const span = disabledTracer.startSpan('benchmark');
        span.setAttribute('key', 'value');
        span.end();
      }, ITERATIONS);
      const avgUs = avgNs / 1000;

      console.log(`  Disabled span operations: ${avgUs.toFixed(2)}µs`);

      // Disabled tracer should be extremely fast
      expect(avgUs).toBeLessThan(3);

      await disabledTracer.shutdown();
    });
  });
});
