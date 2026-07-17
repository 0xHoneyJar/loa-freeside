import { describe, it, expect } from 'vitest';

import { RefusalSchema, RefusalCodeSchema, REFUSAL_HTTP_STATUS } from '../index.js';

describe('RefusalSchema (IMP-006)', () => {
  it('accepts a typed refusal', () => {
    const r = { code: 'unsupported-gating', reason: 'LP gating is not supported', retryable: false };
    expect(RefusalSchema.safeParse(r).success).toBe(true);
  });

  it('rejects an unknown code', () => {
    expect(
      RefusalSchema.safeParse({ code: 'teapot', reason: 'x', retryable: false }).success,
    ).toBe(false);
  });

  it('requires reason and retryable', () => {
    expect(RefusalSchema.safeParse({ code: 'rate-limited' }).success).toBe(false);
  });

  it('maps every refusal code to a stable HTTP status', () => {
    for (const code of RefusalCodeSchema.options) {
      expect(typeof REFUSAL_HTTP_STATUS[code]).toBe('number');
    }
  });

  it('maps the SDD §11 codes to their documented statuses', () => {
    expect(REFUSAL_HTTP_STATUS['unsupported-gating']).toBe(422);
    expect(REFUSAL_HTTP_STATUS['unindexed-contract']).toBe(404);
    expect(REFUSAL_HTTP_STATUS['rate-limited']).toBe(429);
  });
});
