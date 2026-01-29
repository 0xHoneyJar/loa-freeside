/**
 * Telegram Command Tests (v4.1 - Sprint 33)
 *
 * Test suite for Telegram bot commands covering:
 * - /start command handler
 * - /verify command handler
 * - /score command handler
 * - /status command handler
 * - /leaderboard command handler
 * - /help command handler
 * - /refresh command handler (Sprint 32)
 * - /unlink command handler (Sprint 32)
 * - /alerts command handler (Sprint 33)
 * - Inline queries (Sprint 33)
 * - Callback query handlers
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// =============================================================================
// Mock Setup - MUST be before imports
// =============================================================================

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/IdentityService.js', () => ({
  identityService: {
    getMemberByPlatformId: vi.fn(),
    getPendingSession: vi.fn(),
    createVerificationSession: vi.fn(),
    completeVerification: vi.fn(),
    failVerification: vi.fn(),
    getPlatformStatus: vi.fn(),
    unlinkTelegram: vi.fn(),
  },
}));

vi.mock('../../src/services/leaderboard.js', () => ({
  leaderboardService: {
    getLeaderboard: vi.fn().mockResolvedValue([]),
    getLeaderboardFromDb: vi.fn(),
    getMemberRank: vi.fn(),
    isInTopTen: vi.fn(),
    invalidateCache: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/notification.js', () => ({
  notificationService: {
    getPreferences: vi.fn().mockReturnValue({
      positionUpdates: true,
      atRiskWarnings: true,
      naibAlerts: false,
      frequency: '2_per_week',
      alertsSentThisWeek: 1,
    }),
    updatePreferences: vi.fn().mockReturnValue({
      positionUpdates: false,
      atRiskWarnings: true,
      naibAlerts: false,
      frequency: '2_per_week',
      alertsSentThisWeek: 1,
    }),
    getMaxAlertsPerWeek: vi.fn().mockReturnValue(2),
  },
}));

vi.mock('../../src/services/naib.js', () => ({
  naibService: {
    isCurrentNaib: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../src/db/index.js', () => ({
  getEligibilityByAddress: vi.fn(),
  getMemberProfileById: vi.fn(),
  getMemberBadgeCount: vi.fn(),
}));

vi.mock('../../src/utils/format.js', () => ({
  formatBigInt: vi.fn((value) => value.toString()),
  formatRelativeTime: vi.fn(() => '2 days ago'),
}));

// =============================================================================
// Imports - AFTER mocks
// =============================================================================

import { identityService } from '../../src/services/IdentityService.js';
import { leaderboardService } from '../../src/services/leaderboard.js';
import { getEligibilityByAddress, getMemberProfileById, getMemberBadgeCount } from '../../src/db/index.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock grammy context
 */
