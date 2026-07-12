import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OrderSchema, GatingRuleSchema, SUPPORTED_GATING_KIND } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures');

// Each case clones the canonical fixture and mutates one field — so a failure
// points at exactly the constraint under test.
function order(): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'order.valid.json'), 'utf-8'));
}

describe('OrderSchema', () => {
  it('accepts the canonical valid order', () => {
    expect(OrderSchema.safeParse(order()).success).toBe(true);
  });

  it('rejects a malformed owner_wallet', () => {
    const bad = order();
    bad.community.owner_wallet = '0xnope';
    expect(OrderSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-lowercase chain slug', () => {
    const bad = order();
    bad.source.chain = 'Ethereum';
    expect(OrderSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects gating beyond the sealed nft-balance rule', () => {
    const bad = order();
    bad.gating_rule = { kind: 'lp-stake', threshold: 1 };
    expect(OrderSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-positive threshold', () => {
    const bad = order();
    bad.gating_rule.threshold = 0;
    expect(OrderSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown extra keys (sealed via .strict)', () => {
    const bad = order();
    bad.surprise = true;
    expect(OrderSchema.safeParse(bad).success).toBe(false);
  });

  it('seals the supported gating kind to nft-balance', () => {
    expect(SUPPORTED_GATING_KIND).toBe('nft-balance');
    expect(GatingRuleSchema.safeParse({ kind: 'nft-balance', threshold: 3 }).success).toBe(true);
    expect(GatingRuleSchema.safeParse({ kind: 'erc20-balance', threshold: 3 }).success).toBe(false);
  });
});
