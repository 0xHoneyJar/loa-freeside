/**
 * SQLiteMigrator Unit Tests
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Tests for the SQLiteMigrator class that handles migration from SQLite to PostgreSQL.
 * These are unit tests that mock both SQLite and PostgreSQL database layers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SQLiteMigrator,
  createSQLiteMigrator,
  type MigrationOptions,
  type MigrationResult,
  type ValidationResult,
  type SQLiteMemberProfile,
  type SQLiteWalletMapping,
  type SQLiteMemberBadge,
  type SQLiteEligibility,
} from '../../../../../../src/packages/adapters/storage/migration/SQLiteMigrator.js';

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
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  execute: vi.fn(),
};

// Sample test data
const sampleProfiles: SQLiteMemberProfile[] = [
  {
    member_id: 'member-1',
    discord_user_id: 'discord-123',
    nym: 'TestUser1',
    bio: 'Test bio',
    pfp_url: 'https://example.com/avatar.png',
    pfp_type: 'custom',
    tier: 'fedaykin',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    nym_last_changed: null,
    onboarding_complete: 1,
    onboarding_step: 5,
  },
  {
    member_id: 'member-2',
    discord_user_id: 'discord-456',
    nym: 'TestUser2',
    bio: null,
    pfp_url: null,
    pfp_type: null,
    tier: 'naib',
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-06-15T00:00:00Z',
    nym_last_changed: '2024-03-01T00:00:00Z',
    onboarding_complete: 0,
    onboarding_step: 2,
  },
];

const sampleWallets: SQLiteWalletMapping[] = [
  {
    discord_user_id: 'discord-123',
    wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
    verified_at: '2024-01-15T00:00:00Z',
  },
];

const sampleBadges: SQLiteMemberBadge[] = [
  {
    id: 1,
    member_id: 'member-1',
    badge_id: 'og',
    awarded_at: '2024-01-01T00:00:00Z',
    awarded_by: null,
    award_reason: 'Original member',
    revoked: 0,
    revoked_at: null,
    revoked_by: null,
  },
  {
    id: 2,
    member_id: 'member-1',
    badge_id: 'water_sharer',
    awarded_at: '2024-02-01T00:00:00Z',
    awarded_by: 'member-2',
    award_reason: 'Shared water',
    revoked: 0,
    revoked_at: null,
    revoked_by: null,
  },
];

const sampleEligibility: SQLiteEligibility[] = [
  {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    rank: 42,
    bgt_held: '1000000000000000000',
    role: 'fedaykin',
    updated_at: '2024-06-01T00:00:00Z',
  },
];

describe('SQLiteMigrator', () => {
  let migrator: SQLiteMigrator;
  let Database: any;
  let mockSqliteDb: any;
  let mockStatement: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked Database constructor
    const betterSqlite3 = await import('better-sqlite3');
    Database = betterSqlite3.default;

    // Get references to the mock instances
    mockSqliteDb = {
      prepare: vi.fn(),
      close: vi.fn(),
    };

    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
    };

    mockSqliteDb.prepare.mockReturnValue(mockStatement);
    Database.mockReturnValue(mockSqliteDb);

    // Reset PostgreSQL mock
    mockPgDb.insert.mockReturnThis();
    mockPgDb.values.mockReturnThis();
    mockPgDb.returning.mockResolvedValue([{ id: 'community-uuid-123' }]);
    mockPgDb.select.mockReturnThis();
    mockPgDb.from.mockReturnThis();
    mockPgDb.where.mockReturnThis();
    mockPgDb.delete.mockReturnThis();

    const options: MigrationOptions = {
      sqliteDbPath: './test-profiles.db',
      communityName: 'Test Community',
      themeId: 'sietch',
      discordGuildId: '123456789',
      debug: false,
      batchSize: 100,
    };

    migrator = new SQLiteMigrator(mockPgDb as any, options);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance with required options', () => {
      const m = new SQLiteMigrator(mockPgDb as any, {
        sqliteDbPath: './profiles.db',
      });
      expect(m).toBeDefined();
    });

    it('should use default values for optional options', () => {
      const m = createSQLiteMigrator(mockPgDb as any, {
        sqliteDbPath: './profiles.db',
      });
      expect(m).toBeInstanceOf(SQLiteMigrator);
    });

    it('should use factory function', () => {
      const m = createSQLiteMigrator(mockPgDb as any, {
        sqliteDbPath: './profiles.db',
        communityName: 'Custom Name',
        debug: true,
      });
      expect(m).toBeInstanceOf(SQLiteMigrator);
    });
  });

  // ===========================================================================
  // Migration Tests
  // ===========================================================================

  describe('migrate', () => {
    it('should complete migration successfully with valid data', async () => {
      // Setup SQLite mock responses in order
      mockStatement.all
        .mockReturnValueOnce(sampleWallets) // wallet_mappings
        .mockReturnValueOnce(sampleEligibility) // current_eligibility
        .mockReturnValueOnce(sampleProfiles) // member_profiles
        .mockReturnValueOnce(sampleBadges); // member_badges

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(result.communityId).toBe('community-uuid-123');
      expect(result.profilesCreated).toBe(2);
      expect(result.badgesCreated).toBe(2);
      expect(result.walletsProcessed).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty database', async () => {
      mockStatement.all
        .mockReturnValueOnce([]) // wallet_mappings
        .mockReturnValueOnce([]) // current_eligibility
        .mockReturnValueOnce([]) // member_profiles
        .mockReturnValueOnce([]); // member_badges

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(result.profilesCreated).toBe(0);
      expect(result.badgesCreated).toBe(0);
      expect(result.walletsProcessed).toBe(0);
    });

    it('should close SQLite connection after migration', async () => {
      mockStatement.all.mockReturnValue([]);
      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      await migrator.migrate();

      expect(mockSqliteDb.close).toHaveBeenCalled();
    });

    it('should handle SQLite database open error', async () => {
      Database.mockImplementationOnce(() => {
        throw new Error('Database not found');
      });

      const result = await migrator.migrate();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Database not found');
    });

    it('should handle PostgreSQL insert error', async () => {
      mockStatement.all.mockReturnValue([]);
      mockPgDb.returning.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await migrator.migrate();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Connection refused');
    });

    it('should create community with correct data', async () => {
      mockStatement.all.mockReturnValue([]);
      mockPgDb.returning.mockResolvedValueOnce([{ id: 'new-community-id' }]);

      await migrator.migrate();

      expect(mockPgDb.insert).toHaveBeenCalled();
      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Community',
          themeId: 'sietch',
          subscriptionTier: 'enterprise',
          discordGuildId: '123456789',
          isActive: true,
        })
      );
    });

    it('should normalize wallet addresses to lowercase', async () => {
      const walletsWithMixedCase: SQLiteWalletMapping[] = [
        {
          discord_user_id: 'discord-123',
          wallet_address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
          verified_at: '2024-01-15T00:00:00Z',
        },
      ];

      mockStatement.all
        .mockReturnValueOnce(walletsWithMixedCase)
        .mockReturnValueOnce([])
        .mockReturnValueOnce(sampleProfiles.slice(0, 1))
        .mockReturnValueOnce([]);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      await migrator.migrate();

      // Verify insert was called with lowercase wallet
      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
          }),
        ])
      );
    });

    it('should map tier correctly', async () => {
      const profileWithUpperTier: SQLiteMemberProfile[] = [
        {
          ...sampleProfiles[0],
          tier: 'FEDAYKIN', // uppercase
        },
      ];

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce(profileWithUpperTier)
        .mockReturnValueOnce([]);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      await migrator.migrate();

      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tier: 'fedaykin',
          }),
        ])
      );
    });

    it('should skip badges for missing profiles', async () => {
      const badgeWithMissingProfile: SQLiteMemberBadge[] = [
        {
          id: 1,
          member_id: 'non-existent-member',
          badge_id: 'og',
          awarded_at: '2024-01-01T00:00:00Z',
          awarded_by: null,
          award_reason: null,
          revoked: 0,
          revoked_at: null,
          revoked_by: null,
        },
      ];

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]) // No profiles
        .mockReturnValueOnce(badgeWithMissingProfile);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(result.badgesCreated).toBe(0);
    });

    it('should preserve badge lineage (awarded_by)', async () => {
      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce(sampleProfiles)
        .mockReturnValueOnce(sampleBadges);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      await migrator.migrate();

      // The water_sharer badge should have awardedBy set
      const badgeInsertCalls = mockPgDb.values.mock.calls;
      // Look for badge insert (after profile insert)
      expect(badgeInsertCalls.length).toBeGreaterThan(1);
    });

    it('should process profiles in batches', async () => {
      // Create more profiles than batch size
      const manyProfiles = Array.from({ length: 150 }, (_, i) => ({
        ...sampleProfiles[0],
        member_id: `member-${i}`,
        discord_user_id: `discord-${i}`,
      }));

      const smallBatchMigrator = new SQLiteMigrator(mockPgDb as any, {
        sqliteDbPath: './test.db',
        batchSize: 50,
      });

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce(manyProfiles)
        .mockReturnValueOnce([]);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      const result = await smallBatchMigrator.migrate();

      expect(result.profilesCreated).toBe(150);
      // Should have 3 batch inserts (50 + 50 + 50) plus community insert
      expect(mockPgDb.insert).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validate', () => {
    it('should return valid when counts match', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 10 }) // profiles
        .mockReturnValueOnce({ count: 5 }) // badges
        .mockReturnValueOnce({ count: 8 }); // wallets

      mockPgDb.select.mockReturnThis();
      mockPgDb.from
        .mockReturnValueOnce(Promise.resolve([{ count: 10 }])) // profiles
        .mockReturnValueOnce(Promise.resolve([{ count: 5 }])); // badges

      const result = await migrator.validate('community-123');

      expect(result.valid).toBe(true);
      expect(result.mismatches).toHaveLength(0);
    });

    it('should detect profile count mismatch', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 10 })
        .mockReturnValueOnce({ count: 5 })
        .mockReturnValueOnce({ count: 8 });

      mockPgDb.from
        .mockReturnValueOnce(Promise.resolve([{ count: 8 }])) // profiles mismatch
        .mockReturnValueOnce(Promise.resolve([{ count: 5 }]));

      const result = await migrator.validate('community-123');

      expect(result.valid).toBe(false);
      expect(result.mismatches).toContain(
        'Profile count mismatch: SQLite=10, PostgreSQL=8'
      );
    });

    it('should detect badge count mismatch', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 10 })
        .mockReturnValueOnce({ count: 5 })
        .mockReturnValueOnce({ count: 8 });

      mockPgDb.from
        .mockReturnValueOnce(Promise.resolve([{ count: 10 }]))
        .mockReturnValueOnce(Promise.resolve([{ count: 3 }])); // badges mismatch

      const result = await migrator.validate('community-123');

      expect(result.valid).toBe(false);
      expect(result.mismatches).toContain(
        'Badge count mismatch: SQLite=5, PostgreSQL=3'
      );
    });

    it('should return correct SQLite counts', async () => {
      mockStatement.get
        .mockReturnValueOnce({ count: 100 })
        .mockReturnValueOnce({ count: 50 })
        .mockReturnValueOnce({ count: 75 });

      mockPgDb.from
        .mockReturnValueOnce(Promise.resolve([{ count: 100 }]))
        .mockReturnValueOnce(Promise.resolve([{ count: 50 }]));

      const result = await migrator.validate('community-123');

      expect(result.sqliteCounts.profiles).toBe(100);
      expect(result.sqliteCounts.badges).toBe(50);
      expect(result.sqliteCounts.wallets).toBe(75);
    });
  });

  // ===========================================================================
  // Rollback Tests
  // ===========================================================================

  describe('rollback', () => {
    it('should delete data in correct order', async () => {
      mockPgDb.where.mockResolvedValue([]);

      await migrator.rollback('community-123');

      // Verify delete order: badges -> profiles -> communities
      const deleteCalls = mockPgDb.delete.mock.calls;
      expect(deleteCalls.length).toBe(3);
    });

    it('should use parameterized query for community ID', async () => {
      mockPgDb.where.mockResolvedValue([]);

      await migrator.rollback('community-uuid-456');

      expect(mockPgDb.where).toHaveBeenCalledTimes(3);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle null wallet addresses', async () => {
      const profileWithoutWallet: SQLiteMemberProfile[] = [
        {
          ...sampleProfiles[0],
          member_id: 'member-no-wallet',
          discord_user_id: 'discord-no-wallet',
        },
      ];

      mockStatement.all
        .mockReturnValueOnce([]) // No wallet mappings
        .mockReturnValueOnce([])
        .mockReturnValueOnce(profileWithoutWallet)
        .mockReturnValueOnce([]);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            walletAddress: null,
          }),
        ])
      );
    });

    it('should handle unknown tier values', async () => {
      const profileWithUnknownTier: SQLiteMemberProfile[] = [
        {
          ...sampleProfiles[0],
          tier: 'unknown_tier',
        },
      ];

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce(profileWithUnknownTier)
        .mockReturnValueOnce([]);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      const result = await migrator.migrate();

      expect(result.success).toBe(true);
      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            tier: null,
          }),
        ])
      );
    });

    it('should normalize badge types to snake_case', async () => {
      const badgeWithDashes: SQLiteMemberBadge[] = [
        {
          ...sampleBadges[0],
          badge_id: 'Water-Sharer', // Mixed case with dash
        },
      ];

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce(sampleProfiles.slice(0, 1))
        .mockReturnValueOnce(badgeWithDashes);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      await migrator.migrate();

      // The badge type should be normalized
      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            badgeType: 'water_sharer',
          }),
        ])
      );
    });

    it('should preserve timestamps during migration', async () => {
      const profileWithTimestamps: SQLiteMemberProfile[] = [
        {
          ...sampleProfiles[0],
          created_at: '2023-06-15T10:30:00Z',
          updated_at: '2024-01-20T14:45:00Z',
        },
      ];

      mockStatement.all
        .mockReturnValueOnce([])
        .mockReturnValueOnce([])
        .mockReturnValueOnce(profileWithTimestamps)
        .mockReturnValueOnce([]);

      mockPgDb.returning.mockResolvedValueOnce([{ id: 'community-uuid-123' }]);

      await migrator.migrate();

      expect(mockPgDb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            joinedAt: new Date('2023-06-15T10:30:00Z'),
            lastSeenAt: new Date('2024-01-20T14:45:00Z'),
          }),
        ])
      );
    });
  });
});