function createMockContext(options: {
  userId?: number;
  username?: string;
  chatType?: 'private' | 'group' | 'supergroup';
  session?: Record<string, unknown>;
} = {}) {
  const {
    userId = 123456789,
    username = 'testuser',
    chatType = 'private',
    session = {},
  } = options;

  const mockReply = vi.fn().mockResolvedValue({ message_id: 1 });
  const mockAnswerCallbackQuery = vi.fn().mockResolvedValue(true);

  return {
    from: {
      id: userId,
      username,
      first_name: 'Test',
      last_name: 'User',
      is_bot: false,
    },
    chat: {
      id: userId,
      type: chatType,
    },
    message: {
      message_id: 1,
      text: '/test',
      date: Math.floor(Date.now() / 1000),
    },
    session: {
      lastCommandAt: 0,
      pendingVerificationId: undefined,
      verificationAttempts: 0,
      ...session,
    },
    reply: mockReply,
    answerCallbackQuery: mockAnswerCallbackQuery,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Telegram Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('/start command', () => {
    it('should send welcome message with inline keyboard', async () => {
      // Import command handler
      const { registerStartCommand } = await import('../../src/telegram/commands/start.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      // Register commands
      registerStartCommand(mockBot as any);

      // Get the registered handler
      const [commandName, handler] = mockBot.command.mock.calls[0];
      expect(commandName).toBe('start');

      // Create mock context
      const ctx = createMockContext();

      // Execute handler
      await handler(ctx);

      // Verify reply was called with welcome message
      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Welcome to the Sietch');
      expect(message).toContain('BGT holders');
      expect(message).toContain('/verify');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
      expect(options).toHaveProperty('reply_markup');
      expect(options.reply_markup).toHaveProperty('inline_keyboard');
    });

    it('should update session lastCommandAt', async () => {
      const { registerStartCommand } = await import('../../src/telegram/commands/start.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerStartCommand(mockBot as any);
      const [, handler] = mockBot.command.mock.calls[0];

      const ctx = createMockContext();
      const beforeTime = Date.now();

      await handler(ctx);

      expect(ctx.session.lastCommandAt).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should still send welcome message even without user (logs null userId)', async () => {
      const { registerStartCommand } = await import('../../src/telegram/commands/start.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerStartCommand(mockBot as any);
      const [, handler] = mockBot.command.mock.calls[0];

      const ctx = createMockContext();
      ctx.from = undefined as any;

      await handler(ctx);

      // Start command still sends welcome message (userId will be undefined in logs)
      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Welcome to the Sietch');
    });

    it('should register callback query handlers', async () => {
      const { registerStartCommand } = await import('../../src/telegram/commands/start.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerStartCommand(mockBot as any);

      // Should register callback handlers for inline buttons
      expect(mockBot.callbackQuery).toHaveBeenCalledWith('verify', expect.any(Function));
      expect(mockBot.callbackQuery).toHaveBeenCalledWith('leaderboard', expect.any(Function));
    });
  });

  describe('/verify command', () => {
    it('should show already verified message if user has wallet linked', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      // Mock existing member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [
          { platform: 'telegram', platformUserId: '123456789', linkedAt: new Date() },
        ],
      });

      const ctx = createMockContext();
      await handleVerifyCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Wallet Already Linked');
      expect(message).toContain('0x1234...5678');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
      expect(options.reply_markup.inline_keyboard).toBeDefined();
    });

    it('should show pending session message if verification in progress', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      // No existing member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      // But has pending session
      vi.mocked(identityService.getPendingSession).mockResolvedValue({
        id: 'session-123',
        telegramUserId: '123456789',
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
      });

      const ctx = createMockContext();
      await handleVerifyCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Verification In Progress');
      expect(message).toContain('pending verification');
    });

    it('should create new verification session for new users', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      // No existing member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      // No pending session
      vi.mocked(identityService.getPendingSession).mockResolvedValue(null);

      // Create new session (Sprint 172: in-house verification)
      vi.mocked(identityService.createVerificationSession).mockResolvedValue({
        sessionId: 'new-session-123',
        verifyUrl: 'http://localhost:3000/verify/new-session-123?platform=telegram',
      });

      const ctx = createMockContext({ username: 'testuser' });
      await handleVerifyCommand(ctx as any);

      expect(identityService.createVerificationSession).toHaveBeenCalledWith(
        '123456789',
        'testuser'
      );

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Wallet Verification');
      expect(message).toContain('sign');  // Updated: in-house uses signing, not Collab.Land
      expect(options.reply_markup.inline_keyboard[0][0]).toHaveProperty('url');
    });

    it('should handle rate limiting error', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);
      vi.mocked(identityService.getPendingSession).mockResolvedValue(null);
      vi.mocked(identityService.createVerificationSession).mockRejectedValue(
        new Error('Too many verification attempts. Please wait and try again later.')
      );

      const ctx = createMockContext();
      await handleVerifyCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Rate Limited');
    });

    it('should handle generic errors', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);
      vi.mocked(identityService.getPendingSession).mockResolvedValue(null);
      vi.mocked(identityService.createVerificationSession).mockRejectedValue(
        new Error('Database error')
      );

      const ctx = createMockContext();
      await handleVerifyCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Verification Error');
    });

    it('should handle missing user gracefully', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      const ctx = createMockContext();
      ctx.from = undefined as any;

      await handleVerifyCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Could not identify');
    });

    it('should update session with verification info', async () => {
      const { handleVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);
      vi.mocked(identityService.getPendingSession).mockResolvedValue(null);
      vi.mocked(identityService.createVerificationSession).mockResolvedValue({
        sessionId: 'new-session-123',
        verifyUrl: 'http://localhost:3000/verify/new-session-123?platform=telegram',
      });

      const ctx = createMockContext({ session: { verificationAttempts: 2 } });
      await handleVerifyCommand(ctx as any);

      expect(ctx.session.pendingVerificationId).toBe('new-session-123');
      expect(ctx.session.verificationAttempts).toBe(3);
    });

    it('should register verify_help callback handler', async () => {
      const { registerVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerVerifyCommand(mockBot as any);

      expect(mockBot.callbackQuery).toHaveBeenCalledWith('verify_help', expect.any(Function));
    });

    it('should register verify_new callback handler', async () => {
      const { registerVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerVerifyCommand(mockBot as any);

      expect(mockBot.callbackQuery).toHaveBeenCalledWith('verify_new', expect.any(Function));
    });
  });

  describe('Callback Query Handlers', () => {
    it('should handle verify_help callback', async () => {
      const { registerVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerVerifyCommand(mockBot as any);

      // Find the verify_help handler
      const helpHandler = mockBot.callbackQuery.mock.calls.find(
        ([query]) => query === 'verify_help'
      )?.[1];

      expect(helpHandler).toBeDefined();

      const ctx = createMockContext();
      await helpHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Verification Help');
      expect(message).toContain('wallet ownership');  // Updated: in-house verification messaging
    });

    it('should handle verify_new callback', async () => {
      const { registerVerifyCommand } = await import('../../src/telegram/commands/verify.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);
      vi.mocked(identityService.getPendingSession).mockResolvedValue(null);
      vi.mocked(identityService.createVerificationSession).mockResolvedValue({
        sessionId: 'new-session',
        verifyUrl: 'https://verify.url',
      });

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerVerifyCommand(mockBot as any);

      // Find the verify_new handler
      const newHandler = mockBot.callbackQuery.mock.calls.find(
        ([query]) => query === 'verify_new'
      )?.[1];

      expect(newHandler).toBeDefined();

      const ctx = createMockContext();
      await newHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      // Should trigger handleVerifyCommand
      expect(identityService.createVerificationSession).toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Sprint 31 Command Tests
  // =============================================================================

  describe('/score command', () => {
    it('should show not linked message for unverified users', async () => {
      const { handleScoreCommand } = await import('../../src/telegram/commands/score.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const ctx = createMockContext();
      await handleScoreCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Wallet Not Linked');
      expect(message).toContain('/verify');
    });

    it('should show score details for verified users', async () => {
      const { handleScoreCommand } = await import('../../src/telegram/commands/score.js');

      // Mock verified member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        id: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      // Mock eligibility data
      vi.mocked(getEligibilityByAddress).mockReturnValue({
        address: '0x1234...',
        bgtHeld: 100n * 10n ** 18n,
        bgtClaimed: 100n * 10n ** 18n,
        bgtBurned: 0n,
        rank: 5,
        role: 'naib',
      });

      // Mock profile
      vi.mocked(getMemberProfileById).mockReturnValue({
        member_id: 'member-123',
        nym: 'testuser',
        tier: 'naib',
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      } as any);

      // Mock badge count
      vi.mocked(getMemberBadgeCount).mockReturnValue(5);

      // Mock rank
      vi.mocked(leaderboardService.getMemberRank).mockReturnValue(5);

      const ctx = createMockContext();
      await handleScoreCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Conviction Score');
      expect(message).toContain('Tier');
      expect(message).toContain('Rank');
      expect(message).toContain('Badges');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
    });

    it('should handle missing user gracefully', async () => {
      const { handleScoreCommand } = await import('../../src/telegram/commands/score.js');

      const ctx = createMockContext();
      ctx.from = undefined as any;

      await handleScoreCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Could not identify');
    });

    it('should handle errors gracefully', async () => {
      const { handleScoreCommand } = await import('../../src/telegram/commands/score.js');

      vi.mocked(identityService.getMemberByPlatformId).mockRejectedValue(
        new Error('Database error')
      );

      const ctx = createMockContext();
      await handleScoreCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Error');
    });
  });

  describe('/status command', () => {
    it('should show not linked message for unverified users', async () => {
      const { handleStatusCommand } = await import('../../src/telegram/commands/status.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const ctx = createMockContext();
      await handleStatusCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Wallet Not Linked');
      expect(message).toContain('/verify');
    });

    it('should show platform status for verified users', async () => {
      const { handleStatusCommand } = await import('../../src/telegram/commands/status.js');

      // Mock verified member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        id: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      // Mock platform status
      vi.mocked(identityService.getPlatformStatus).mockResolvedValue({
        discord: {
          platformUserId: '123456',
          linkedAt: new Date(),
        },
        telegram: {
          platformUserId: '789012',
          linkedAt: new Date(),
        },
      });

      const ctx = createMockContext();
      await handleStatusCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Platform Status');
      expect(message).toContain('Discord');
      expect(message).toContain('Telegram');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
    });

    it('should show tip when not all platforms connected', async () => {
      const { handleStatusCommand } = await import('../../src/telegram/commands/status.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        id: 'member-123',
        walletAddress: '0x1234...',
        platforms: [],
      });

      vi.mocked(identityService.getPlatformStatus).mockResolvedValue({
        discord: null,
        telegram: {
          platformUserId: '789012',
          linkedAt: new Date(),
        },
      });

      const ctx = createMockContext();
      await handleStatusCommand(ctx as any);

      const [message] = ctx.reply.mock.calls[0];
      expect(message).toContain('Tip');
      expect(message).toContain('1/2 platforms');
    });
  });

  describe('/leaderboard command', () => {
    it('should show empty message when no members', async () => {
      const { handleLeaderboardCommand } = await import('../../src/telegram/commands/leaderboard.js');

      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([]);

      const ctx = createMockContext();
      await handleLeaderboardCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Leaderboard');
      expect(message).toContain('No members');
    });

    it('should show leaderboard entries', async () => {
      const { handleLeaderboardCommand } = await import('../../src/telegram/commands/leaderboard.js');

      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([
        { rank: 1, nym: 'alpha', tier: 'naib', badgeCount: 10, tenureCategory: 'veteran' },
        { rank: 2, nym: 'beta', tier: 'naib', badgeCount: 8, tenureCategory: 'established' },
        { rank: 3, nym: 'gamma', tier: 'fedaykin', badgeCount: 5, tenureCategory: 'newcomer' },
      ]);

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const ctx = createMockContext();
      await handleLeaderboardCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Leaderboard');
      expect(message).toContain('alpha');
      expect(message).toContain('beta');
      expect(message).toContain('gamma');
      expect(message).toContain('badge');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
    });

    it('should show user position if in top 10', async () => {
      const { handleLeaderboardCommand } = await import('../../src/telegram/commands/leaderboard.js');

      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([
        { rank: 1, nym: 'alpha', tier: 'naib', badgeCount: 10, tenureCategory: 'veteran' },
      ]);

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        id: 'member-123',
        walletAddress: '0x1234...',
        platforms: [],
      });

      vi.mocked(leaderboardService.getMemberRank).mockReturnValue(5);

      const ctx = createMockContext();
      await handleLeaderboardCommand(ctx as any);

      const [message] = ctx.reply.mock.calls[0];
      expect(message).toContain("You're in the top 10");
    });

    it('should show user position if outside top 10', async () => {
      const { handleLeaderboardCommand } = await import('../../src/telegram/commands/leaderboard.js');

      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([
        { rank: 1, nym: 'alpha', tier: 'naib', badgeCount: 10, tenureCategory: 'veteran' },
      ]);

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        id: 'member-123',
        walletAddress: '0x1234...',
        platforms: [],
      });

      vi.mocked(leaderboardService.getMemberRank).mockReturnValue(25);

      const ctx = createMockContext();
      await handleLeaderboardCommand(ctx as any);

      const [message] = ctx.reply.mock.calls[0];
      expect(message).toContain('Your Position');
      expect(message).toContain('#25');
    });
  });

  describe('/help command', () => {
    it('should show help message with all commands', async () => {
      const { handleHelpCommand } = await import('../../src/telegram/commands/help.js');

      const ctx = createMockContext();
      await handleHelpCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Help');
      expect(message).toContain('/verify');
      expect(message).toContain('/score');
      expect(message).toContain('/leaderboard');
      expect(message).toContain('/status');
      expect(message).toContain('/help');
      expect(message).toContain('/start');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
      expect(options.reply_markup.inline_keyboard).toBeDefined();
    });

    it('should register help callback handler', async () => {
      const { registerHelpCommand } = await import('../../src/telegram/commands/help.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerHelpCommand(mockBot as any);

      expect(mockBot.callbackQuery).toHaveBeenCalledWith('help', expect.any(Function));
    });
  });

  // =============================================================================
  // Sprint 32 Command Tests
  // =============================================================================

  describe('/refresh command', () => {
    it('should show not linked message for unverified users', async () => {
      const { handleRefreshCommand } = await import('../../src/telegram/commands/refresh.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const ctx = createMockContext();
      await handleRefreshCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Wallet Not Linked');
      expect(message).toContain('/verify');
    });

    it('should show cooldown message when refreshing too soon', async () => {
      const { handleRefreshCommand } = await import('../../src/telegram/commands/refresh.js');

      // Set last refresh to recent time (1 minute ago)
      const ctx = createMockContext({
        session: {
          lastRefreshAt: Date.now() - 60 * 1000, // 1 minute ago
        },
      });

      await handleRefreshCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Please Wait');
      expect(message).toContain('minute');
    });

    it('should refresh score for verified users', async () => {
      const { handleRefreshCommand } = await import('../../src/telegram/commands/refresh.js');

      // Mock verified member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      // Mock eligibility data
      vi.mocked(getEligibilityByAddress).mockReturnValue({
        address: '0x1234...',
        bgtHeld: 100n * 10n ** 18n,
        rank: 5,
      });

      // Mock profile
      vi.mocked(getMemberProfileById).mockReturnValue({
        member_id: 'member-123',
        tier: 'naib',
      } as any);

      // Mock badge count
      vi.mocked(getMemberBadgeCount).mockReturnValue(3);

      // Mock rank
      vi.mocked(leaderboardService.getMemberRank).mockReturnValue(5);

      const ctx = createMockContext({
        session: {
          lastRefreshAt: 0, // No recent refresh
        },
      });

      // Mock editMessageText
      ctx.api = {
        editMessageText: vi.fn().mockResolvedValue({}),
      } as any;

      await handleRefreshCommand(ctx as any);

      // Should have called reply for the "Refreshing..." message
      expect(ctx.reply).toHaveBeenCalled();

      // Session should be updated
      expect(ctx.session.lastRefreshAt).toBeGreaterThan(0);
    });

    it('should handle missing user gracefully', async () => {
      const { handleRefreshCommand } = await import('../../src/telegram/commands/refresh.js');

      const ctx = createMockContext();
      ctx.from = undefined as any;

      await handleRefreshCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Could not identify');
    });

    it('should handle errors gracefully', async () => {
      const { handleRefreshCommand } = await import('../../src/telegram/commands/refresh.js');

      vi.mocked(identityService.getMemberByPlatformId).mockRejectedValue(
        new Error('Database error')
      );

      const ctx = createMockContext({
        session: {
          lastRefreshAt: 0,
        },
      });

      await handleRefreshCommand(ctx as any);

      // Should show error message
      const calls = ctx.reply.mock.calls;
      const lastMessage = calls[calls.length - 1][0];
      expect(lastMessage).toContain('Error');
    });

    it('should register refresh callback handler', async () => {
      const { registerRefreshCommand } = await import('../../src/telegram/commands/refresh.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerRefreshCommand(mockBot as any);

      expect(mockBot.command).toHaveBeenCalledWith('refresh', expect.any(Function));
      expect(mockBot.callbackQuery).toHaveBeenCalledWith('refresh', expect.any(Function));
    });
  });

  describe('/unlink command', () => {
    it('should show not linked message for unverified users', async () => {
      const { handleUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const ctx = createMockContext();
      await handleUnlinkCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('No Wallet Linked');
      expect(message).toContain('/verify');
    });

    it('should show confirmation prompt for verified users', async () => {
      const { handleUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      const ctx = createMockContext();
      await handleUnlinkCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Unlink Wallet');
      expect(message).toContain('0x1234...5678');
      expect(message).toContain('Are you sure');
      expect(options.reply_markup.inline_keyboard).toBeDefined();
      // Should have Cancel and Confirm buttons
      const buttons = options.reply_markup.inline_keyboard.flat();
      expect(buttons.some((b: any) => b.callback_data === 'unlink_cancel')).toBe(true);
      expect(buttons.some((b: any) => b.callback_data === 'unlink_confirm')).toBe(true);
    });

    it('should handle missing user gracefully', async () => {
      const { handleUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      const ctx = createMockContext();
      ctx.from = undefined as any;

      await handleUnlinkCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Could not identify');
    });

    it('should handle errors gracefully', async () => {
      const { handleUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      vi.mocked(identityService.getMemberByPlatformId).mockRejectedValue(
        new Error('Database error')
      );

      const ctx = createMockContext();
      await handleUnlinkCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Error');
    });

    it('should register unlink command and callbacks', async () => {
      const { registerUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerUnlinkCommand(mockBot as any);

      expect(mockBot.command).toHaveBeenCalledWith('unlink', expect.any(Function));
      expect(mockBot.callbackQuery).toHaveBeenCalledWith('unlink_confirm', expect.any(Function));
      expect(mockBot.callbackQuery).toHaveBeenCalledWith('unlink_cancel', expect.any(Function));
    });

    it('should unlink wallet on confirm', async () => {
      const { registerUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      vi.mocked(identityService.unlinkTelegram).mockResolvedValue(undefined);

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerUnlinkCommand(mockBot as any);

      // Find the unlink_confirm handler
      const confirmHandler = mockBot.callbackQuery.mock.calls.find(
        ([query]) => query === 'unlink_confirm'
      )?.[1];

      expect(confirmHandler).toBeDefined();

      const ctx = createMockContext();
      await confirmHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(identityService.unlinkTelegram).toHaveBeenCalledWith('member-123');
      expect(ctx.reply).toHaveBeenCalled();
      const [message] = ctx.reply.mock.calls[0];
      expect(message).toContain('Wallet Unlinked');
    });

    it('should cancel unlink on cancel button', async () => {
      const { registerUnlinkCommand } = await import('../../src/telegram/commands/unlink.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerUnlinkCommand(mockBot as any);

      // Find the unlink_cancel handler
      const cancelHandler = mockBot.callbackQuery.mock.calls.find(
        ([query]) => query === 'unlink_cancel'
      )?.[1];

      expect(cancelHandler).toBeDefined();

      const ctx = createMockContext();
      await cancelHandler(ctx);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(ctx.reply).toHaveBeenCalled();
      const [message] = ctx.reply.mock.calls[0];
      expect(message).toContain('Unlink Cancelled');
    });
  });

  // =============================================================================
  // Sprint 33 Command Tests
  // =============================================================================

  describe('/alerts command', () => {
    it('should show not linked message for unverified users', async () => {
      const { handleAlertsCommand } = await import('../../src/telegram/commands/alerts.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const ctx = createMockContext();
      await handleAlertsCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Wallet Not Linked');
      expect(message).toContain('/verify');
    });

    it('should show alert preferences for verified users', async () => {
      const { handleAlertsCommand } = await import('../../src/telegram/commands/alerts.js');
      const { notificationService } = await import('../../src/services/notification.js');
      const { naibService } = await import('../../src/services/naib.js');

      // Mock verified member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      // Mock preferences
      vi.mocked(notificationService.getPreferences).mockReturnValue({
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: false,
        frequency: '2_per_week',
        alertsSentThisWeek: 1,
      });

      vi.mocked(notificationService.getMaxAlertsPerWeek).mockReturnValue(2);
      vi.mocked(naibService.isCurrentNaib).mockReturnValue(false);

      const ctx = createMockContext();
      await handleAlertsCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Alert Preferences');
      expect(message).toContain('Position Updates');
      expect(message).toContain('At-Risk Warnings');
      expect(message).toContain('Frequency');
      expect(message).toContain('2x per week');
      expect(options).toHaveProperty('parse_mode', 'Markdown');
      expect(options.reply_markup.inline_keyboard).toBeDefined();
    });

    it('should show naib alerts option for naib members', async () => {
      const { handleAlertsCommand } = await import('../../src/telegram/commands/alerts.js');
      const { notificationService } = await import('../../src/services/notification.js');
      const { naibService } = await import('../../src/services/naib.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234...',
        platforms: [],
      });

      vi.mocked(notificationService.getPreferences).mockReturnValue({
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: 'daily',
        alertsSentThisWeek: 3,
      });

      vi.mocked(naibService.isCurrentNaib).mockReturnValue(true);

      const ctx = createMockContext();
      await handleAlertsCommand(ctx as any);

      const [message, options] = ctx.reply.mock.calls[0];

      expect(message).toContain('Naib Alerts');
      // Should have naib toggle button
      const buttons = options.reply_markup.inline_keyboard.flat();
      expect(buttons.some((b: any) => b.callback_data?.includes('toggle_naib'))).toBe(true);
    });

    it('should handle missing user gracefully', async () => {
      const { handleAlertsCommand } = await import('../../src/telegram/commands/alerts.js');

      const ctx = createMockContext();
      ctx.from = undefined as any;

      await handleAlertsCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Could not identify');
    });

    it('should handle errors gracefully', async () => {
      const { handleAlertsCommand } = await import('../../src/telegram/commands/alerts.js');

      vi.mocked(identityService.getMemberByPlatformId).mockRejectedValue(
        new Error('Database error')
      );

      const ctx = createMockContext();
      await handleAlertsCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Error');
    });

    it('should register alerts command and callbacks', async () => {
      const { registerAlertsCommand } = await import('../../src/telegram/commands/alerts.js');

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerAlertsCommand(mockBot as any);

      expect(mockBot.command).toHaveBeenCalledWith('alerts', expect.any(Function));
      expect(mockBot.callbackQuery).toHaveBeenCalledWith('alerts', expect.any(Function));
      // Toggle handlers (regex patterns)
      expect(mockBot.callbackQuery).toHaveBeenCalledWith(
        expect.any(RegExp),
        expect.any(Function)
      );
    });

    it('should have frequency buttons in keyboard', async () => {
      const { handleAlertsCommand } = await import('../../src/telegram/commands/alerts.js');
      const { notificationService } = await import('../../src/services/notification.js');
      const { naibService } = await import('../../src/services/naib.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234...',
        platforms: [],
      });

      vi.mocked(notificationService.getPreferences).mockReturnValue({
        positionUpdates: true,
        atRiskWarnings: false,
        naibAlerts: false,
        frequency: '1_per_week',
        alertsSentThisWeek: 0,
      });

      vi.mocked(naibService.isCurrentNaib).mockReturnValue(false);

      const ctx = createMockContext();
      await handleAlertsCommand(ctx as any);

      const [, options] = ctx.reply.mock.calls[0];
      const buttons = options.reply_markup.inline_keyboard.flat();

      // Should have frequency buttons
      expect(buttons.some((b: any) => b.callback_data?.includes('freq_1_per_week'))).toBe(true);
      expect(buttons.some((b: any) => b.callback_data?.includes('freq_daily'))).toBe(true);
      // Should have disable all button
      expect(buttons.some((b: any) => b.callback_data?.includes('disable_all'))).toBe(true);
    });

    it('should block unauthorized callback attempts (IDOR protection)', async () => {
      const { registerAlertsCommand } = await import('../../src/telegram/commands/alerts.js');
      const { notificationService } = await import('../../src/services/notification.js');

      // User A is member-123, User B (attacker) is trying to modify A's preferences
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-456', // User B's member ID
        walletAddress: '0xattacker...',
        platforms: [],
      });

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerAlertsCommand(mockBot as any);

      // Find the toggle position handler (regex pattern)
      const togglePositionCall = mockBot.callbackQuery.mock.calls.find(
        ([query]) => query instanceof RegExp && query.source.includes('toggle_position')
      );

      expect(togglePositionCall).toBeDefined();
      const [, handler] = togglePositionCall;

      // Create context for User B trying to modify User A's (member-123) preferences
      const ctx = createMockContext({ userId: 789012 }); // User B's Telegram ID
      ctx.match = ['alerts_toggle_position_member-123', 'member-123']; // Trying to target User A

      await handler(ctx);

      // Should show unauthorized and NOT call updatePreferences
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Unauthorized');
      expect(notificationService.updatePreferences).not.toHaveBeenCalled();
    });

    it('should allow authorized callback attempts', async () => {
      const { registerAlertsCommand } = await import('../../src/telegram/commands/alerts.js');
      const { notificationService } = await import('../../src/services/notification.js');

      // User A is member-123, clicking their own button
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234...',
        platforms: [],
      });

      vi.mocked(notificationService.getPreferences).mockReturnValue({
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: false,
        frequency: '2_per_week',
        alertsSentThisWeek: 1,
      });

      const mockBot = {
        command: vi.fn(),
        callbackQuery: vi.fn(),
      };

      registerAlertsCommand(mockBot as any);

      // Find the toggle position handler
      const togglePositionCall = mockBot.callbackQuery.mock.calls.find(
        ([query]) => query instanceof RegExp && query.source.includes('toggle_position')
      );

      const [, handler] = togglePositionCall;

      // Create context for User A clicking their own button
      const ctx = createMockContext({ userId: 123456789 });
      ctx.match = ['alerts_toggle_position_member-123', 'member-123'];
      ctx.editMessageText = vi.fn().mockResolvedValue({});

      await handler(ctx);

      // Should update preferences (authorized)
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith('Updating...');
      expect(notificationService.updatePreferences).toHaveBeenCalledWith(
        'member-123',
        { positionUpdates: false }
      );
    });
  });

  describe('Inline Queries', () => {
    /**
     * Create a mock inline query context
     */
    function createMockInlineContext(options: {
      userId?: number;
      query?: string;
    } = {}) {
      const {
        userId = 123456789,
        query = '',
      } = options;

      return {
        from: {
          id: userId,
          username: 'testuser',
        },
        inlineQuery: {
          query,
        },
        answerInlineQuery: vi.fn().mockResolvedValue(true),
      };
    }

    it('should register inline query handler', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      expect(mockBot.on).toHaveBeenCalledWith('inline_query', expect.any(Function));
    });

    it('should return not verified result for unverified users', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      // Get the inline query handler
      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: 'score' });
      await handler(ctx);

      expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
      const [results] = ctx.answerInlineQuery.mock.calls[0];

      // Should have not verified result
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return score result for verified users on empty query', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      // Mock verified member
      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue({
        memberId: 'member-123',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        platforms: [],
      });

      // Mock eligibility
      vi.mocked(getEligibilityByAddress).mockReturnValue({
        address: '0x1234...',
        bgtHeld: 100n * 10n ** 18n,
        rank: 5,
      });

      // Mock profile
      vi.mocked(getMemberProfileById).mockReturnValue({
        member_id: 'member-123',
        tier: 'naib',
      } as any);

      vi.mocked(getMemberBadgeCount).mockReturnValue(3);
      vi.mocked(leaderboardService.getMemberRank).mockReturnValue(5);
      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([]);

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: '' });
      await handler(ctx);

      expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
      const [results, options] = ctx.answerInlineQuery.mock.calls[0];

      // Should have multiple results for empty query
      expect(results.length).toBeGreaterThan(1);
      expect(options.is_personal).toBe(true);
    });

    it('should return leaderboard result on "leaderboard" query', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([
        { rank: 1, nym: 'alpha', tier: 'naib', badgeCount: 10, tenureCategory: 'veteran' },
        { rank: 2, nym: 'beta', tier: 'fedaykin', badgeCount: 5, tenureCategory: 'established' },
      ]);

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: 'leaderboard' });
      await handler(ctx);

      expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
      const [results] = ctx.answerInlineQuery.mock.calls[0];

      expect(results.length).toBeGreaterThan(0);
    });

    it('should return help result on "help" query', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: 'help' });
      await handler(ctx);

      expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
      const [results] = ctx.answerInlineQuery.mock.calls[0];

      expect(results.length).toBeGreaterThan(0);
    });

    it('should return help for unknown queries', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: 'unknownquery123' });
      await handler(ctx);

      expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
      const [results] = ctx.answerInlineQuery.mock.calls[0];

      // Should still return results (help)
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      vi.mocked(identityService.getMemberByPlatformId).mockRejectedValue(
        new Error('Database error')
      );

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: 'score' });
      await handler(ctx);

      // Should still answer with help result
      expect(ctx.answerInlineQuery).toHaveBeenCalledOnce();
      const [results, options] = ctx.answerInlineQuery.mock.calls[0];

      expect(results.length).toBeGreaterThan(0);
      expect(options.cache_time).toBe(0); // Error responses shouldn't be cached
    });

    it('should cache results with short TTL', async () => {
      const { registerInlineQueries } = await import('../../src/telegram/inline.js');

      vi.mocked(identityService.getMemberByPlatformId).mockResolvedValue(null);
      vi.mocked(leaderboardService.getLeaderboard).mockResolvedValue([]);

      const mockBot = {
        on: vi.fn(),
      };

      registerInlineQueries(mockBot as any);

      const [, handler] = mockBot.on.mock.calls.find(
        ([event]) => event === 'inline_query'
      );

      const ctx = createMockInlineContext({ query: 'help' }); // Use 'help' to avoid leaderboard calls
      await handler(ctx);

      const [, options] = ctx.answerInlineQuery.mock.calls[0];

      expect(options.cache_time).toBe(30);
      expect(options.is_personal).toBe(true);
    });
  });
});
