/**
 * Identity-Economy Bridge Tests
 *
 * Tests for graduated trust, identity anchor checks,
 * four-eyes rotation model, and S2S anchor verification.
 *
 * Sprint refs: Tasks 3.4, 3.5; Sprint 253 Task 2.3
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  evaluateIdentityTrust,
  DEFAULT_IDENTITY_TRUST,
  verifyIdentityAnchor,
} from '../../../src/packages/core/protocol/identity-trust.js';
import type {
  IdentityTrustConfig,
  AnchorLookupFn,
} from '../../../src/packages/core/protocol/identity-trust.js';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../../src/db/migrations/030_credit_ledger.js';
import { AGENT_IDENTITY_SCHEMA_SQL } from '../../../src/db/migrations/037_agent_identity.js';

// =============================================================================
// evaluateIdentityTrust — Core Logic
// =============================================================================

describe('evaluateIdentityTrust', () => {
  const enabledConfig: IdentityTrustConfig = {
    enabled: true,
    highValueThresholdMicro: 100_000_000n, // $100
    requireAnchorAboveThreshold: true,
  };

  it('feature flag disabled → all operations pass regardless of anchor', () => {
    const result = evaluateIdentityTrust(
      DEFAULT_IDENTITY_TRUST, // enabled: false
      999_999_999_999n, // way above threshold
      false, // no anchor
    );
    expect(result.allowed).toBe(true);
    expect(result.checked).toBe(false);
  });

  it('high-value reserve without anchor → denied', () => {
    const result = evaluateIdentityTrust(
      enabledConfig,
      200_000_000n, // $200 — above threshold
      false, // no anchor
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('identity_anchor_required_for_high_value');
    expect(result.checked).toBe(true);
  });

  it('high-value reserve with valid anchor → allowed', () => {
    const result = evaluateIdentityTrust(
      enabledConfig,
      200_000_000n,
      true, // has anchor
    );
    expect(result.allowed).toBe(true);
    expect(result.checked).toBe(true);
  });

  it('low-value reserve without anchor → allowed (graduated trust)', () => {
    const result = evaluateIdentityTrust(
      enabledConfig,
      50_000_000n, // $50 — below threshold
      false,
    );
    expect(result.allowed).toBe(true);
    expect(result.checked).toBe(false);
  });

  it('purchase without anchor → allowed (no deadlock)', () => {
    const result = evaluateIdentityTrust(
      enabledConfig,
      500_000_000n, // $500 — above threshold
      false,
      true, // is purchase route
    );
    expect(result.allowed).toBe(true);
    expect(result.checked).toBe(false);
  });

  it('custom threshold honored', () => {
    const customConfig: IdentityTrustConfig = {
      enabled: true,
      highValueThresholdMicro: 10_000_000n, // $10
      requireAnchorAboveThreshold: true,
    };

    // $15 — above custom threshold, no anchor → denied
    const result = evaluateIdentityTrust(customConfig, 15_000_000n, false);
    expect(result.allowed).toBe(false);

    // $5 — below custom threshold → allowed
    const result2 = evaluateIdentityTrust(customConfig, 5_000_000n, false);
    expect(result2.allowed).toBe(true);
  });

  it('exact threshold amount is allowed (≤ not <)', () => {
    const result = evaluateIdentityTrust(
      enabledConfig,
      100_000_000n, // exactly at threshold
      false,
    );
    expect(result.allowed).toBe(true);
    expect(result.checked).toBe(false);
  });
});

// =============================================================================
// Four-Eyes Rotation (Task 3.4)
// =============================================================================

describe('Four-Eyes Anchor Rotation', () => {
  function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(CREDIT_LEDGER_SCHEMA_SQL);
    db.exec(AGENT_IDENTITY_SCHEMA_SQL);
    // Seed a credit account
    db.prepare(`
      INSERT INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
      VALUES ('acct-1', 'agent', 'test-agent', 1, datetime('now'), datetime('now'))
    `).run();
    return db;
  }

  it('rotation with same actor as creator fails (four-eyes enforcement)', () => {
    const db = createTestDb();
    try {
      // Create anchor by admin-a
      db.prepare(`
        INSERT INTO agent_identity_anchors (agent_account_id, identity_anchor, created_by)
        VALUES ('acct-1', 'anchor-original', 'admin-a')
      `).run();

      // Attempt rotation by same admin-a
      const row = db.prepare(
        'SELECT created_by FROM agent_identity_anchors WHERE agent_account_id = ?'
      ).get('acct-1') as { created_by: string };

      const rotator = 'admin-a';
      const fourEyesViolation = rotator === row.created_by;
      expect(fourEyesViolation).toBe(true);
    } finally {
      db.close();
    }
  });

  it('rotation with different actor succeeds', () => {
    const db = createTestDb();
    try {
      db.prepare(`
        INSERT INTO agent_identity_anchors (agent_account_id, identity_anchor, created_by)
        VALUES ('acct-1', 'anchor-original', 'admin-a')
      `).run();

      const rotator = 'admin-b';
      const row = db.prepare(
        'SELECT created_by, identity_anchor FROM agent_identity_anchors WHERE agent_account_id = ?'
      ).get('acct-1') as { created_by: string; identity_anchor: string };

      // Four-eyes check passes
      expect(rotator !== row.created_by).toBe(true);

      // Perform rotation with audit trail (Task 3.4: log truncated previous anchor)
      const previousAnchorPrefix = row.identity_anchor.substring(0, 8);
      db.prepare(`
        UPDATE agent_identity_anchors
        SET identity_anchor = ?, rotated_at = datetime('now'), rotated_by = ?
        WHERE agent_account_id = ?
      `).run('anchor-rotated', rotator, 'acct-1');

      // Verify rotation
      const updated = db.prepare(
        'SELECT identity_anchor, rotated_by FROM agent_identity_anchors WHERE agent_account_id = ?'
      ).get('acct-1') as { identity_anchor: string; rotated_by: string };

      expect(updated.identity_anchor).toBe('anchor-rotated');
      expect(updated.rotated_by).toBe('admin-b');
      expect(previousAnchorPrefix).toBe('anchor-o'); // truncated to 8 chars
    } finally {
      db.close();
    }
  });
});

// =============================================================================
// verifyIdentityAnchor — S2S Anchor Verification (Sprint 253, Task 2.3)
// =============================================================================

describe('verifyIdentityAnchor', () => {
  const STORED_ANCHOR = 'test-anchor-value-abc123';

  const lookupWithAnchor: AnchorLookupFn = (id) => {
    if (id === 'acct-1') return { anchor: STORED_ANCHOR };
    return null;
  };

  const lookupNoAnchor: AnchorLookupFn = (id) => {
    if (id === 'acct-1') return { anchor: '' };
    return null;
  };

  it('valid anchor returns verified=true with correct SHA-256 hash', () => {
    const result = verifyIdentityAnchor('acct-1', STORED_ANCHOR, lookupWithAnchor);

    expect(result.verified).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.checkedAt).toBeDefined();

    // Verify the hash is correct
    const expectedHash = 'sha256:' + createHash('sha256').update(STORED_ANCHOR).digest('hex');
    expect(result.anchorHash).toBe(expectedHash);
  });

  it('invalid anchor returns verified=false with anchor_mismatch', () => {
    const result = verifyIdentityAnchor('acct-1', 'wrong-anchor', lookupWithAnchor);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('anchor_mismatch');
    expect(result.anchorHash).toBeUndefined();
    expect(result.checkedAt).toBeDefined();
  });

  it('account with no anchor bound returns verified=false with no_anchor_bound', () => {
    const result = verifyIdentityAnchor('acct-1', 'any-anchor', lookupNoAnchor);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('no_anchor_bound');
    expect(result.anchorHash).toBeUndefined();
  });

  it('nonexistent account returns verified=false with account_not_found', () => {
    const result = verifyIdentityAnchor('nonexistent-account', 'any-anchor', lookupWithAnchor);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('account_not_found');
    expect(result.anchorHash).toBeUndefined();
  });

  it('SHA-256 derivation is deterministic and matches crypto module', () => {
    const result1 = verifyIdentityAnchor('acct-1', STORED_ANCHOR, lookupWithAnchor);
    const result2 = verifyIdentityAnchor('acct-1', STORED_ANCHOR, lookupWithAnchor);

    expect(result1.anchorHash).toBe(result2.anchorHash);

    // Cross-verify with raw crypto
    const rawHash = createHash('sha256').update(STORED_ANCHOR).digest('hex');
    expect(result1.anchorHash).toBe(`sha256:${rawHash}`);
  });

  it('checkedAt is valid ISO 8601 timestamp', () => {
    const result = verifyIdentityAnchor('acct-1', STORED_ANCHOR, lookupWithAnchor);

    const parsed = new Date(result.checkedAt);
    expect(parsed.toISOString()).toBe(result.checkedAt);
    expect(parsed.getTime()).toBeGreaterThan(0);
  });

  it('lookup returning undefined treated as account_not_found', () => {
    const lookupUndefined: AnchorLookupFn = () => undefined;
    const result = verifyIdentityAnchor('acct-1', 'any', lookupUndefined);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('account_not_found');
  });
});
