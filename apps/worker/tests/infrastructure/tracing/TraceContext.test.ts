/**
 * TraceContext Tests
 * Sprint S-13: Distributed Tracing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  createTraceContext,
  parseTraceparent,
  formatTraceparent,
  getCurrentTraceContext,
  runWithTraceContext,
  runWithTraceContextAsync,
  getBaggage,
  setBaggage,
  getAllBaggage,
  getContextAttribute,
  setContextAttribute,
  getCorrelationId,
  isTraceSampled,
  extractTraceContextFromHeaders,
  injectTraceContextToHeaders,
} from '../../../src/infrastructure/tracing/TraceContext.js';
import { TraceFlags } from '../../../src/infrastructure/tracing/types.js';

describe('TraceContext', () => {
  describe('generateTraceId', () => {
    it('should generate 32-character hex string', () => {
      const traceId = generateTraceId();
      expect(traceId).toHaveLength(32);
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateSpanId', () => {
    it('should generate 16-character hex string', () => {
      const spanId = generateSpanId();
      expect(spanId).toHaveLength(16);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSpanId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('createTraceContext', () => {
    it('should create new context without parent', () => {
      const ctx = createTraceContext();

      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.spanId).toHaveLength(16);
      expect(ctx.parentSpanId).toBeUndefined();
      expect(ctx.traceFlags).toBe(TraceFlags.SAMPLED);
    });

    it('should create child context from parent', () => {
      const parent = createTraceContext();
      const child = createTraceContext(parent);

      expect(child.traceId).toBe(parent.traceId);
      expect(child.spanId).not.toBe(parent.spanId);
      expect(child.parentSpanId).toBe(parent.spanId);
    });

    it('should propagate traceState from parent', () => {
      const parent = createTraceContext();
      parent.traceState = 'vendor=value';

      const child = createTraceContext(parent);
      expect(child.traceState).toBe('vendor=value');
    });

    it('should respect sampled parameter', () => {
      const sampled = createTraceContext(undefined, true);
      const unsampled = createTraceContext(undefined, false);

      expect(sampled.traceFlags).toBe(TraceFlags.SAMPLED);
      expect(unsampled.traceFlags).toBe(TraceFlags.NONE);
    });
  });

  describe('parseTraceparent', () => {
    it('should parse valid traceparent header', () => {
      const header = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      const ctx = parseTraceparent(header);

      expect(ctx).not.toBeNull();
      expect(ctx!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(ctx!.spanId).toBe('b7ad6b7169203331');
      expect(ctx!.traceFlags).toBe(1);
    });

    it('should parse unsampled trace', () => {
      const header = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00';
      const ctx = parseTraceparent(header);

      expect(ctx).not.toBeNull();
      expect(ctx!.traceFlags).toBe(0);
    });

    it('should reject invalid version', () => {
      const header = '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      expect(parseTraceparent(header)).toBeNull();
    });

    it('should reject all-zeros trace ID', () => {
      const header = '00-00000000000000000000000000000000-b7ad6b7169203331-01';
      expect(parseTraceparent(header)).toBeNull();
    });

    it('should reject all-zeros span ID', () => {
      const header = '00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01';
      expect(parseTraceparent(header)).toBeNull();
    });

    it('should reject invalid format', () => {
      expect(parseTraceparent('invalid')).toBeNull();
      expect(parseTraceparent('00-invalid-01')).toBeNull();
      expect(parseTraceparent('')).toBeNull();
    });

    it('should reject wrong length trace ID', () => {
      const header = '00-0af7651916cd43dd-b7ad6b7169203331-01';
      expect(parseTraceparent(header)).toBeNull();
    });

    it('should reject wrong length span ID', () => {
      const header = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b71-01';
      expect(parseTraceparent(header)).toBeNull();
    });
  });

  describe('formatTraceparent', () => {
    it('should format context as traceparent header', () => {
      const ctx = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };

      const header = formatTraceparent(ctx);
      expect(header).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    });

    it('should format unsampled trace', () => {
      const ctx = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 0,
      };

      const header = formatTraceparent(ctx);
      expect(header).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00');
    });

    it('should round-trip with parseTraceparent', () => {
      const original = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
      const ctx = parseTraceparent(original);
      const formatted = formatTraceparent(ctx!);

      expect(formatted).toBe(original);
    });
  });

  describe('AsyncLocalStorage context', () => {
    it('should return undefined outside of context', () => {
      expect(getCurrentTraceContext()).toBeUndefined();
    });

    it('should provide context within run', () => {
      const ctx = createTraceContext();

      runWithTraceContext(ctx, () => {
        const current = getCurrentTraceContext();
        expect(current).toBeDefined();
        expect(current!.traceId).toBe(ctx.traceId);
        expect(current!.spanId).toBe(ctx.spanId);
      });
    });

    it('should provide context within async run', async () => {
      const ctx = createTraceContext();

      await runWithTraceContextAsync(ctx, async () => {
        const current = getCurrentTraceContext();
        expect(current).toBeDefined();
        expect(current!.traceId).toBe(ctx.traceId);
      });
    });

    it('should isolate contexts', () => {
      const ctx1 = createTraceContext();
      const ctx2 = createTraceContext();

      runWithTraceContext(ctx1, () => {
        expect(getCurrentTraceContext()!.traceId).toBe(ctx1.traceId);

        runWithTraceContext(ctx2, () => {
          expect(getCurrentTraceContext()!.traceId).toBe(ctx2.traceId);
        });

        expect(getCurrentTraceContext()!.traceId).toBe(ctx1.traceId);
      });
    });
  });

  describe('Baggage', () => {
    it('should set and get baggage within context', () => {
      const ctx = createTraceContext();

      runWithTraceContext(ctx, () => {
        setBaggage('key1', 'value1');
        setBaggage('key2', 'value2');

        expect(getBaggage('key1')).toBe('value1');
        expect(getBaggage('key2')).toBe('value2');
        expect(getBaggage('key3')).toBeUndefined();
      });
    });

    it('should return empty map outside context', () => {
      const baggage = getAllBaggage();
      expect(baggage.size).toBe(0);
    });

    it('should pass baggage when running context', () => {
      const ctx = createTraceContext();
      const initialBaggage = new Map([['existing', 'value']]);

      runWithTraceContext(ctx, () => {
        expect(getBaggage('existing')).toBe('value');
      }, initialBaggage);
    });
  });

  describe('Context Attributes', () => {
    it('should set and get attributes within context', () => {
      const ctx = createTraceContext();

      runWithTraceContext(ctx, () => {
        setContextAttribute('string', 'value');
        setContextAttribute('number', 42);
        setContextAttribute('boolean', true);

        expect(getContextAttribute('string')).toBe('value');
        expect(getContextAttribute('number')).toBe(42);
        expect(getContextAttribute('boolean')).toBe(true);
      });
    });

    it('should return undefined outside context', () => {
      expect(getContextAttribute('key')).toBeUndefined();
    });
  });

  describe('getCorrelationId', () => {
    it('should return orphan ID outside context', () => {
      const id = getCorrelationId();
      expect(id).toMatch(/^orphan-[0-9a-f]{16}$/);
    });

    it('should return formatted ID within context', () => {
      const ctx = createTraceContext();

      runWithTraceContext(ctx, () => {
        const id = getCorrelationId();
        expect(id).toBe(`${ctx.traceId.slice(0, 8)}-${ctx.spanId.slice(0, 8)}`);
      });
    });
  });

  describe('isTraceSampled', () => {
    it('should return false outside context', () => {
      expect(isTraceSampled()).toBe(false);
    });

    it('should return true for sampled trace', () => {
      const ctx = createTraceContext(undefined, true);

      runWithTraceContext(ctx, () => {
        expect(isTraceSampled()).toBe(true);
      });
    });

    it('should return false for unsampled trace', () => {
      const ctx = createTraceContext(undefined, false);

      runWithTraceContext(ctx, () => {
        expect(isTraceSampled()).toBe(false);
      });
    });
  });

  describe('Header extraction/injection', () => {
    it('should extract context from headers', () => {
      const headers = {
        'traceparent': '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        'tracestate': 'vendor=value',
      };

      const ctx = extractTraceContextFromHeaders(headers);

      expect(ctx).toBeDefined();
      expect(ctx!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(ctx!.spanId).toBe('b7ad6b7169203331');
      expect(ctx!.traceState).toBe('vendor=value');
    });

    it('should handle case-insensitive headers', () => {
      const headers = {
        'Traceparent': '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        'Tracestate': 'vendor=value',
      };

      const ctx = extractTraceContextFromHeaders(headers);
      expect(ctx).toBeDefined();
      expect(ctx!.traceState).toBe('vendor=value');
    });

    it('should return undefined for missing headers', () => {
      expect(extractTraceContextFromHeaders({})).toBeUndefined();
      expect(extractTraceContextFromHeaders(undefined)).toBeUndefined();
    });

    it('should return undefined for invalid traceparent', () => {
      const headers = { 'traceparent': 'invalid' };
      expect(extractTraceContextFromHeaders(headers)).toBeUndefined();
    });

    it('should inject context to headers', () => {
      const ctx = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
        traceState: 'vendor=value',
      };

      const headers = injectTraceContextToHeaders(ctx);

      expect(headers['traceparent']).toBe(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      );
      expect(headers['tracestate']).toBe('vendor=value');
    });

    it('should merge with existing headers', () => {
      const ctx = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };

      const headers = injectTraceContextToHeaders(ctx, { 'custom': 'value' });

      expect(headers['custom']).toBe('value');
      expect(headers['traceparent']).toBeDefined();
    });

    it('should not include tracestate if not set', () => {
      const ctx = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };

      const headers = injectTraceContextToHeaders(ctx);

      expect(headers['tracestate']).toBeUndefined();
    });
  });
});
