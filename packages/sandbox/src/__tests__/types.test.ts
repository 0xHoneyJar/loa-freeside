/**
 * Type Tests - Sandbox Type Definitions
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * Tests for type definitions and constants.
 */

import { describe, it, expect } from 'vitest';
import {
  VALID_STATUS_TRANSITIONS,
  SandboxError,
  SandboxErrorCode,
} from '../types.js';
import type { SandboxStatus } from '../types.js';

describe('VALID_STATUS_TRANSITIONS', () => {
  it('should define all status transitions', () => {
    const statuses: SandboxStatus[] = [
      'pending',
      'creating',
      'running',
      'expired',
      'destroying',
      'destroyed',
    ];

    for (const status of statuses) {
      expect(VALID_STATUS_TRANSITIONS[status]).toBeDefined();
      expect(Array.isArray(VALID_STATUS_TRANSITIONS[status])).toBe(true);
    }
  });

  it('should allow pending -> creating', () => {
    expect(VALID_STATUS_TRANSITIONS.pending).toContain('creating');
  });

  it('should allow creating -> running', () => {
    expect(VALID_STATUS_TRANSITIONS.creating).toContain('running');
  });

  it('should allow creating -> destroying (failure case)', () => {
    expect(VALID_STATUS_TRANSITIONS.creating).toContain('destroying');
  });

  it('should allow running -> expired', () => {
    expect(VALID_STATUS_TRANSITIONS.running).toContain('expired');
  });

  it('should allow running -> destroying', () => {
    expect(VALID_STATUS_TRANSITIONS.running).toContain('destroying');
  });

  it('should allow expired -> destroying', () => {
    expect(VALID_STATUS_TRANSITIONS.expired).toContain('destroying');
  });

  it('should allow destroying -> destroyed', () => {
    expect(VALID_STATUS_TRANSITIONS.destroying).toContain('destroyed');
  });

  it('should have no transitions from destroyed (terminal state)', () => {
    expect(VALID_STATUS_TRANSITIONS.destroyed).toEqual([]);
  });

  it('should not allow backward transitions', () => {
    expect(VALID_STATUS_TRANSITIONS.running).not.toContain('pending');
    expect(VALID_STATUS_TRANSITIONS.running).not.toContain('creating');
    expect(VALID_STATUS_TRANSITIONS.destroyed).not.toContain('running');
  });
});

describe('SandboxErrorCode', () => {
  it('should define all error codes', () => {
    expect(SandboxErrorCode.NAME_EXISTS).toBe('SANDBOX_001');
    expect(SandboxErrorCode.MAX_EXCEEDED).toBe('SANDBOX_002');
    expect(SandboxErrorCode.GUILD_MAPPED).toBe('SANDBOX_003');
    expect(SandboxErrorCode.NOT_FOUND).toBe('SANDBOX_004');
    expect(SandboxErrorCode.SCHEMA_FAILED).toBe('SANDBOX_005');
    expect(SandboxErrorCode.CLEANUP_FAILED).toBe('SANDBOX_006');
    expect(SandboxErrorCode.INVALID_TRANSITION).toBe('SANDBOX_007');
  });
});

describe('SandboxError', () => {
  it('should create error with code and message', () => {
    const error = new SandboxError(SandboxErrorCode.NOT_FOUND, 'Sandbox not found');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SandboxError);
    expect(error.code).toBe(SandboxErrorCode.NOT_FOUND);
    expect(error.message).toBe('Sandbox not found');
    expect(error.name).toBe('SandboxError');
  });

  it('should create error with details', () => {
    const error = new SandboxError(
      SandboxErrorCode.GUILD_MAPPED,
      'Guild already mapped',
      { guildId: '123', existingSandboxId: 'abc' }
    );

    expect(error.details).toEqual({
      guildId: '123',
      existingSandboxId: 'abc',
    });
  });

  it('should work with try/catch', () => {
    try {
      throw new SandboxError(SandboxErrorCode.MAX_EXCEEDED, 'Limit reached');
    } catch (e) {
      expect(e).toBeInstanceOf(SandboxError);
      if (e instanceof SandboxError) {
        expect(e.code).toBe(SandboxErrorCode.MAX_EXCEEDED);
      }
    }
  });
});
