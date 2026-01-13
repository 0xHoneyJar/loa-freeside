/**
 * TraceContext Unit Tests
 *
 * Sprint 69: Unified Tracing & Resilience
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTraceContext,
  getCurrentTrace,
  getTraceId,
  getSpanId,
  runWithTrace,
  runWithTraceAsync,
  createSpan,
  withSpan,
  setTraceAttribute,
  setTenantId,
  setUserId,
  extractTraceFromHeaders,
  injectTraceHeaders,
  getTraceLogFields,
  getTraceSqlComment,
  generateId,
  generateSpanId,
  TRACE_HEADERS,
} from '../../../../../src/packages/infrastructure/tracing';

describe('TraceContext', () => {
  describe('generateId', () => {
    it('generates a valid UUID v4 format', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('generateSpanId', () => {
    it('generates a 16-character hex string', () => {
      const spanId = generateSpanId();
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('generates unique span IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSpanId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('createTraceContext', () => {
    it('creates trace context with generated IDs', () => {
      const ctx = createTraceContext();

      expect(ctx.traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(ctx.parentSpanId).toBeUndefined();
      expect(ctx.tenantId).toBeUndefined();
      expect(ctx.userId).toBeUndefined();
      expect(ctx.startTime).toBeGreaterThan(0);
      expect(ctx.attributes).toEqual({});
    });

    it('uses provided trace ID', () => {
      const traceId = 'existing-trace-id';
      const ctx = createTraceContext({ traceId });

      expect(ctx.traceId).toBe(traceId);
    });

    it('sets parent span ID', () => {
      const parentSpanId = 'parent-span-123';
      const ctx = createTraceContext({ parentSpanId });

      expect(ctx.parentSpanId).toBe(parentSpanId);
    });

    it('sets tenant ID', () => {
      const tenantId = 'guild-12345';
      const ctx = createTraceContext({ tenantId });

      expect(ctx.tenantId).toBe(tenantId);
    });

    it('sets user ID', () => {
      const userId = 'user-67890';
      const ctx = createTraceContext({ userId });

      expect(ctx.userId).toBe(userId);
    });
  });

  describe('getCurrentTrace / runWithTrace', () => {
    it('returns undefined when not in trace context', () => {
      expect(getCurrentTrace()).toBeUndefined();
    });

    it('returns trace context when running within trace', () => {
      const ctx = createTraceContext({ tenantId: 'test-tenant' });

      runWithTrace(ctx, () => {
        const current = getCurrentTrace();
        expect(current).toBeDefined();
        expect(current?.traceId).toBe(ctx.traceId);
        expect(current?.tenantId).toBe('test-tenant');
      });
    });

    it('isolates trace context between nested runs', () => {
      const ctx1 = createTraceContext({ tenantId: 'tenant-1' });
      const ctx2 = createTraceContext({ tenantId: 'tenant-2' });

      runWithTrace(ctx1, () => {
        expect(getCurrentTrace()?.tenantId).toBe('tenant-1');

        runWithTrace(ctx2, () => {
          expect(getCurrentTrace()?.tenantId).toBe('tenant-2');
        });

        expect(getCurrentTrace()?.tenantId).toBe('tenant-1');
      });
    });
  });

  describe('runWithTraceAsync', () => {
    it('preserves trace context across async operations', async () => {
      const ctx = createTraceContext({ tenantId: 'async-tenant' });

      await runWithTraceAsync(ctx, async () => {
        expect(getCurrentTrace()?.tenantId).toBe('async-tenant');

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getCurrentTrace()?.tenantId).toBe('async-tenant');
      });
    });

    it('handles async errors', async () => {
      const ctx = createTraceContext();

      await expect(
        runWithTraceAsync(ctx, async () => {
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');
    });
  });

  describe('getTraceId / getSpanId', () => {
    it('returns "no-trace" when not in context', () => {
      expect(getTraceId()).toBe('no-trace');
    });

    it('returns "no-span" when not in context', () => {
      expect(getSpanId()).toBe('no-span');
    });

    it('returns actual IDs when in context', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        expect(getTraceId()).toBe(ctx.traceId);
        expect(getSpanId()).toBe(ctx.spanId);
      });
    });
  });

  describe('createSpan', () => {
    it('creates a span with operation name', () => {
      const ctx = createTraceContext();
      const originalSpanId = ctx.spanId;

      runWithTrace(ctx, () => {
        const { span, endSpan } = createSpan({ operationName: 'test.operation' });

        expect(span.operationName).toBe('test.operation');
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
        // Parent span ID should be the original context's span ID
        expect(span.parentSpanId).toBe(originalSpanId);
        expect(span.status).toBe('ok');
        expect(span.startTime).toBeGreaterThan(0);

        const ended = endSpan();
        expect(ended.endTime).toBeGreaterThan(0);
        expect(ended.duration).toBeGreaterThanOrEqual(0);
      });
    });

    it('updates span status on end', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        const { endSpan } = createSpan({ operationName: 'failing.operation' });

        const ended = endSpan('error', { errorCode: 'E001' });

        expect(ended.status).toBe('error');
        expect(ended.attributes).toHaveProperty('errorCode', 'E001');
      });
    });

    it('includes initial attributes', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        const { span } = createSpan({
          operationName: 'test.op',
          attributes: { key: 'value', count: 42 },
        });

        expect(span.attributes).toEqual({ key: 'value', count: 42 });
      });
    });
  });

  describe('withSpan', () => {
    it('wraps async operation with span tracking', async () => {
      const ctx = createTraceContext();

      const result = await runWithTraceAsync(ctx, async () => {
        return await withSpan('database.query', async () => {
          return 'query result';
        });
      });

      expect(result).toBe('query result');
    });

    it('marks span as error on exception', async () => {
      const ctx = createTraceContext();

      await expect(
        runWithTraceAsync(ctx, async () => {
          return await withSpan('failing.query', async () => {
            throw new Error('Query failed');
          });
        })
      ).rejects.toThrow('Query failed');
    });
  });

  describe('setTraceAttribute', () => {
    it('sets attribute on current trace', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        setTraceAttribute('customKey', 'customValue');
        setTraceAttribute('numericKey', 123);
        setTraceAttribute('boolKey', true);

        const current = getCurrentTrace();
        expect(current?.attributes).toEqual({
          customKey: 'customValue',
          numericKey: 123,
          boolKey: true,
        });
      });
    });

    it('does nothing when not in trace context', () => {
      // Should not throw
      setTraceAttribute('key', 'value');
    });
  });

  describe('setTenantId', () => {
    it('sets tenant ID on current trace', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        setTenantId('guild-xyz');

        expect(getCurrentTrace()?.tenantId).toBe('guild-xyz');
      });
    });
  });

  describe('setUserId', () => {
    it('sets user ID on current trace', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        setUserId('user-abc');

        expect(getCurrentTrace()?.userId).toBe('user-abc');
      });
    });
  });

  describe('extractTraceFromHeaders', () => {
    it('extracts trace ID from headers', () => {
      const headers = {
        [TRACE_HEADERS.TRACE_ID]: 'incoming-trace-id',
        [TRACE_HEADERS.SPAN_ID]: 'incoming-span-id',
        [TRACE_HEADERS.TENANT_ID]: 'incoming-tenant',
      };

      const options = extractTraceFromHeaders(headers);

      expect(options.traceId).toBe('incoming-trace-id');
      expect(options.parentSpanId).toBe('incoming-span-id');
      expect(options.tenantId).toBe('incoming-tenant');
    });

    it('handles missing headers', () => {
      const options = extractTraceFromHeaders({});

      expect(options.traceId).toBeUndefined();
      expect(options.parentSpanId).toBeUndefined();
      expect(options.tenantId).toBeUndefined();
    });

    it('handles array header values', () => {
      const headers = {
        [TRACE_HEADERS.TRACE_ID]: ['trace-1', 'trace-2'],
      };

      const options = extractTraceFromHeaders(headers);

      expect(options.traceId).toBe('trace-1');
    });

    it('handles lowercase headers', () => {
      const headers = {
        'x-trace-id': 'lower-trace-id',
      };

      const options = extractTraceFromHeaders(headers);

      expect(options.traceId).toBe('lower-trace-id');
    });
  });

  describe('injectTraceHeaders', () => {
    it('injects trace headers into outgoing request', () => {
      const ctx = createTraceContext({ tenantId: 'inject-tenant' });

      runWithTrace(ctx, () => {
        const headers: Record<string, string> = {};
        injectTraceHeaders(headers);

        expect(headers[TRACE_HEADERS.TRACE_ID]).toBe(ctx.traceId);
        expect(headers[TRACE_HEADERS.SPAN_ID]).toBe(ctx.spanId);
        expect(headers[TRACE_HEADERS.TENANT_ID]).toBe('inject-tenant');
      });
    });

    it('returns headers unchanged when not in trace context', () => {
      const headers: Record<string, string> = { existing: 'header' };
      const result = injectTraceHeaders(headers);

      expect(result).toEqual({ existing: 'header' });
    });

    it('does not inject tenant ID if not set', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        const headers: Record<string, string> = {};
        injectTraceHeaders(headers);

        expect(headers[TRACE_HEADERS.TENANT_ID]).toBeUndefined();
      });
    });
  });

  describe('getTraceLogFields', () => {
    it('returns log-friendly trace fields', () => {
      const ctx = createTraceContext({
        tenantId: 'log-tenant',
        userId: 'log-user',
      });

      runWithTrace(ctx, () => {
        const fields = getTraceLogFields();

        expect(fields.traceId).toBe(ctx.traceId);
        expect(fields.spanId).toBe(ctx.spanId);
        expect(fields.tenantId).toBe('log-tenant');
        expect(fields.userId).toBe('log-user');
      });
    });

    it('returns "no-trace" when not in context', () => {
      const fields = getTraceLogFields();

      expect(fields.traceId).toBe('no-trace');
    });
  });

  describe('getTraceSqlComment', () => {
    it('generates SQL comment with trace context', () => {
      const ctx = createTraceContext({ tenantId: 'sql-tenant' });

      runWithTrace(ctx, () => {
        const comment = getTraceSqlComment();

        expect(comment).toContain('traceId:');
        expect(comment).toContain('spanId:');
        expect(comment).toContain('tenantId: sql-tenant');
        expect(comment).toMatch(/^\/\* .* \*\/$/);
      });
    });

    it('returns empty string when not in context', () => {
      const comment = getTraceSqlComment();

      expect(comment).toBe('');
    });

    it('excludes tenant ID if not set', () => {
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        const comment = getTraceSqlComment();

        expect(comment).not.toContain('tenantId');
      });
    });
  });

  describe('TRACE_HEADERS', () => {
    it('has correct header names', () => {
      expect(TRACE_HEADERS.TRACE_ID).toBe('x-trace-id');
      expect(TRACE_HEADERS.SPAN_ID).toBe('x-span-id');
      expect(TRACE_HEADERS.PARENT_SPAN_ID).toBe('x-parent-span-id');
      expect(TRACE_HEADERS.TENANT_ID).toBe('x-tenant-id');
    });
  });
});
