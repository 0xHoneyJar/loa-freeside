/**
 * Tracer Tests
 * Sprint S-13: Distributed Tracing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Tracer,
  ConsoleSpanProcessor,
  BufferedSpanProcessor,
  initTracer,
  getTracer,
  resetTracer,
} from '../../../src/infrastructure/tracing/Tracer.js';
import { SpanKind, SpanStatus, AttributeKeys } from '../../../src/infrastructure/tracing/types.js';
import { runWithTraceContext, createTraceContext, getCurrentTraceContext } from '../../../src/infrastructure/tracing/TraceContext.js';
import type { SpanData } from '../../../src/infrastructure/tracing/types.js';

describe('Tracer', () => {
  beforeEach(async () => {
    await resetTracer();
  });

  afterEach(async () => {
    await resetTracer();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const tracer = new Tracer();
      const config = tracer.getConfig();

      expect(config.serviceName).toBe('arrakis-worker');
      expect(config.enabled).toBe(true);
      expect(config.samplingRate).toBe(1.0);
    });

    it('should merge custom config', () => {
      const tracer = new Tracer({
        serviceName: 'custom-service',
        samplingRate: 0.5,
      });

      const config = tracer.getConfig();
      expect(config.serviceName).toBe('custom-service');
      expect(config.samplingRate).toBe(0.5);
    });

    it('should add console processor when logSpans is true', () => {
      const tracer = new Tracer({ logSpans: true });
      const span = tracer.startSpan('test');

      // Should not throw with console processor
      span.end();
    });
  });

  describe('startSpan', () => {
    it('should create span with name', () => {
      const tracer = new Tracer();
      const span = tracer.startSpan('test-span');

      expect(span.name).toBe('test-span');
      expect(span.context.traceId).toHaveLength(32);
    });

    it('should add resource attributes', () => {
      const tracer = new Tracer({
        serviceName: 'test-service',
        serviceVersion: '2.0.0',
        environment: 'test',
      });

      const span = tracer.startSpan('test');
      const data = span.getData();

      expect(data.attributes[AttributeKeys.SERVICE_NAME]).toBe('test-service');
      expect(data.attributes[AttributeKeys.SERVICE_VERSION]).toBe('2.0.0');
      expect(data.attributes[AttributeKeys.DEPLOYMENT_ENVIRONMENT]).toBe('test');
    });

    it('should merge provided attributes', () => {
      const tracer = new Tracer();
      const span = tracer.startSpan('test', {
        attributes: { custom: 'value' },
      });

      expect(span.getData().attributes['custom']).toBe('value');
    });

    it('should use parent context when available', () => {
      const tracer = new Tracer();
      const parent = createTraceContext();

      runWithTraceContext(parent, () => {
        const span = tracer.startSpan('child');

        expect(span.context.traceId).toBe(parent.traceId);
        expect(span.context.parentSpanId).toBe(parent.spanId);
      });
    });

    it('should use explicit parent context', () => {
      const tracer = new Tracer();
      const parent = createTraceContext();

      const span = tracer.startSpan('test', { parentContext: parent });

      expect(span.context.traceId).toBe(parent.traceId);
      expect(span.context.parentSpanId).toBe(parent.spanId);
    });

    it('should return NoOpSpan when disabled', () => {
      const tracer = new Tracer({ enabled: false });
      const span = tracer.startSpan('test');

      expect(span.name).toBe('noop');
    });

    it('should return NoOpSpan when not sampled', () => {
      const tracer = new Tracer({ samplingRate: 0 });
      const span = tracer.startSpan('test');

      expect(span.name).toBe('noop');
    });

    it('should sample child if parent is sampled', () => {
      const tracer = new Tracer({ samplingRate: 0 });
      const parent = createTraceContext(undefined, true); // Force sampled

      const span = tracer.startSpan('test', { parentContext: parent });

      // Should be real span because parent is sampled
      expect(span.name).toBe('test');
    });

    it('should notify processors on start', () => {
      const processor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const tracer = new Tracer();
      tracer.addProcessor(processor);

      const span = tracer.startSpan('test');

      expect(processor.onStart).toHaveBeenCalledTimes(1);
      expect(processor.onStart).toHaveBeenCalledWith(span.getData());
    });
  });

  describe('span end processing', () => {
    it('should notify processors on end', () => {
      const processor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const tracer = new Tracer();
      tracer.addProcessor(processor);

      const span = tracer.startSpan('test');
      span.end();

      expect(processor.onEnd).toHaveBeenCalledTimes(1);
    });

    it('should handle processor errors gracefully', () => {
      const processor = {
        onStart: vi.fn().mockImplementation(() => {
          throw new Error('Processor error');
        }),
        onEnd: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const tracer = new Tracer();
      tracer.addProcessor(processor);

      // Should not throw
      expect(() => tracer.startSpan('test')).not.toThrow();
    });
  });

  describe('startActiveSpan', () => {
    it('should execute function with span context', () => {
      const tracer = new Tracer();
      let capturedContext: ReturnType<typeof getCurrentTraceContext>;

      tracer.startActiveSpan('test', (span) => {
        capturedContext = getCurrentTraceContext();
        expect(capturedContext?.spanId).toBe(span.context.spanId);
      });

      expect(capturedContext!).toBeDefined();
    });

    it('should return function result', () => {
      const tracer = new Tracer();
      const result = tracer.startActiveSpan('test', () => 'result');

      expect(result).toBe('result');
    });

    it('should end span after function', () => {
      const tracer = new Tracer();
      let capturedSpan: ReturnType<typeof tracer.startSpan>;

      tracer.startActiveSpan('test', (span) => {
        capturedSpan = span;
      });

      expect(capturedSpan!.isEnded).toBe(true);
    });

    it('should end span on exception', () => {
      const tracer = new Tracer();
      let capturedSpan: ReturnType<typeof tracer.startSpan>;

      try {
        tracer.startActiveSpan('test', (span) => {
          capturedSpan = span;
          throw new Error('Test');
        });
      } catch {
        // Ignore
      }

      expect(capturedSpan!.isEnded).toBe(true);
    });
  });

  describe('startActiveSpanAsync', () => {
    it('should execute async function with span context', async () => {
      const tracer = new Tracer();

      await tracer.startActiveSpanAsync('test', async (span) => {
        const ctx = getCurrentTraceContext();
        expect(ctx?.spanId).toBe(span.context.spanId);
      });
    });

    it('should return async result', async () => {
      const tracer = new Tracer();
      const result = await tracer.startActiveSpanAsync('test', async () => 'async-result');

      expect(result).toBe('async-result');
    });

    it('should end span after async function', async () => {
      const tracer = new Tracer();
      let capturedSpan: ReturnType<typeof tracer.startSpan>;

      await tracer.startActiveSpanAsync('test', async (span) => {
        capturedSpan = span;
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(capturedSpan!.isEnded).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should return correlation ID', () => {
      const tracer = new Tracer();

      tracer.startActiveSpan('test', () => {
        const id = tracer.getCorrelationId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
      });
    });

    it('should check if sampled', () => {
      const tracer = new Tracer();

      tracer.startActiveSpan('test', () => {
        expect(tracer.isCurrentTraceSampled()).toBe(true);
      });
    });

    it('should get current context', () => {
      const tracer = new Tracer();

      tracer.startActiveSpan('test', (span) => {
        const ctx = tracer.getCurrentContext();
        expect(ctx?.spanId).toBe(span.context.spanId);
      });
    });

    it('should create root context', () => {
      const tracer = new Tracer();
      const ctx = tracer.createRootContext();

      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.parentSpanId).toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown all processors', async () => {
      const processor1 = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const processor2 = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      const tracer = new Tracer();
      tracer.addProcessor(processor1);
      tracer.addProcessor(processor2);

      await tracer.shutdown();

      expect(processor1.shutdown).toHaveBeenCalledTimes(1);
      expect(processor2.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should handle processor shutdown errors', async () => {
      const processor = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        shutdown: vi.fn().mockRejectedValue(new Error('Shutdown error')),
      };

      const tracer = new Tracer();
      tracer.addProcessor(processor);

      // Should not throw
      await expect(tracer.shutdown()).resolves.not.toThrow();
    });
  });
});

describe('ConsoleSpanProcessor', () => {
  it('should log on start and end', () => {
    const processor = new ConsoleSpanProcessor();
    const spanData: SpanData = {
      name: 'test',
      kind: SpanKind.INTERNAL,
      context: {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1,
      },
      startTime: Date.now(),
      status: SpanStatus.OK,
      attributes: {},
      events: [],
    };

    // Should not throw
    expect(() => {
      processor.onStart(spanData);
      processor.onEnd({ ...spanData, endTime: Date.now() });
    }).not.toThrow();
  });

  it('should shutdown without error', async () => {
    const processor = new ConsoleSpanProcessor();
    await expect(processor.shutdown()).resolves.not.toThrow();
  });
});

describe('BufferedSpanProcessor', () => {
  it('should buffer spans', async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const processor = new BufferedSpanProcessor(onFlush, 10, 60000);

    const spanData: SpanData = {
      name: 'test',
      kind: SpanKind.INTERNAL,
      context: {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1,
      },
      startTime: Date.now(),
      endTime: Date.now(),
      status: SpanStatus.OK,
      attributes: {},
      events: [],
    };

    processor.onEnd(spanData);
    processor.onEnd(spanData);
    processor.onEnd(spanData);

    // Not flushed yet (buffer size is 10)
    expect(onFlush).not.toHaveBeenCalled();

    await processor.shutdown();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(expect.arrayContaining([spanData]));
  });

  it('should flush when buffer is full', async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const processor = new BufferedSpanProcessor(onFlush, 3, 60000);

    const spanData: SpanData = {
      name: 'test',
      kind: SpanKind.INTERNAL,
      context: {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1,
      },
      startTime: Date.now(),
      endTime: Date.now(),
      status: SpanStatus.OK,
      attributes: {},
      events: [],
    };

    processor.onEnd(spanData);
    processor.onEnd(spanData);
    processor.onEnd(spanData); // Buffer full, should trigger flush

    // Wait for async flush
    await new Promise((r) => setTimeout(r, 50));

    expect(onFlush).toHaveBeenCalledTimes(1);
    await processor.shutdown();
  });
});

describe('Global tracer', () => {
  beforeEach(async () => {
    await resetTracer();
  });

  afterEach(async () => {
    await resetTracer();
  });

  it('should initialize global tracer', () => {
    const tracer = initTracer({ serviceName: 'test' });
    expect(tracer.getConfig().serviceName).toBe('test');
  });

  it('should return existing tracer on re-init', () => {
    const tracer1 = initTracer({ serviceName: 'first' });
    const tracer2 = initTracer({ serviceName: 'second' });

    expect(tracer2).toBe(tracer1);
    expect(tracer2.getConfig().serviceName).toBe('first');
  });

  it('should get or create global tracer', () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();

    const same = getTracer();
    expect(same).toBe(tracer);
  });

  it('should reset global tracer', async () => {
    const tracer1 = initTracer({ serviceName: 'first' });
    await resetTracer();
    const tracer2 = initTracer({ serviceName: 'second' });

    expect(tracer2).not.toBe(tracer1);
    expect(tracer2.getConfig().serviceName).toBe('second');
  });
});
