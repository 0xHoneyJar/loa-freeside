/**
 * Telegram Command Tests (v4.1 - Sprint 31)
 *
 * Test suite for Telegram bot commands covering:
 * - /start command handler
 * - /verify command handler
 * - /score command handler
 * - /status command handler
 * - /leaderboard command handler
 * - /help command handler
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
  },
}));

vi.mock('../../src/services/leaderboard.js', () => ({
  leaderboardService: {
    getLeaderboard: vi.fn(),
    getMemberRank: vi.fn(),
    isInTopTen: vi.fn(),
  },
}));

vi.mock('../../src/db/queries.js', () => ({
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
import { getEligibilityByAddress, getMemberProfileById, getMemberBadgeCount } from '../../src/db/queries.js';

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

      // Create new session
      vi.mocked(identityService.createVerificationSession).mockResolvedValue({
        sessionId: 'new-session-123',
        verifyUrl: 'https://connect.collab.land/verify?session=new-session-123&platform=telegram',
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
      expect(message).toContain('Collab.Land');
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
        verifyUrl: 'https://connect.collab.land/verify?session=new-session-123',
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
      expect(message).toContain('Collab.Land');
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

      vi.mocked(leaderboardService.getLeaderboard).mockReturnValue([]);

      const ctx = createMockContext();
      await handleLeaderboardCommand(ctx as any);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const [message] = ctx.reply.mock.calls[0];

      expect(message).toContain('Leaderboard');
      expect(message).toContain('No members');
    });

    it('should show leaderboard entries', async () => {
      const { handleLeaderboardCommand } = await import('../../src/telegram/commands/leaderboard.js');

      vi.mocked(leaderboardService.getLeaderboard).mockReturnValue([
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

      vi.mocked(leaderboardService.getLeaderboard).mockReturnValue([
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

      vi.mocked(leaderboardService.getLeaderboard).mockReturnValue([
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
});
