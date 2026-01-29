/**
 * Test Mocks for Sietch Theme
 *
 * Centralized mock functions and factories for Discord, Database, and services.
 * Sprint 10 (Global ID 173): Comprehensive Tier Testing Suite
 */

import { vi } from 'vitest';
import type { Collection, GuildMember, Guild, Role, TextChannel } from 'discord.js';
import { MOCK_ROLE_IDS, MOCK_CHANNEL_IDS } from './fixtures.js';

// =============================================================================
// Discord Mock Factories
// =============================================================================

/**
 * Create a mock Collection (Discord.js Collection)
 */
export function createMockCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const map = new Map(entries);
  return {
    has: vi.fn((key: K) => map.has(key)),
    get: vi.fn((key: K) => map.get(key)),
    set: vi.fn((key: K, value: V) => {
      map.set(key, value);
      return map;
    }),
    delete: vi.fn((key: K) => map.delete(key)),
    size: map.size,
    forEach: vi.fn((fn) => map.forEach(fn)),
    map: vi.fn((fn) => Array.from(map.values()).map(fn)),
    filter: vi.fn((fn) => {
      const filtered = new Map();
      map.forEach((v, k) => {
        if (fn(v, k)) filtered.set(k, v);
      });
      return filtered;
    }),
    find: vi.fn((fn) => Array.from(map.values()).find(fn)),
    some: vi.fn((fn) => Array.from(map.values()).some(fn)),
    every: vi.fn((fn) => Array.from(map.values()).every(fn)),
    first: vi.fn(() => map.values().next().value),
    values: vi.fn(() => map.values()),
    keys: vi.fn(() => map.keys()),
    entries: vi.fn(() => map.entries()),
    [Symbol.iterator]: () => map[Symbol.iterator](),
  } as unknown as Collection<K, V>;
}

/**
 * Create a mock GuildMember with configurable roles
 */
