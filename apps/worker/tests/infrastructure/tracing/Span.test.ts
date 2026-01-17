/**
 * Span Tests
 * Sprint S-13: Distributed Tracing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Span, NoOpSpan, withSpan, withSpanAsync } from '../../../src/infrastructure/tracing/Span.js';
import { SpanKind, SpanStatus } from '../../../src/infrastructure/tracing/types.js';
import { getCurrentTraceContext, runWithTraceContext, createTraceContext } from '../../../src/infrastructure/tracing/TraceContext.js';

describe('Span', () => {
  describe('constructor', () => {
    it('should create span with name', () => {
      const span = new Span('test-span');

      expect(span.name).toBe('test-span');
      expect(span.context.traceId).toHaveLength(32);
      expect(span.context.spanId).toHaveLength(16);
      expect(span.isEnded).toBe(false);
    });

    it('should use default kind INTERNAL', () => {
      const span = new Span('test');
      expect(span.getData().kind).toBe(SpanKind.INTERNAL);
    });

    it('should use provided kind', () => {
      const span = new Span('test', { kind: SpanKind.SERVER });
      expect(span.getData().kind).toBe(SpanKind.SERVER);
    });

    it('should use provided start time', () => {
      const startTime = Date.now() - 1000;
      const span = new Span('test', { startTime });

      expect(span.getData().startTime).toBe(startTime);
    });

    it('should inherit trace ID from parent context', () => {
      const parent = createTraceContext();

      runWithTraceContext(parent, () => {
        const span = new Span('child');

        expect(span.context.traceId).toBe(parent.traceId);
        expect(span.context.parentSpanId).toBe(parent.spanId);
      });
    });

    it('should use explicit parent context', () => {
      const parent = createTraceContext();
      const span = new Span('test', { parentContext: parent });

      expect(span.context.traceId).toBe(parent.traceId);
      expect(span.context.parentSpanId).toBe(parent.spanId);
    });

    it('should apply initial attributes', () => {
      const span = new Span('test', {
        attributes: {
          'attr.string': 'value',
          'attr.number': 42,
        },
      });

      const data = span.getData();
      expect(data.attributes['attr.string']).toBe('value');
      expect(data.attributes['attr.number']).toBe(42);
    });
  });

  describe('attributes', () => {
    it('should set single attribute', () => {
      const span = new Span('test');
      span.setAttribute('key', 'value');

      expect(span.getData().attributes['key']).toBe('value');
    });

    it('should return this for chaining', () => {
      const span = new Span('test');
      const result = span.setAttribute('key', 'value');

      expect(result).toBe(span);
    });

    it('should set multiple attributes', () => {
      const span = new Span('test');
      span.setAttributes({
        'key1': 'value1',
        'key2': 42,
        'key3': true,
      });

      const attrs = span.getData().attributes;
      expect(attrs['key1']).toBe('value1');
      expect(attrs['key2']).toBe(42);
      expect(attrs['key3']).toBe(true);
    });

    it('should not set attributes after end', () => {
      const span = new Span('test');
      span.end();
      span.setAttribute('key', 'value');

      expect(span.getData().attributes['key']).toBeUndefined();
    });
  });

  describe('events', () => {
    it('should add event', () => {
      const span = new Span('test');
      span.addEvent('event-name');

      const events = span.getData().events;
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('event-name');
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it('should add event with attributes', () => {
      const span = new Span('test');
      span.addEvent('event', { key: 'value' });

      const events = span.getData().events;
      expect(events[0].attributes).toEqual({ key: 'value' });
    });

    it('should not add events after end', () => {
      const span = new Span('test');
      span.end();
      span.addEvent('event');

      expect(span.getData().events).toHaveLength(0);
    });
  });

  describe('status', () => {
    it('should have UNSET status by default', () => {
      const span = new Span('test');
      expect(span.getData().status).toBe(SpanStatus.UNSET);
    });

    it('should set OK status', () => {
      const span = new Span('test');
      span.setOk();

      expect(span.getData().status).toBe(SpanStatus.OK);
    });

    it('should set ERROR status', () => {
      const span = new Span('test');
      span.setError();

      expect(span.getData().status).toBe(SpanStatus.ERROR);
    });

    it('should set ERROR status with message', () => {
      const span = new Span('test');
      span.setError('Something went wrong');

      const data = span.getData();
      expect(data.status).toBe(SpanStatus.ERROR);
      expect(data.statusMessage).toBe('Something went wrong');
    });

    it('should not set status after end', () => {
      const span = new Span('test');
      span.setOk();
      span.end();
      span.setError();

      expect(span.getData().status).toBe(SpanStatus.OK);
    });
  });

  describe('recordException', () => {
    it('should record exception', () => {
      const span = new Span('test');
      const error = new Error('Test error');

      span.recordException(error);

      const data = span.getData();
      expect(data.status).toBe(SpanStatus.ERROR);
      expect(data.statusMessage).toBe('Test error');

      const events = data.events;
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('exception');
      expect(events[0].attributes?.['exception.type']).toBe('Error');
      expect(events[0].attributes?.['exception.message']).toBe('Test error');
      expect(events[0].attributes?.['exception.stacktrace']).toBeDefined();
    });

    it('should not record after end', () => {
      const span = new Span('test');
      span.end();
      span.recordException(new Error('Test'));

      expect(span.getData().events).toHaveLength(0);
    });
  });

  describe('end', () => {
    it('should set end time', () => {
      const span = new Span('test');
      const before = Date.now();
      span.end();
      const after = Date.now();

      const endTime = span.getData().endTime;
      expect(endTime).toBeGreaterThanOrEqual(before);
      expect(endTime).toBeLessThanOrEqual(after);
    });

    it('should use provided end time', () => {
      const span = new Span('test');
      const endTime = Date.now() + 1000;
      span.end(endTime);

      expect(span.getData().endTime).toBe(endTime);
    });

    it('should mark span as ended', () => {
      const span = new Span('test');
      expect(span.isEnded).toBe(false);

      span.end();
      expect(span.isEnded).toBe(true);
    });

    it('should call onEnd callback', () => {
      const onEnd = vi.fn();
      const span = new Span('test', {}, onEnd);

      span.end();

      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenCalledWith(span.getData());
    });

    it('should only end once', () => {
      const onEnd = vi.fn();
      const span = new Span('test', {}, onEnd);

      span.end();
      span.end();
      span.end();

      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('duration', () => {
    it('should return 0 if not ended', () => {
      const span = new Span('test');
      expect(span.duration).toBe(0);
    });

    it('should return duration after end', () => {
      const startTime = Date.now() - 100;
      const span = new Span('test', { startTime });
      span.end();

      expect(span.duration).toBeGreaterThanOrEqual(100);
    });
  });

  describe('run', () => {
    it('should run function within span context', () => {
      const span = new Span('parent');

      span.run(() => {
        const ctx = getCurrentTraceContext();
        expect(ctx?.traceId).toBe(span.context.traceId);
        expect(ctx?.spanId).toBe(span.context.spanId);
      });
    });

    it('should return function result', () => {
      const span = new Span('test');
      const result = span.run(() => 'result');

      expect(result).toBe('result');
    });
  });

  describe('runAsync', () => {
    it('should run async function within span context', async () => {
      const span = new Span('parent');

      await span.runAsync(async () => {
        const ctx = getCurrentTraceContext();
        expect(ctx?.traceId).toBe(span.context.traceId);
      });
    });

    it('should return promise result', async () => {
      const span = new Span('test');
      const result = await span.runAsync(async () => 'async-result');

      expect(result).toBe('async-result');
    });
  });

  describe('createChild', () => {
    it('should create child span', () => {
      const parent = new Span('parent');
      const child = parent.createChild('child');

      expect(child.context.traceId).toBe(parent.context.traceId);
      expect(child.context.parentSpanId).toBe(parent.context.spanId);
      expect(child.context.spanId).not.toBe(parent.context.spanId);
    });

    it('should pass options to child', () => {
      const parent = new Span('parent');
      const child = parent.createChild('child', {
        kind: SpanKind.CLIENT,
        attributes: { key: 'value' },
      });

      expect(child.getData().kind).toBe(SpanKind.CLIENT);
      expect(child.getData().attributes['key']).toBe('value');
    });
  });
});

describe('NoOpSpan', () => {
  it('should not throw on any operation', () => {
    const span = new NoOpSpan();

    expect(() => {
      span.setAttribute('key', 'value');
      span.setAttributes({ a: 1 });
      span.addEvent('event');
      span.setOk();
      span.setError('error');
      span.recordException(new Error('test'));
      span.end();
    }).not.toThrow();
  });

  it('should return this for chaining', () => {
    const span = new NoOpSpan();

    expect(span.setAttribute('key', 'value')).toBe(span);
    expect(span.setAttributes({})).toBe(span);
    expect(span.addEvent('event')).toBe(span);
    expect(span.setOk()).toBe(span);
    expect(span.setError()).toBe(span);
    expect(span.recordException(new Error())).toBe(span);
  });
});

describe('withSpan', () => {
  it('should execute function and end span', () => {
    const onEnd = vi.fn();
    const span = new Span('test', {}, onEnd);

    const result = withSpan(span, () => 'result');

    expect(result).toBe('result');
    expect(span.isEnded).toBe(true);
    expect(span.getData().status).toBe(SpanStatus.OK);
  });

  it('should record exception on error', () => {
    const span = new Span('test');

    expect(() => {
      withSpan(span, () => {
        throw new Error('Test error');
      });
    }).toThrow('Test error');

    expect(span.isEnded).toBe(true);
    expect(span.getData().status).toBe(SpanStatus.ERROR);
  });

  it('should run in span context', () => {
    const span = new Span('test');
    let capturedContext: ReturnType<typeof getCurrentTraceContext>;

    withSpan(span, () => {
      capturedContext = getCurrentTraceContext();
    });

    expect(capturedContext!.spanId).toBe(span.context.spanId);
  });
});

describe('withSpanAsync', () => {
  it('should execute async function and end span', async () => {
    const span = new Span('test');

    const result = await withSpanAsync(span, async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'async-result';
    });

    expect(result).toBe('async-result');
    expect(span.isEnded).toBe(true);
    expect(span.getData().status).toBe(SpanStatus.OK);
  });

  it('should record exception on async error', async () => {
    const span = new Span('test');

    await expect(
      withSpanAsync(span, async () => {
        throw new Error('Async error');
      })
    ).rejects.toThrow('Async error');

    expect(span.isEnded).toBe(true);
    expect(span.getData().status).toBe(SpanStatus.ERROR);
  });
});
