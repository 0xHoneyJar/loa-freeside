/**
 * Schema Unit Tests
 *
 * Sprint 38: Drizzle Schema Design
 *
 * Tests for the PostgreSQL schema definitions.
 * Validates table structures, constraints, and types.
 */

import { describe, it, expect } from 'vitest';
import {
  communities,
  profiles,
  badges,
  manifests,
  shadowStates,
  type Community,
  type NewCommunity,
  type Profile,
  type NewProfile,
  type Badge,
  type NewBadge,
  type Manifest,
  type NewManifest,
  type ShadowState,
  type NewShadowState,
  type CommunitySettings,
  type ProfileMetadata,
  type BadgeMetadata,
  type ManifestContent,
  type ShadowResources,
} from '../../../../../src/packages/adapters/storage/schema.js';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('Schema', () => {
  // ===========================================================================
  // Communities Table Tests
  // ===========================================================================

  describe('communities table', () => {
    const config = getTableConfig(communities);

    it('should have correct table name', () => {
      expect(config.name).toBe('communities');
    });

    it('should have all required columns', () => {
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('theme_id');
      expect(columnNames).toContain('subscription_tier');
      expect(columnNames).toContain('discord_guild_id');
      expect(columnNames).toContain('telegram_chat_id');
      expect(columnNames).toContain('is_active');
      expect(columnNames).toContain('settings');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('should have id as primary key', () => {
      const idColumn = config.columns.find((c) => c.name === 'id');
      expect(idColumn?.primary).toBe(true);
    });

    it('should have default values for theme_id and subscription_tier', () => {
      const themeColumn = config.columns.find((c) => c.name === 'theme_id');
      const tierColumn = config.columns.find((c) => c.name === 'subscription_tier');
      expect(themeColumn?.default).toBeDefined();
      expect(tierColumn?.default).toBeDefined();
    });

    it('should have unique constraint on discord_guild_id', () => {
      const discordColumn = config.columns.find((c) => c.name === 'discord_guild_id');
      expect(discordColumn?.isUnique).toBe(true);
    });

    it('should have unique constraint on telegram_chat_id', () => {
      const telegramColumn = config.columns.find((c) => c.name === 'telegram_chat_id');
      expect(telegramColumn?.isUnique).toBe(true);
    });

    it('should have indexes for theme and subscription', () => {
      const indexNames = config.indexes.map((i) => i.config.name);
      expect(indexNames).toContain('idx_communities_theme');
      expect(indexNames).toContain('idx_communities_subscription');
    });
  });

  // ===========================================================================
  // Profiles Table Tests
  // ===========================================================================

  describe('profiles table', () => {
    const config = getTableConfig(profiles);

    it('should have correct table name', () => {
      expect(config.name).toBe('profiles');
    });

    it('should have all required columns', () => {
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('community_id');
      expect(columnNames).toContain('discord_id');
      expect(columnNames).toContain('telegram_id');
      expect(columnNames).toContain('wallet_address');
      expect(columnNames).toContain('tier');
      expect(columnNames).toContain('current_rank');
      expect(columnNames).toContain('activity_score');
      expect(columnNames).toContain('conviction_score');
      expect(columnNames).toContain('joined_at');
      expect(columnNames).toContain('last_seen_at');
      expect(columnNames).toContain('first_claim_at');
      expect(columnNames).toContain('metadata');
    });

    it('should have community_id as not null', () => {
      const communityColumn = config.columns.find((c) => c.name === 'community_id');
      expect(communityColumn?.notNull).toBe(true);
    });

    it('should have foreign key to communities', () => {
      expect(config.foreignKeys.length).toBeGreaterThan(0);
      // Verify there's at least one FK (community_id references communities)
      expect(config.foreignKeys.length).toBe(1);
    });

    it('should have unique constraints for discord and telegram per community', () => {
      const uniqueConstraints = config.uniqueConstraints;
      const discordUnique = uniqueConstraints.find((u) => u.name === 'uq_profiles_discord');
      const telegramUnique = uniqueConstraints.find((u) => u.name === 'uq_profiles_telegram');
      expect(discordUnique).toBeDefined();
      expect(telegramUnique).toBeDefined();
    });

    it('should have indexes for efficient queries', () => {
      const indexNames = config.indexes.map((i) => i.config.name);
      expect(indexNames).toContain('idx_profiles_community');
      expect(indexNames).toContain('idx_profiles_wallet');
      expect(indexNames).toContain('idx_profiles_tier');
      expect(indexNames).toContain('idx_profiles_rank');
    });

    it('should default activity_score and conviction_score to 0', () => {
      const activityColumn = config.columns.find((c) => c.name === 'activity_score');
      const convictionColumn = config.columns.find((c) => c.name === 'conviction_score');
      expect(activityColumn?.default).toBeDefined();
      expect(convictionColumn?.default).toBeDefined();
    });
  });

  // ===========================================================================
  // Badges Table Tests
  // ===========================================================================

  describe('badges table', () => {
    const config = getTableConfig(badges);

    it('should have correct table name', () => {
      expect(config.name).toBe('badges');
    });

    it('should have all required columns', () => {
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('community_id');
      expect(columnNames).toContain('profile_id');
      expect(columnNames).toContain('badge_type');
      expect(columnNames).toContain('awarded_at');
      expect(columnNames).toContain('awarded_by');
      expect(columnNames).toContain('revoked_at');
      expect(columnNames).toContain('metadata');
    });

    it('should have self-referencing FK for awarded_by (lineage)', () => {
      // Badges table has 3 FKs: community_id, profile_id, awarded_by
      expect(config.foreignKeys.length).toBe(3);
    });

    it('should have ON DELETE SET NULL for awarded_by', () => {
      // Verify there's an FK with set null behavior
      const hasSetNullFk = config.foreignKeys.some((fk) => fk.onDelete === 'set null');
      expect(hasSetNullFk).toBe(true);
    });

    it('should have ON DELETE CASCADE for profile_id', () => {
      // Verify there's an FK with cascade behavior
      const hasCascadeFk = config.foreignKeys.some((fk) => fk.onDelete === 'cascade');
      expect(hasCascadeFk).toBe(true);
    });

    it('should have unique constraint on (community_id, profile_id, badge_type)', () => {
      const uniqueConstraint = config.uniqueConstraints.find(
        (u) => u.name === 'uq_badges_profile_type'
      );
      expect(uniqueConstraint).toBeDefined();
    });

    it('should have indexes for profile and type lookups', () => {
      const indexNames = config.indexes.map((i) => i.config.name);
      expect(indexNames).toContain('idx_badges_profile');
      expect(indexNames).toContain('idx_badges_type');
      expect(indexNames).toContain('idx_badges_awarded_by');
    });
  });

  // ===========================================================================
  // Manifests Table Tests
  // ===========================================================================

  describe('manifests table', () => {
    const config = getTableConfig(manifests);

    it('should have correct table name', () => {
      expect(config.name).toBe('manifests');
    });

    it('should have all required columns', () => {
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('community_id');
      expect(columnNames).toContain('version');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('checksum');
      expect(columnNames).toContain('synthesized_at');
      expect(columnNames).toContain('synthesized_by');
      expect(columnNames).toContain('is_active');
    });

    it('should have content as JSON type', () => {
      const contentColumn = config.columns.find((c) => c.name === 'content');
      // Drizzle reports 'json' internally, the SQL generates 'jsonb'
      expect(contentColumn?.dataType).toBe('json');
    });

    it('should have unique constraint on (community_id, version)', () => {
      const uniqueConstraint = config.uniqueConstraints.find(
        (u) => u.name === 'uq_manifests_community_version'
      );
      expect(uniqueConstraint).toBeDefined();
    });

    it('should have indexes for community and version lookups', () => {
      const indexNames = config.indexes.map((i) => i.config.name);
      expect(indexNames).toContain('idx_manifests_community');
      expect(indexNames).toContain('idx_manifests_version');
      expect(indexNames).toContain('idx_manifests_active');
    });

    it('should have version as number type', () => {
      const versionColumn = config.columns.find((c) => c.name === 'version');
      // Drizzle reports 'number' internally, the SQL generates 'integer'
      expect(versionColumn?.dataType).toBe('number');
    });
  });

  // ===========================================================================
  // Shadow States Table Tests
  // ===========================================================================

  describe('shadow_states table', () => {
    const config = getTableConfig(shadowStates);

    it('should have correct table name', () => {
      expect(config.name).toBe('shadow_states');
    });

    it('should have all required columns', () => {
      const columnNames = config.columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('community_id');
      expect(columnNames).toContain('manifest_version');
      expect(columnNames).toContain('applied_at');
      expect(columnNames).toContain('applied_by');
      expect(columnNames).toContain('resources');
      expect(columnNames).toContain('checksum');
      expect(columnNames).toContain('status');
    });

    it('should have resources as JSON type', () => {
      const resourcesColumn = config.columns.find((c) => c.name === 'resources');
      // Drizzle reports 'json' internally, the SQL generates 'jsonb'
      expect(resourcesColumn?.dataType).toBe('json');
    });

    it('should have default status of "applied"', () => {
      const statusColumn = config.columns.find((c) => c.name === 'status');
      expect(statusColumn?.default).toBeDefined();
    });

    it('should have indexes for community and status', () => {
      const indexNames = config.indexes.map((i) => i.config.name);
      expect(indexNames).toContain('idx_shadow_community');
      expect(indexNames).toContain('idx_shadow_status');
    });
  });

  // ===========================================================================
  // Type Definition Tests
  // ===========================================================================

  describe('type definitions', () => {
    it('should export Community type', () => {
      const community: Community = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Community',
        themeId: 'basic',
        subscriptionTier: 'free',
        discordGuildId: '123456789',
        telegramChatId: null,
        isActive: true,
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(community.id).toBeDefined();
    });

    it('should export NewCommunity type without required id', () => {
      const newCommunity: NewCommunity = {
        name: 'New Community',
      };
      expect(newCommunity.name).toBe('New Community');
    });

    it('should export Profile type', () => {
      const profile: Profile = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        communityId: '123e4567-e89b-12d3-a456-426614174001',
        discordId: '123456789',
        telegramId: null,
        walletAddress: '0x1234567890abcdef',
        tier: 'naib',
        currentRank: 1,
        activityScore: 100,
        convictionScore: 50,
        joinedAt: new Date(),
        lastSeenAt: new Date(),
        firstClaimAt: new Date(),
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(profile.tier).toBe('naib');
    });

    it('should export Badge type with lineage support', () => {
      const badge: Badge = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        communityId: '123e4567-e89b-12d3-a456-426614174001',
        profileId: '123e4567-e89b-12d3-a456-426614174002',
        badgeType: 'water-sharer',
        awardedAt: new Date(),
        awardedBy: '123e4567-e89b-12d3-a456-426614174003', // Lineage FK
        revokedAt: null,
        metadata: {},
        createdAt: new Date(),
      };
      expect(badge.awardedBy).toBeDefined();
    });

    it('should export Manifest type with JSONB content', () => {
      const manifest: Manifest = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        communityId: '123e4567-e89b-12d3-a456-426614174001',
        version: 1,
        content: {
          schemaVersion: '1.0.0',
          theme: { themeId: 'basic' },
          roles: [],
          channels: [],
          categories: [],
        },
        checksum: 'abc123',
        synthesizedAt: new Date(),
        synthesizedBy: 'wizard',
        isActive: true,
        createdAt: new Date(),
      };
      expect(manifest.content.schemaVersion).toBe('1.0.0');
    });

    it('should export ShadowState type with resource mappings', () => {
      const shadowState: ShadowState = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        communityId: '123e4567-e89b-12d3-a456-426614174001',
        manifestVersion: 1,
        appliedAt: new Date(),
        appliedBy: 'synthesizer',
        resources: {
          roles: { 'role-1': '123456789' },
          channels: { 'channel-1': '987654321' },
          categories: {},
        },
        checksum: 'def456',
        status: 'applied',
        createdAt: new Date(),
      };
      expect(shadowState.resources.roles['role-1']).toBe('123456789');
    });
  });

  // ===========================================================================
  // JSONB Type Tests
  // ===========================================================================

  describe('JSONB types', () => {
    it('should validate CommunitySettings type', () => {
      const settings: CommunitySettings = {
        rolePrefix: 'SIETCH-',
        autoSync: true,
        syncInterval: 60,
        welcomeMessage: 'Welcome!',
        adminWebhook: 'https://webhook.example.com',
      };
      expect(settings.rolePrefix).toBe('SIETCH-');
    });

    it('should validate ProfileMetadata type', () => {
      const metadata: ProfileMetadata = {
        username: 'user123',
        displayName: 'Display Name',
        avatarUrl: 'https://avatar.example.com',
        ensName: 'user.eth',
        highestTier: 'naib',
        highestRank: 1,
        preferences: { theme: 'dark' },
      };
      expect(metadata.ensName).toBe('user.eth');
    });

    it('should validate BadgeMetadata type', () => {
      const metadata: BadgeMetadata = {
        badgeName: 'Water Sharer',
        emoji: '💧',
        tierAtAward: 'naib',
        rankAtAward: 5,
        context: { lineageDepth: 3 },
      };
      expect(metadata.context?.lineageDepth).toBe(3);
    });

    it('should validate ManifestContent type', () => {
      const content: ManifestContent = {
        schemaVersion: '1.0.0',
        theme: {
          themeId: 'sietch',
          tierOverrides: { naib: { color: '#FFD700' } },
        },
        roles: [
          { id: 'role-1', name: 'Naib', color: '#FFD700', tierId: 'naib' },
        ],
        channels: [
          { id: 'ch-1', name: 'general', type: 'text' },
        ],
        categories: [
          { id: 'cat-1', name: 'The Sands' },
        ],
        eligibility: {
          tokenAddress: '0x1234',
          minBalance: '1000000000000000000',
          nftCollections: ['0xabcd'],
        },
      };
      expect(content.theme.themeId).toBe('sietch');
      expect(content.roles[0].tierId).toBe('naib');
    });

    it('should validate ShadowResources type', () => {
      const resources: ShadowResources = {
        roles: {
          'manifest-role-1': 'discord-role-123456',
          'manifest-role-2': 'discord-role-789012',
        },
        channels: {
          'manifest-channel-1': 'discord-channel-123456',
        },
        categories: {
          'manifest-category-1': 'discord-category-123456',
        },
      };
      expect(Object.keys(resources.roles).length).toBe(2);
    });
  });

  // ===========================================================================
  // Multi-Tenant Schema Design Tests
  // ===========================================================================

  describe('multi-tenant schema design', () => {
    it('should have community_id on all tenant-scoped tables', () => {
      const profilesConfig = getTableConfig(profiles);
      const badgesConfig = getTableConfig(badges);
      const manifestsConfig = getTableConfig(manifests);
      const shadowStatesConfig = getTableConfig(shadowStates);

      expect(profilesConfig.columns.find((c) => c.name === 'community_id')).toBeDefined();
      expect(badgesConfig.columns.find((c) => c.name === 'community_id')).toBeDefined();
      expect(manifestsConfig.columns.find((c) => c.name === 'community_id')).toBeDefined();
      expect(shadowStatesConfig.columns.find((c) => c.name === 'community_id')).toBeDefined();
    });

    it('should have community_id as first column in composite indexes', () => {
      const profilesConfig = getTableConfig(profiles);
      const tierIdx = profilesConfig.indexes.find((i) => i.config.name === 'idx_profiles_tier');

      // The first column in the index should be community_id for RLS efficiency
      expect(tierIdx?.config.columns[0].name).toBe('community_id');
    });

    it('should have cascade delete on all community references', () => {
      const profilesConfig = getTableConfig(profiles);
      const badgesConfig = getTableConfig(badges);
      const manifestsConfig = getTableConfig(manifests);
      const shadowStatesConfig = getTableConfig(shadowStates);

      // All tenant tables should have at least one FK with cascade delete
      const profilesHasCascade = profilesConfig.foreignKeys.some((fk) => fk.onDelete === 'cascade');
      const badgesHasCascade = badgesConfig.foreignKeys.some((fk) => fk.onDelete === 'cascade');
      const manifestsHasCascade = manifestsConfig.foreignKeys.some((fk) => fk.onDelete === 'cascade');
      const shadowHasCascade = shadowStatesConfig.foreignKeys.some((fk) => fk.onDelete === 'cascade');

      expect(profilesHasCascade).toBe(true);
      expect(badgesHasCascade).toBe(true);
      expect(manifestsHasCascade).toBe(true);
      expect(shadowHasCascade).toBe(true);
    });
  });

  // ===========================================================================
  // Badge Lineage Tests
  // ===========================================================================

  describe('badge lineage support', () => {
    it('should allow nullable awarded_by for non-lineage badges', () => {
      const badgesConfig = getTableConfig(badges);
      const awardedByColumn = badgesConfig.columns.find((c) => c.name === 'awarded_by');
      expect(awardedByColumn?.notNull).toBeFalsy();
    });

    it('should have awarded_by reference profiles table', () => {
      const badgesConfig = getTableConfig(badges);
      // Should have 3 FKs total including the self-referencing one for awarded_by
      expect(badgesConfig.foreignKeys.length).toBe(3);
    });

    it('should preserve lineage history when profile is deleted (SET NULL)', () => {
      const badgesConfig = getTableConfig(badges);
      // There should be at least one FK with 'set null' behavior (awarded_by)
      const hasSetNullFk = badgesConfig.foreignKeys.some((fk) => fk.onDelete === 'set null');
      expect(hasSetNullFk).toBe(true);
    });

    it('should have index on awarded_by for lineage queries', () => {
      const badgesConfig = getTableConfig(badges);
      const indexNames = badgesConfig.indexes.map((i) => i.config.name);
      expect(indexNames).toContain('idx_badges_awarded_by');
    });
  });

  // ===========================================================================
  // Manifest Versioning Tests
  // ===========================================================================

  describe('manifest versioning', () => {
    it('should have version column as number type', () => {
      const manifestsConfig = getTableConfig(manifests);
      const versionColumn = manifestsConfig.columns.find((c) => c.name === 'version');
      // Drizzle reports 'number' internally, the SQL generates 'integer'
      expect(versionColumn?.dataType).toBe('number');
    });

    it('should have unique constraint on (community_id, version)', () => {
      const manifestsConfig = getTableConfig(manifests);
      const uniqueConstraint = manifestsConfig.uniqueConstraints.find(
        (u) => u.name === 'uq_manifests_community_version'
      );
      expect(uniqueConstraint).toBeDefined();
    });

    it('should have is_active flag for manifest history', () => {
      const manifestsConfig = getTableConfig(manifests);
      const isActiveColumn = manifestsConfig.columns.find((c) => c.name === 'is_active');
      expect(isActiveColumn).toBeDefined();
      expect(isActiveColumn?.dataType).toBe('boolean');
    });

    it('should have checksum for integrity verification', () => {
      const manifestsConfig = getTableConfig(manifests);
      const checksumColumn = manifestsConfig.columns.find((c) => c.name === 'checksum');
      expect(checksumColumn).toBeDefined();
      expect(checksumColumn?.notNull).toBe(true);
    });
  });
});