export function createMockGuildMember(
  options: {
    id?: string;
    roles?: string[];
    displayName?: string;
    user?: { id: string; username: string };
  } = {}
): GuildMember {
  const roleEntries: [string, Partial<Role>][] = (options.roles ?? []).map((roleId) => [
    roleId,
    { id: roleId, name: `role-${roleId}` },
  ]);

  const mockRoles = {
    cache: createMockCollection(roleEntries),
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  return {
    id: options.id ?? 'member-123',
    displayName: options.displayName ?? 'TestMember',
    user: options.user ?? { id: options.id ?? 'member-123', username: 'testuser' },
    roles: mockRoles,
    send: vi.fn().mockResolvedValue(undefined),
    kick: vi.fn().mockResolvedValue(undefined),
    ban: vi.fn().mockResolvedValue(undefined),
  } as unknown as GuildMember;
}

/**
 * Create a mock Guild
 */
export function createMockGuild(options: { id?: string; name?: string } = {}): Guild {
  return {
    id: options.id ?? 'guild-123',
    name: options.name ?? 'Test Guild',
    members: {
      fetch: vi.fn().mockResolvedValue(createMockGuildMember()),
      cache: createMockCollection([]),
    },
    roles: {
      fetch: vi.fn().mockResolvedValue(createMockCollection([])),
      cache: createMockCollection([]),
    },
    channels: {
      fetch: vi.fn().mockResolvedValue(null),
      cache: createMockCollection([]),
    },
  } as unknown as Guild;
}

/**
 * Create a mock TextChannel
 */
export function createMockTextChannel(options: { id?: string; name?: string } = {}): TextChannel {
  return {
    id: options.id ?? 'channel-123',
    name: options.name ?? 'test-channel',
    send: vi.fn().mockResolvedValue({ id: 'message-123' }),
    isTextBased: () => true,
    type: 0, // GuildText
  } as unknown as TextChannel;
}

// =============================================================================
// Discord Service Mock Factory
// =============================================================================

/**
 * Create mock Discord service with configurable behavior
 */
export function createMockDiscordService(options: {
  assignRoleSuccess?: boolean;
  removeRoleSuccess?: boolean;
  memberRoles?: string[];
} = {}) {
  const mockMember = createMockGuildMember({ roles: options.memberRoles ?? [] });

  return {
    assignRole: vi.fn().mockResolvedValue(options.assignRoleSuccess ?? true),
    removeRole: vi.fn().mockResolvedValue(options.removeRoleSuccess ?? true),
    getMemberById: vi.fn().mockResolvedValue(mockMember),
    isConnected: vi.fn().mockReturnValue(true),
    getGuild: vi.fn().mockReturnValue(createMockGuild()),
    postToChannel: vi.fn().mockResolvedValue(undefined),
  };
}

// =============================================================================
// Database Mock Factories
// =============================================================================

/**
 * Create mock database queries for tier-related operations
 */
export function createMockTierQueries() {
  return {
    getMemberProfileById: vi.fn(),
    updateMemberTier: vi.fn(),
    insertTierHistory: vi.fn(),
    getTierHistory: vi.fn().mockReturnValue([]),
    getTierDistribution: vi.fn().mockResolvedValue([]),
    getRecentTierChanges: vi.fn().mockReturnValue([]),
    getTierChangesInDateRange: vi.fn().mockReturnValue([]),
    countTierPromotions: vi.fn().mockReturnValue(0),
    getMembersByTier: vi.fn().mockReturnValue([]),
    logAuditEvent: vi.fn().mockReturnValue(1),
  };
}

/**
 * Create mock database queries for eligibility operations
 */
export function createMockEligibilityQueries() {
  return {
    getCurrentEligibility: vi.fn().mockReturnValue([]),
    getActiveAdminOverrides: vi.fn().mockReturnValue([]),
    logAuditEvent: vi.fn().mockReturnValue(1),
  };
}

/**
 * Create mock database queries for threshold operations
 */
export function createMockThresholdQueries() {
  return {
    insertWaitlistRegistration: vi.fn(),
    getWaitlistRegistrationByDiscord: vi.fn().mockReturnValue(null),
    getWaitlistRegistrationByWallet: vi.fn().mockReturnValue(null),
    updateWaitlistNotified: vi.fn().mockReturnValue(true),
    deleteWaitlistRegistration: vi.fn().mockReturnValue(true),
    getActiveWaitlistRegistrations: vi.fn().mockReturnValue([]),
    getAllActiveWaitlistRegistrations: vi.fn().mockReturnValue([]),
    isWalletAssociatedWithMember: vi.fn().mockReturnValue(false),
    insertThresholdSnapshot: vi.fn(),
    getLatestThresholdSnapshot: vi.fn().mockReturnValue(null),
    getThresholdSnapshots: vi.fn().mockReturnValue([]),
    getWaitlistPositions: vi.fn().mockReturnValue([]),
    getEntryThresholdBgt: vi.fn().mockReturnValue(null),
    getWalletPosition: vi.fn().mockReturnValue(null),
    getCurrentEligibility: vi.fn().mockReturnValue([]),
    logAuditEvent: vi.fn().mockReturnValue(1),
  };
}

/**
 * Create mock database queries for role manager operations
 */
export function createMockRoleManagerQueries() {
  return {
    getMemberProfileById: vi.fn(),
    getDatabase: vi.fn(() => ({
      prepare: vi.fn(() => ({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        run: vi.fn(),
      })),
    })),
    logAuditEvent: vi.fn().mockReturnValue(1),
  };
}

// =============================================================================
// Config Mock Factories
// =============================================================================

/**
 * Create a complete mock config for testing
 */
export function createMockConfig() {
  return {
    discord: {
      guildId: 'test-guild-123',
      botToken: 'test-token',
      roles: {
        ...MOCK_ROLE_IDS,
      },
      channels: {
        ...MOCK_CHANNEL_IDS,
      },
    },
    socialLayer: {
      profile: {
        launchDate: '2025-01-01T00:00:00Z',
      },
    },
    verification: {
      baseUrl: 'http://localhost:3000',
      sessionExpiryMinutes: 15,
    },
  };
}

/**
 * Create a partial config with tier roles
 */
export function createMockTierConfig() {
  return {
    discord: {
      roles: {
        hajra: MOCK_ROLE_IDS.hajra,
        ichwan: MOCK_ROLE_IDS.ichwan,
        qanat: MOCK_ROLE_IDS.qanat,
        sihaya: MOCK_ROLE_IDS.sihaya,
        mushtamal: MOCK_ROLE_IDS.mushtamal,
        sayyadina: MOCK_ROLE_IDS.sayyadina,
        usul: MOCK_ROLE_IDS.usul,
        fedaykin: MOCK_ROLE_IDS.fedaykin,
        naib: MOCK_ROLE_IDS.naib,
      },
    },
  };
}

// =============================================================================
// Logger Mock
// =============================================================================

/**
 * Create a mock logger
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

// =============================================================================
// Mock Module Setup Helpers
// =============================================================================

/**
 * Standard mock setup for TierService tests
 */
export function setupTierServiceMocks(options: ReturnType<typeof createMockTierQueries> = createMockTierQueries()) {
  vi.mock('../../db/index.js', () => options);
  vi.mock('../../utils/logger.js', () => ({ logger: createMockLogger() }));
}

/**
 * Standard mock setup for RoleManager tests
 */
export function setupRoleManagerMocks(
  discordService = createMockDiscordService(),
  dbQueries = createMockRoleManagerQueries()
) {
  vi.mock('../../services/discord.js', () => ({ discordService }));
  vi.mock('../../db/index.js', () => dbQueries);
  vi.mock('../../utils/logger.js', () => ({ logger: createMockLogger() }));
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Assert that a role was assigned
 */
export function assertRoleAssigned(
  discordService: ReturnType<typeof createMockDiscordService>,
  discordUserId: string,
  roleId: string
) {
  expect(discordService.assignRole).toHaveBeenCalledWith(discordUserId, roleId);
}

/**
 * Assert that a role was removed
 */
export function assertRoleRemoved(
  discordService: ReturnType<typeof createMockDiscordService>,
  discordUserId: string,
  roleId: string
) {
  expect(discordService.removeRole).toHaveBeenCalledWith(discordUserId, roleId);
}

/**
 * Assert that an audit event was logged
 */
export function assertAuditLogged(
  logAuditEvent: ReturnType<typeof vi.fn>,
  eventType: string,
  dataSubset: Record<string, unknown>
) {
  expect(logAuditEvent).toHaveBeenCalledWith(
    eventType,
    expect.objectContaining(dataSubset)
  );
}
