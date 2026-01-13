/**
 * SQL Safety Utilities Unit Tests (Sprint 72)
 *
 * Tests for column whitelist pattern - CRIT-3 security fix
 * Prevents SQL injection via dynamic column names
 */

import { describe, it, expect } from 'vitest';
import {
  SqlInjectionAttemptError,
  getPlatformDisplayColumn,
  validateBadgeSettingsColumn,
  validateSubscriptionColumn,
  buildBadgeSettingsSetClause,
  buildSubscriptionSetClause,
  BADGE_SETTINGS_COLUMNS,
  SUBSCRIPTION_UPDATE_COLUMNS,
  PLATFORM_DISPLAY_COLUMNS,
} from '../../../src/utils/sql-safety.js';

describe('SQL Safety Utilities (CRIT-3)', () => {
  // ===========================================================================
  // Constants Tests
  // ===========================================================================

  describe('Column Whitelists', () => {
    it('should define badge settings columns', () => {
      expect(BADGE_SETTINGS_COLUMNS.display_on_discord).toBe('display_on_discord');
      expect(BADGE_SETTINGS_COLUMNS.display_on_telegram).toBe('display_on_telegram');
      expect(BADGE_SETTINGS_COLUMNS.badge_style).toBe('badge_style');
      expect(BADGE_SETTINGS_COLUMNS.member_id).toBe('member_id');
    });

    it('should define subscription update columns', () => {
      expect(SUBSCRIPTION_UPDATE_COLUMNS.payment_customer_id).toBe('payment_customer_id');
      expect(SUBSCRIPTION_UPDATE_COLUMNS.tier).toBe('tier');
      expect(SUBSCRIPTION_UPDATE_COLUMNS.status).toBe('status');
      expect(SUBSCRIPTION_UPDATE_COLUMNS.grace_until).toBe('grace_until');
    });

    it('should define platform display columns', () => {
      expect(PLATFORM_DISPLAY_COLUMNS.discord).toBe('display_on_discord');
      expect(PLATFORM_DISPLAY_COLUMNS.telegram).toBe('display_on_telegram');
    });
  });

  // ===========================================================================
  // Platform Display Column Tests
  // ===========================================================================

  describe('getPlatformDisplayColumn', () => {
    it('should return correct column for discord', () => {
      const column = getPlatformDisplayColumn('discord');
      expect(column).toBe('display_on_discord');
    });

    it('should return correct column for telegram', () => {
      const column = getPlatformDisplayColumn('telegram');
      expect(column).toBe('display_on_telegram');
    });

    it('should throw SqlInjectionAttemptError for invalid platform', () => {
      expect(() => getPlatformDisplayColumn('invalid')).toThrow(SqlInjectionAttemptError);
    });

    it('should throw SqlInjectionAttemptError for SQL injection attempt', () => {
      const injectionAttempts = [
        "discord'; DROP TABLE badge_settings;--",
        'telegram OR 1=1',
        'discord UNION SELECT * FROM users',
        "'; DELETE FROM subscriptions;--",
        '<script>alert("xss")</script>',
        '../../../etc/passwd',
        '${process.env.SECRET}',
        '1; rm -rf /',
      ];

      for (const attempt of injectionAttempts) {
        expect(
          () => getPlatformDisplayColumn(attempt),
          `Should block: ${attempt}`
        ).toThrow(SqlInjectionAttemptError);
      }
    });

    it('should include allowed values in error message', () => {
      try {
        getPlatformDisplayColumn('invalid');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SqlInjectionAttemptError);
        const sqlError = error as SqlInjectionAttemptError;
        expect(sqlError.tableName).toBe('badge_settings');
        expect(sqlError.invalidValue).toBe('invalid');
        expect(sqlError.allowedValues).toContain('discord');
        expect(sqlError.allowedValues).toContain('telegram');
      }
    });
  });

  // ===========================================================================
  // Badge Settings Column Validation Tests
  // ===========================================================================

  describe('validateBadgeSettingsColumn', () => {
    it('should accept valid badge settings columns', () => {
      const validColumns = [
        'display_on_discord',
        'display_on_telegram',
        'badge_style',
        'member_id',
        'created_at',
        'updated_at',
      ];

      for (const col of validColumns) {
        expect(validateBadgeSettingsColumn(col)).toBe(col);
      }
    });

    it('should throw for invalid columns', () => {
      const invalidColumns = [
        'invalid_column',
        'password',
        'DROP TABLE',
        '',
        'badge_style; DROP TABLE;',
      ];

      for (const col of invalidColumns) {
        expect(
          () => validateBadgeSettingsColumn(col),
          `Should reject: ${col}`
        ).toThrow(SqlInjectionAttemptError);
      }
    });
  });

  // ===========================================================================
  // Subscription Column Validation Tests
  // ===========================================================================

  describe('validateSubscriptionColumn', () => {
    it('should accept valid subscription update columns', () => {
      const validColumns = [
        'payment_customer_id',
        'payment_subscription_id',
        'payment_provider',
        'tier',
        'status',
        'grace_until',
        'current_period_start',
        'current_period_end',
        'updated_at',
      ];

      for (const col of validColumns) {
        expect(validateSubscriptionColumn(col)).toBe(col);
      }
    });

    it('should throw for invalid columns', () => {
      const invalidColumns = [
        'id', // ID should not be updatable
        'community_id', // Should not be changeable
        'created_at', // Should not be updatable
        'password',
        'secret_key',
        'admin_flag',
      ];

      for (const col of invalidColumns) {
        expect(
          () => validateSubscriptionColumn(col),
          `Should reject: ${col}`
        ).toThrow(SqlInjectionAttemptError);
      }
    });
  });

  // ===========================================================================
  // SET Clause Builder Tests
  // ===========================================================================

  describe('buildBadgeSettingsSetClause', () => {
    it('should build clause with valid columns', () => {
      const result = buildBadgeSettingsSetClause({
        display_on_discord: 1,
        display_on_telegram: 0,
      });

      expect(result.clause).toContain("updated_at = datetime('now')");
      expect(result.clause).toContain('display_on_discord = ?');
      expect(result.clause).toContain('display_on_telegram = ?');
      expect(result.values).toContain(1);
      expect(result.values).toContain(0);
    });

    it('should always include updated_at', () => {
      const result = buildBadgeSettingsSetClause({});
      expect(result.clause).toBe("updated_at = datetime('now')");
      expect(result.values).toHaveLength(0);
    });

    it('should exclude created_at and updated_at from values', () => {
      const result = buildBadgeSettingsSetClause({
        display_on_discord: 1,
      });

      // updated_at is in clause but not in values (it's a SQL function)
      expect(result.clause).toContain("updated_at = datetime('now')");
      expect(result.values).toHaveLength(1);
    });
  });

  describe('buildSubscriptionSetClause', () => {
    it('should build clause with valid columns', () => {
      const result = buildSubscriptionSetClause({
        tier: 'premium',
        status: 'active',
      });

      expect(result.clause).toContain("updated_at = datetime('now')");
      expect(result.clause).toContain('tier = ?');
      expect(result.clause).toContain('status = ?');
      expect(result.values).toContain('premium');
      expect(result.values).toContain('active');
    });

    it('should handle null values for nullable columns', () => {
      const result = buildSubscriptionSetClause({
        grace_until: null,
        payment_customer_id: null,
      });

      expect(result.values).toContain(null);
    });

    it('should always include updated_at', () => {
      const result = buildSubscriptionSetClause({});
      expect(result.clause).toBe("updated_at = datetime('now')");
      expect(result.values).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Error Class Tests
  // ===========================================================================

  describe('SqlInjectionAttemptError', () => {
    it('should have correct name', () => {
      const error = new SqlInjectionAttemptError('test_table', 'bad_value', ['good']);
      expect(error.name).toBe('SqlInjectionAttemptError');
    });

    it('should include table name in message', () => {
      const error = new SqlInjectionAttemptError('users', 'DROP TABLE', ['name', 'email']);
      expect(error.message).toContain('users');
      expect(error.message).toContain('DROP TABLE');
    });

    it('should include allowed values in message', () => {
      const error = new SqlInjectionAttemptError('test', 'bad', ['a', 'b', 'c']);
      expect(error.message).toContain('a');
      expect(error.message).toContain('b');
      expect(error.message).toContain('c');
    });

    it('should expose properties for programmatic access', () => {
      const error = new SqlInjectionAttemptError('table1', 'value1', ['allowed1', 'allowed2']);
      expect(error.tableName).toBe('table1');
      expect(error.invalidValue).toBe('value1');
      expect(error.allowedValues).toEqual(['allowed1', 'allowed2']);
    });

    it('should be instance of Error', () => {
      const error = new SqlInjectionAttemptError('t', 'v', ['a']);
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ===========================================================================
  // Integration-like Tests (SQL Injection Scenarios)
  // ===========================================================================

  describe('SQL Injection Prevention Scenarios', () => {
    const sqlInjectionPayloads = [
      // Classic SQL injection
      "' OR '1'='1",
      "'; DROP TABLE users;--",
      "1' AND 1=1--",
      "' UNION SELECT * FROM passwords--",

      // Blind SQL injection
      "' AND SLEEP(5)--",
      "1; WAITFOR DELAY '0:0:5'--",

      // Stacked queries
      "1; INSERT INTO admin VALUES('hacker','password');--",
      "1; UPDATE users SET role='admin' WHERE username='victim';--",

      // Comment-based
      '/**/OR/**/1=1',
      '--\nSELECT * FROM users',

      // Encoding attacks
      '0x27204f522027313d2731', // Hex encoded
      '%27%20OR%20%271%27%3D%271', // URL encoded

      // NoSQL-like
      '{"$gt": ""}',
      '{"$where": "this.password.length > 0"}',
    ];

    it('should block all SQL injection attempts in platform column', () => {
      for (const payload of sqlInjectionPayloads) {
        expect(
          () => getPlatformDisplayColumn(payload),
          `Should block payload: ${payload.substring(0, 30)}...`
        ).toThrow(SqlInjectionAttemptError);
      }
    });

    it('should block all SQL injection attempts in badge settings column', () => {
      for (const payload of sqlInjectionPayloads) {
        expect(
          () => validateBadgeSettingsColumn(payload),
          `Should block payload: ${payload.substring(0, 30)}...`
        ).toThrow(SqlInjectionAttemptError);
      }
    });

    it('should block all SQL injection attempts in subscription column', () => {
      for (const payload of sqlInjectionPayloads) {
        expect(
          () => validateSubscriptionColumn(payload),
          `Should block payload: ${payload.substring(0, 30)}...`
        ).toThrow(SqlInjectionAttemptError);
      }
    });
  });
});
