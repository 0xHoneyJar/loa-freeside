/**
 * MigrationValidator Unit Tests
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Tests for the MigrationValidator class that validates data integrity
 * after migration from SQLite to PostgreSQL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MigrationValidator,
  createMigrationValidator,
  type ValidatorOptions,
  type IntegrityReport,
  type ProfileIntegrity,
  type BadgeIntegrity,
} from '../../../../../../src/packages/adapters/storage/migration/MigrationValidator.js';

// =============================================================================
// Mocks
// =============================================================================

// Mock better-sqlite3
vi.mock('better-sqlite3', () => {
  const mockStatement = {
    get: vi.fn(),
    all: vi.fn(),
  };

  const MockDatabase = vi.fn().mockImplementation(() => ({
    prepare: vi.fn().mockReturnValue(mockStatement),
    close: vi.fn(),
  }));

  return { default: MockDatabase };
});

// Mock PostgreSQL database
const mockPgDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
  execute: vi.fn(),
};

// Sample test data - SQLite profiles
const sampleSqliteProfiles = [
  {
    member_id: 'member-1',
    discord_user_id: 'discord-123',
    tier: 'fedaykin',
    wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
  },
  {
    member_id: 'member-2',
    discord_user_id: 'discord-456',
    tier: 'naib',
    wallet_address: null,
  },
];

// Sample test data - PostgreSQL profiles
const samplePgProfiles = [
  {
    id: 'pg-profile-1',
    discordId: 'discord-123',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    tier: 'fedaykin',
  },
  {
    id: 'pg-profile-2',
    discordId: 'discord-456',
    walletAddress: null,
    tier: 'naib',
  },
];

// Sample test data - SQLite badges
const sampleSqliteBadges = [
  {
    badge_id: 'og',
    member_id: 'member-1',
    awarded_at: '2024-01-01T00:00:00.000Z',
    discord_user_id: 'discord-123',
  },
  {
    badge_id: 'water_sharer',
    member_id: 'member-1',
    awarded_at: '2024-02-01T00:00:00.000Z',
    discord_user_id: 'discord-123',
  },
];

// Sample test data - PostgreSQL badges
const samplePgBadges = [
  {
    id: 'pg-badge-1',
    profileId: 'pg-profile-1',
    badgeType: 'og',
    awardedAt: new Date('2024-01-01T00:00:00.000Z'),
  },
  {
    id: 'pg-badge-2',
    profileId: 'pg-profile-1',
    badgeType: 'water_sharer',
    awardedAt: new Date('2024-02-01T00:00:00.000Z'),
  },
];

describe('MigrationValidator', () => {
  let validator: MigrationValidator;
  let Database: any;
  let mockSqliteDb: any;
  let mockStatement: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked Database constructor
    const betterSqlite3 = await import('better-sqlite3');
    Database = betterSqlite3.default;

    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
    };

    mockSqliteDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
      close: vi.fn(),
    };

    Database.mockReturnValue(mockSqliteDb);

    // Reset PostgreSQL mock chain
    mockPgDb.select.mockReturnThis();
    mockPgDb.from.mockReturnThis();
    mockPgDb.where.mockReturnThis();
    mockPgDb.limit.mockResolvedValue([]);

    const options: ValidatorOptions = {
      sqliteDbPath: './test-profiles.db',
      communityId: 'community-uuid-123',
      debug: false,
    };

    validator = new MigrationValidator(mockPgDb as any, options);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance with required options', () => {
      const v = new MigrationValidator(mockPgDb as any, {
        sqliteDbPath: './profiles.db',
        communityId: 'test-community',
      });
      expect(v).toBeDefined();
    });

    it('should use factory function', () => {
      const v = createMigrationValidator(mockPgDb as any, {
        sqliteDbPath: './profiles.db',
        communityId: 'test-community',
        debug: true,
      });
      expect(v).toBeInstanceOf(MigrationValidator);
    });

    it('should default debug to false', () => {
      const v = createMigrationValidator(mockPgDb as any, {
        sqliteDbPath: './profiles.db',
        communityId: 'test-community',
      });
      expect(v).toBeDefined();
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validate', () => {
    it('should return valid when all data matches', async () => {
      // SQLite counts
      mockStatement.get
        .mockReturnValueOnce({ count: 2 }) // profiles
        .mockReturnValueOnce({ count: 2 }); // badges

      // PostgreSQL counts
      mockPgDb.where
        .mockResolvedValueOnce([{ count: 2 }]) // profiles
        .mockResolvedValueOnce([{ count: 2 }]); // badges

      // SQLite profile data
      mockStatement.all
        .mockReturnValueOnce(sampleSqliteProfiles)
        .mockReturnValueOnce(sampleSqliteBadges);

      // PostgreSQL profile lookups
      mockPgDb.limit
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce([samplePgProfiles[1]])
        .mockResolvedValueOnce([samplePgProfiles[0]]) // For badge validation
        .mockResolvedValueOnce(samplePgBadges) // Badges for profile 1
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce(samplePgBadges);

      const report = await validator.validate();

      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
      expect(report.profileIssues).toHaveLength(0);
      expect(report.badgeIssues).toHaveLength(0);
    });

    it('should detect profile count mismatch', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 5 }) // SQLite profiles
        .mockReturnValueOnce({ count: 0 }); // SQLite badges

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 3 }]) // PostgreSQL profiles (mismatch)
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);

      const report = await validator.validate();

      expect(report.valid).toBe(false);
      expect(report.errors).toContain(
        'Profile count mismatch: SQLite=5, PostgreSQL=3'
      );
    });

    it('should detect badge count mismatch', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 10 }); // SQLite badges

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 7 }]); // PostgreSQL badges (mismatch)

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);

      const report = await validator.validate();

      expect(report.valid).toBe(false);
      expect(report.errors).toContain(
        'Badge count mismatch: SQLite=10, PostgreSQL=7'
      );
    });

    it('should detect missing profile in PostgreSQL', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }]) // Profile count mismatch
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([sampleSqliteProfiles[0]])
        .mockReturnValueOnce([]);

      // Profile not found in PostgreSQL
      mockPgDb.limit.mockResolvedValueOnce([]);

      const report = await validator.validate();

      expect(report.profileIssues.length).toBeGreaterThan(0);
      expect(report.profileIssues[0].postgresExists).toBe(false);
      expect(report.profileIssues[0].issues).toContain(
        'Profile not found in PostgreSQL'
      );
    });

    it('should detect wallet address mismatch', async () => {
      const sqliteProfile = {
        ...sampleSqliteProfiles[0],
        wallet_address: '0xdifferent1234567890abcdef1234567890abcdef',
      };

      mockStatement.get
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([sqliteProfile])
        .mockReturnValueOnce([]);

      // PostgreSQL has different wallet
      mockPgDb.limit.mockResolvedValueOnce([samplePgProfiles[0]]);

      const report = await validator.validate();

      expect(report.profileIssues.length).toBeGreaterThan(0);
      expect(report.profileIssues[0].walletMatch).toBe(false);
      expect(report.profileIssues[0].issues[0]).toContain('Wallet mismatch');
    });

    it('should detect tier mismatch', async () => {
      const sqliteProfile = {
        ...sampleSqliteProfiles[0],
        tier: 'naib', // Different from PostgreSQL
      };

      mockStatement.get
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([sqliteProfile])
        .mockReturnValueOnce([]);

      mockPgDb.limit.mockResolvedValueOnce([samplePgProfiles[0]]); // tier: fedaykin

      const report = await validator.validate();

      expect(report.profileIssues.length).toBeGreaterThan(0);
      expect(report.profileIssues[0].tierMatch).toBe(false);
      expect(report.profileIssues[0].issues[0]).toContain('Tier mismatch');
    });

    it('should detect missing badge in PostgreSQL', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 1 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]); // Badge count mismatch

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([sampleSqliteBadges[0]]);

      // Profile found
      mockPgDb.limit
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce([]); // No badges found

      const report = await validator.validate();

      expect(report.badgeIssues.length).toBeGreaterThan(0);
      expect(report.badgeIssues[0].postgresExists).toBe(false);
      expect(report.badgeIssues[0].issues).toContain(
        'Badge not found in PostgreSQL'
      );
    });

    it('should detect badge timestamp mismatch', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 1 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 1 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([sampleSqliteBadges[0]]);

      // Profile found, badge found but with different timestamp
      const badgeWithDifferentTime = {
        ...samplePgBadges[0],
        awardedAt: new Date('2024-06-15T00:00:00.000Z'), // Different timestamp
      };

      mockPgDb.limit
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce([badgeWithDifferentTime]);

      const report = await validator.validate();

      expect(report.badgeIssues.length).toBeGreaterThan(0);
      expect(report.badgeIssues[0].timestampMatch).toBe(false);
      expect(report.badgeIssues[0].issues[0]).toContain('Timestamp mismatch');
    });

    it('should report missing parent profile for badge', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 1 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([sampleSqliteBadges[0]]);

      // Profile not found for badge
      mockPgDb.limit.mockResolvedValueOnce([]);

      const report = await validator.validate();

      expect(report.badgeIssues.length).toBeGreaterThan(0);
      expect(report.badgeIssues[0].issues).toContain(
        'Parent profile not found in PostgreSQL'
      );
    });

    it('should close SQLite database after validation', async () => {
      mockStatement.get.mockReturnValue({ count: 0 });
      mockPgDb.where.mockResolvedValue([{ count: 0 }]);
      mockStatement.all.mockReturnValue([]);

      await validator.validate();

      expect(mockSqliteDb.close).toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      Database.mockImplementationOnce(() => {
        throw new Error('Cannot open database');
      });

      const report = await validator.validate();

      expect(report.valid).toBe(false);
      expect(report.errors[0]).toContain('Cannot open database');
    });

    it('should include summary statistics', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 100 })
        .mockReturnValueOnce({ count: 50 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 100 }])
        .mockResolvedValueOnce([{ count: 50 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);

      const report = await validator.validate();

      expect(report.summary.totalProfiles.sqlite).toBe(100);
      expect(report.summary.totalProfiles.postgres).toBe(100);
      expect(report.summary.totalBadges.sqlite).toBe(50);
      expect(report.summary.totalBadges.postgres).toBe(50);
    });

    it('should include timestamp in report', async () => {
      mockStatement.get.mockReturnValue({ count: 0 });
      mockPgDb.where.mockResolvedValue([{ count: 0 }]);
      mockStatement.all.mockReturnValue([]);

      const before = new Date();
      const report = await validator.validate();
      const after = new Date();

      expect(report.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(report.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should include community ID in report', async () => {
      mockStatement.get.mockReturnValue({ count: 0 });
      mockPgDb.where.mockResolvedValue([{ count: 0 }]);
      mockStatement.all.mockReturnValue([]);

      const report = await validator.validate();

      expect(report.communityId).toBe('community-uuid-123');
    });
  });

  // ===========================================================================
  // Report Generation Tests
  // ===========================================================================

  describe('generateReport', () => {
    it('should generate markdown report with valid status', async () => {
      mockStatement.get.mockReturnValue({ count: 0 });
      mockPgDb.where.mockResolvedValue([{ count: 0 }]);
      mockStatement.all.mockReturnValue([]);

      const markdown = await validator.generateReport();

      expect(markdown).toContain('# Migration Validation Report');
      expect(markdown).toContain('**Status**: VALID');
      expect(markdown).toContain('## Summary');
    });

    it('should generate markdown report with issues', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 5 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 3 }]) // Mismatch
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all.mockReturnValue([]);

      const markdown = await validator.generateReport();

      expect(markdown).toContain('**Status**: ISSUES FOUND');
      expect(markdown).toContain('## Errors');
      expect(markdown).toContain('Profile count mismatch');
    });

    it('should include profile issues section when present', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([sampleSqliteProfiles[0]])
        .mockReturnValueOnce([]);

      mockPgDb.limit.mockResolvedValueOnce([]); // Profile not found

      const markdown = await validator.generateReport();

      expect(markdown).toContain('## Profile Issues');
      expect(markdown).toContain('discord-123');
    });

    it('should include badge issues section when present', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 1 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([sampleSqliteBadges[0]]);

      mockPgDb.limit
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce([]); // Badge not found

      const markdown = await validator.generateReport();

      expect(markdown).toContain('## Badge Issues');
      expect(markdown).toContain('og');
    });

    it('should include match/mismatch indicators in table', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 10 })
        .mockReturnValueOnce({ count: 5 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 10 }]) // Match
        .mockResolvedValueOnce([{ count: 3 }]); // Mismatch

      mockStatement.all.mockReturnValue([]);

      const markdown = await validator.generateReport();

      expect(markdown).toContain('✅'); // Profile match
      expect(markdown).toContain('❌'); // Badge mismatch
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle case-insensitive wallet comparison', async () => {
      const sqliteProfileUppercase = {
        ...sampleSqliteProfiles[0],
        wallet_address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
      };

      const pgProfileLowercase = {
        ...samplePgProfiles[0],
        walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
      };

      mockStatement.get
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([sqliteProfileUppercase])
        .mockReturnValueOnce([]);

      mockPgDb.limit.mockResolvedValueOnce([pgProfileLowercase]);

      const report = await validator.validate();

      // Should match because both are normalized to lowercase
      expect(report.profileIssues).toHaveLength(0);
    });

    it('should handle null wallets matching', async () => {
      const sqliteProfileNullWallet = {
        ...sampleSqliteProfiles[1], // Has null wallet
      };

      const pgProfileNullWallet = {
        ...samplePgProfiles[1], // Has null wallet
      };

      mockStatement.get
        .mockReturnValueOnce({ count: 1 })
        .mockReturnValueOnce({ count: 0 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ count: 0 }]);

      mockStatement.all
        .mockReturnValueOnce([sqliteProfileNullWallet])
        .mockReturnValueOnce([]);

      mockPgDb.limit.mockResolvedValueOnce([pgProfileNullWallet]);

      const report = await validator.validate();

      // Null wallets should match
      const profileIssue = report.profileIssues.find(
        (p) => p.discordId === 'discord-456'
      );
      expect(profileIssue?.walletMatch ?? true).toBe(true);
    });

    it('should allow 1 second timestamp tolerance', async () => {
      // Badge with timestamp 500ms different
      const sqliteBadge = {
        ...sampleSqliteBadges[0],
        awarded_at: '2024-01-01T00:00:00.000Z',
      };

      const pgBadge = {
        ...samplePgBadges[0],
        awardedAt: new Date('2024-01-01T00:00:00.500Z'), // 500ms later
      };

      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 1 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 1 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([sqliteBadge]);

      mockPgDb.limit
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce([pgBadge]);

      const report = await validator.validate();

      // Should not flag as mismatch due to tolerance
      const badgeIssue = report.badgeIssues.find(
        (b) => b.badgeType === 'og'
      );
      expect(badgeIssue?.timestampMatch ?? true).toBe(true);
    });

    it('should normalize badge type for comparison', async () => {
      // SQLite uses 'Water-Sharer', PostgreSQL uses 'water_sharer'
      const sqliteBadge = {
        ...sampleSqliteBadges[0],
        badge_id: 'Water-Sharer',
      };

      const pgBadge = {
        ...samplePgBadges[0],
        badgeType: 'water_sharer',
      };

      mockStatement.get
        .mockReturnValueOnce({ count: 0 })
        .mockReturnValueOnce({ count: 1 });

      mockPgDb.where
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([{ count: 1 }]);

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([sqliteBadge]);

      mockPgDb.limit
        .mockResolvedValueOnce([samplePgProfiles[0]])
        .mockResolvedValueOnce([pgBadge]);

      const report = await validator.validate();

      // Should find the badge after normalization
      expect(report.badgeIssues.filter((b) => !b.postgresExists)).toHaveLength(0);
    });
  });
});
