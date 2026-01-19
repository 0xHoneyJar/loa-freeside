/**
 * MigrationPrompter Unit Tests
 *
 * Sprint 105: Migration System
 *
 * Tests the migration readiness and prompt system:
 * - Readiness checks (soft and full thresholds)
 * - Prompt generation and delivery
 * - Cooldown enforcement
 * - Migration execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MigrationPrompter,
  createMigrationPrompter,
  MIGRATION_THRESHOLDS,
  MIGRATION_MODES,
  PROMPT_ACTIONS,
  type IMigrationStorage,
  type IMigrationNotifier,
  type IMigrationEvents,
  type CommunityState,
  type MigrationPrompt,
  type PromptAction,
} from '../../../../../src/services/discord/migration/MigrationPrompter.js';

// Mock the logger module
vi.mock('../../../../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// =============================================================================
// Mock Implementations
// =============================================================================

function createMockStorage(states: Map<string, CommunityState> = new Map()): IMigrationStorage {
  const prompts = new Map<string, MigrationPrompt>();

  return {
    getCommunityState: vi.fn(async (communityId: string) => {
      return states.get(communityId) ?? null;
    }),
    updateCommunityMode: vi.fn(async (communityId: string, mode: string) => {
      const state = states.get(communityId);
      if (state) {
        state.mode = mode as CommunityState['mode'];
      }
    }),
    savePrompt: vi.fn(async (prompt: MigrationPrompt) => {
      prompts.set(prompt.id, prompt);
      const state = states.get(prompt.communityId);
      if (state) {
        state.lastPromptAt = prompt.sentAt;
        state.promptCount++;
      }
    }),
    getLastPrompt: vi.fn(async (communityId: string) => {
      const all = [...prompts.values()].filter(p => p.communityId === communityId);
      if (all.length === 0) return null;
      return all.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    }),
    acknowledgePrompt: vi.fn(async (promptId: string, action: PromptAction) => {
      const prompt = prompts.get(promptId);
      if (prompt) {
        prompt.acknowledgedAt = new Date();
        prompt.acknowledgedAction = action;
      }
    }),
    getShadowCommunities: vi.fn(async () => {
      return [...states.values()].filter(s => s.mode === MIGRATION_MODES.SHADOW);
    }),
  };
}

function createMockNotifier(): IMigrationNotifier {
  return {
    sendPrompt: vi.fn().mockResolvedValue(true),
  };
}

function createMockEvents(): IMigrationEvents {
  return {
    emit: vi.fn(),
  };
}

function createTestState(overrides: Partial<CommunityState> = {}): CommunityState {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    communityId: 'test-community',
    mode: MIGRATION_MODES.SHADOW,
    shadowStartedAt: thirtyDaysAgo,
    accuracy: 0.98,
    accuracyHistory: [
      { date: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), accuracy: 0.96 },
      { date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), accuracy: 0.97 },
      { date: now, accuracy: 0.98 },
    ],
    lastPromptAt: null,
    promptCount: 0,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('MigrationPrompter', () => {
  let storage: IMigrationStorage;
  let notifier: IMigrationNotifier;
  let events: IMigrationEvents;
  let prompter: MigrationPrompter;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createMockStorage();
    notifier = createMockNotifier();
    events = createMockEvents();
    prompter = createMigrationPrompter(storage, notifier, events);
  });

  describe('Factory Function', () => {
    it('should create MigrationPrompter with createMigrationPrompter', () => {
      const prompter = createMigrationPrompter(storage);
      expect(prompter).toBeInstanceOf(MigrationPrompter);
    });
  });

  describe('Readiness Checks', () => {
    it('should return not ready for non-shadow communities', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState({ mode: MIGRATION_MODES.GREENFIELD })],
      ]));
      prompter = createMigrationPrompter(storage);

      const result = await prompter.checkReadiness('test-community');

      expect(result.isReady).toBe(false);
      expect(result.blockers).toContain('Not in shadow mode');
    });

    it('should return not ready when accuracy below threshold', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState({ accuracy: 0.90 })],
      ]));
      prompter = createMigrationPrompter(storage);

      const result = await prompter.checkReadiness('test-community');

      expect(result.isReady).toBe(false);
      expect(result.isSoftReady).toBe(false);
      expect(result.blockers.some(b => b.includes('Accuracy'))).toBe(true);
    });

    it('should return not ready when days below threshold', async () => {
      const now = new Date();
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      storage = createMockStorage(new Map([
        ['test-community', createTestState({ shadowStartedAt: fiveDaysAgo })],
      ]));
      prompter = createMigrationPrompter(storage);

      const result = await prompter.checkReadiness('test-community');

      expect(result.isReady).toBe(false);
      expect(result.blockers.some(b => b.includes('days'))).toBe(true);
    });

    it('should return soft ready at 95% accuracy and 14 days', async () => {
      const now = new Date();
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);

      storage = createMockStorage(new Map([
        ['test-community', createTestState({
          accuracy: 0.95,
          shadowStartedAt: fifteenDaysAgo,
        })],
      ]));
      prompter = createMigrationPrompter(storage);

      const result = await prompter.checkReadiness('test-community');

      expect(result.isSoftReady).toBe(true);
      expect(result.isFullReady).toBe(false);
      expect(result.isReady).toBe(true);
    });

    it('should return full ready at 98% accuracy and 30 days', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState()], // Default has 98% accuracy and 30 days
      ]));
      prompter = createMigrationPrompter(storage);

      const result = await prompter.checkReadiness('test-community');

      expect(result.isFullReady).toBe(true);
      expect(result.isSoftReady).toBe(true);
      expect(result.isReady).toBe(true);
    });
  });

  describe('Prompt Generation', () => {
    it('should generate prompt with correct content', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState()],
      ]));
      prompter = createMigrationPrompter(storage);

      const content = await prompter.generatePromptContent('test-community');

      expect(content.title).toContain('Migration Ready');
      expect(content.fields.some(f => f.name === 'Shadow Accuracy')).toBe(true);
      expect(content.fields.some(f => f.name === 'Days in Shadow')).toBe(true);
      expect(content.buttons.length).toBeGreaterThan(0);
    });

    it('should include Enable button when ready', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState()],
      ]));
      prompter = createMigrationPrompter(storage);

      const content = await prompter.generatePromptContent('test-community');

      expect(content.buttons.some(b => b.id === PROMPT_ACTIONS.ENABLE_FULL)).toBe(true);
    });

    it('should not include Enable button when not ready', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState({ accuracy: 0.80 })],
      ]));
      prompter = createMigrationPrompter(storage);

      const content = await prompter.generatePromptContent('test-community');

      expect(content.buttons.some(b => b.id === PROMPT_ACTIONS.ENABLE_FULL)).toBe(false);
    });
  });

  describe('Prompt Sending', () => {
    it('should send prompt when ready and no cooldown', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState()],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const prompt = await prompter.sendPrompt('test-community');

      expect(prompt).not.toBeNull();
      expect(storage.savePrompt).toHaveBeenCalled();
      expect(notifier.sendPrompt).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith('prompt_sent', expect.any(Object));
    });

    it('should respect cooldown period', async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      storage = createMockStorage(new Map([
        ['test-community', createTestState({ lastPromptAt: threeDaysAgo })],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const prompt = await prompter.sendPrompt('test-community');

      expect(prompt).toBeNull();
      expect(notifier.sendPrompt).not.toHaveBeenCalled();
    });

    it('should not send after max prompt days', async () => {
      const now = new Date();
      const hundredDaysAgo = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);

      storage = createMockStorage(new Map([
        ['test-community', createTestState({ shadowStartedAt: hundredDaysAgo })],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const prompt = await prompter.sendPrompt('test-community');

      expect(prompt).toBeNull();
    });
  });

  describe('Migration Execution', () => {
    it('should execute migration when ready', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState()],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const result = await prompter.executeMigration('test-community');

      expect(result.success).toBe(true);
      expect(storage.updateCommunityMode).toHaveBeenCalledWith('test-community', MIGRATION_MODES.FULL);
      expect(events.emit).toHaveBeenCalledWith('migration_completed', expect.any(Object));
    });

    it('should block migration when not ready', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState({ accuracy: 0.80 })],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const result = await prompter.executeMigration('test-community');

      expect(result.success).toBe(false);
      expect(result.message).toContain('blocked');
    });

    it('should allow forced migration', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState({ accuracy: 0.80 })],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const result = await prompter.executeMigration('test-community', true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('forced');
    });
  });

  describe('Prompt Acknowledgment', () => {
    it('should acknowledge prompt with action', async () => {
      storage = createMockStorage(new Map([
        ['test-community', createTestState()],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      // First send a prompt
      const prompt = await prompter.sendPrompt('test-community');
      expect(prompt).not.toBeNull();

      // Then acknowledge it
      await prompter.acknowledgePrompt(prompt!.id, PROMPT_ACTIONS.ENABLE_FULL);

      expect(storage.acknowledgePrompt).toHaveBeenCalledWith(prompt!.id, PROMPT_ACTIONS.ENABLE_FULL);
    });
  });

  describe('Batch Processing', () => {
    it('should process all shadow communities', async () => {
      storage = createMockStorage(new Map([
        ['community-1', createTestState({ communityId: 'community-1' })],
        ['community-2', createTestState({ communityId: 'community-2', accuracy: 0.80 })],
        ['community-3', createTestState({ communityId: 'community-3', mode: MIGRATION_MODES.GREENFIELD })],
      ]));
      prompter = createMigrationPrompter(storage, notifier, events);

      const result = await prompter.processAllCommunities();

      expect(result.processed).toBe(2); // Only shadow communities
      expect(result.prompted).toBe(1); // Only community-1 is ready
    });
  });

  describe('Constants', () => {
    it('should have correct thresholds', () => {
      expect(MIGRATION_THRESHOLDS.SOFT_PROMPT_ACCURACY).toBe(0.95);
      expect(MIGRATION_THRESHOLDS.SOFT_PROMPT_DAYS).toBe(14);
      expect(MIGRATION_THRESHOLDS.FULL_UNLOCK_ACCURACY).toBe(0.98);
      expect(MIGRATION_THRESHOLDS.FULL_UNLOCK_DAYS).toBe(30);
      expect(MIGRATION_THRESHOLDS.PROMPT_COOLDOWN_DAYS).toBe(7);
      expect(MIGRATION_THRESHOLDS.MAX_PROMPT_DAYS).toBe(90);
    });

    it('should have correct modes', () => {
      expect(MIGRATION_MODES.SHADOW).toBe('shadow');
      expect(MIGRATION_MODES.GREENFIELD).toBe('greenfield');
      expect(MIGRATION_MODES.FULL).toBe('full');
    });

    it('should have correct actions', () => {
      expect(PROMPT_ACTIONS.ENABLE_FULL).toBe('enable_full');
      expect(PROMPT_ACTIONS.VIEW_DETAILS).toBe('view_details');
      expect(PROMPT_ACTIONS.DISMISS).toBe('dismiss');
      expect(PROMPT_ACTIONS.DEFER).toBe('defer');
    });
  });
});
