/**
 * WizardEngine Unit Tests
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Tests for the state machine engine with mocked session store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WizardEngine,
  WizardEngineError,
  createWizardEngine,
  StepHandler,
  StepHandlerResult,
  EngineEvent,
} from '../../../../src/packages/wizard/WizardEngine.js';
import { WizardSessionStore } from '../../../../src/packages/wizard/WizardSessionStore.js';
import {
  WizardSession,
  CreateSessionParams,
  createWizardSession,
} from '../../../../src/packages/wizard/WizardSession.js';
import { WizardState } from '../../../../src/packages/wizard/WizardState.js';

// Create mock session store
function createMockStore() {
  const sessions = new Map<string, WizardSession>();
  const userSessions = new Map<string, string>(); // guildId:userId -> sessionId

  return {
    create: vi.fn(async (params: CreateSessionParams) => {
      const session = createWizardSession(params);
      sessions.set(session.id, session);
      userSessions.set(`${params.guildId}:${params.userId}`, session.id);
      return session;
    }),
    get: vi.fn(async (sessionId: string) => {
      return sessions.get(sessionId) ?? null;
    }),
    getActiveSessionId: vi.fn(async (guildId: string, userId: string) => {
      return userSessions.get(`${guildId}:${userId}`) ?? null;
    }),
    getActiveSession: vi.fn(async (guildId: string, userId: string) => {
      const id = userSessions.get(`${guildId}:${userId}`);
      return id ? sessions.get(id) ?? null : null;
    }),
    update: vi.fn(async (sessionId: string, updates: { state?: WizardState; data?: unknown; error?: string }) => {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      if (updates.state) {
        session.history.push(session.state);
        session.state = updates.state;
        session.stepCount++;
      }
      if (updates.data) {
        session.data = { ...session.data, ...updates.data as Record<string, unknown> };
      }
      if (updates.error !== undefined) {
        session.error = updates.error;
      }
      session.updatedAt = new Date().toISOString();

      return session;
    }),
    transition: vi.fn(async (sessionId: string, newState: WizardState, data?: unknown) => {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      session.history.push(session.state);
      session.state = newState;
      session.stepCount++;
      if (data) {
        session.data = { ...session.data, ...data as Record<string, unknown> };
      }
      session.updatedAt = new Date().toISOString();

      return session;
    }),
    fail: vi.fn(async (sessionId: string, error: string) => {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');

      session.history.push(session.state);
      session.state = WizardState.FAILED;
      session.error = error;
      session.stepCount++;

      return session;
    }),
    delete: vi.fn(async (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (!session) return false;

      sessions.delete(sessionId);
      userSessions.delete(`${session.guildId}:${session.userId}`);
      return true;
    }),
    extendTTL: vi.fn(async () => true),
    _sessions: sessions,
  } as unknown as WizardSessionStore & { _sessions: Map<string, WizardSession> };
}

// Create mock handlers
function createMockHandlers(): Partial<Record<WizardState, StepHandler>> {
  const mockHandler = (nextState: WizardState): StepHandler =>
    vi.fn(async (): Promise<StepHandlerResult> => ({
      success: true,
      nextState,
      message: `Moved to ${nextState}`,
    }));

  return {
    [WizardState.INIT]: mockHandler(WizardState.CHAIN_SELECT),
    [WizardState.CHAIN_SELECT]: mockHandler(WizardState.ASSET_CONFIG),
    [WizardState.ASSET_CONFIG]: mockHandler(WizardState.ELIGIBILITY_RULES),
    [WizardState.ELIGIBILITY_RULES]: mockHandler(WizardState.ROLE_MAPPING),
    [WizardState.ROLE_MAPPING]: mockHandler(WizardState.CHANNEL_STRUCTURE),
    [WizardState.CHANNEL_STRUCTURE]: mockHandler(WizardState.REVIEW),
    [WizardState.REVIEW]: mockHandler(WizardState.DEPLOY),
    [WizardState.DEPLOY]: mockHandler(WizardState.COMPLETE),
  };
}

describe('WizardEngine', () => {
  let store: ReturnType<typeof createMockStore>;
  let handlers: Partial<Record<WizardState, StepHandler>>;
  let engine: WizardEngine;
  let events: EngineEvent[];

  const defaultParams: CreateSessionParams = {
    guildId: 'guild_123',
    userId: 'user_456',
    channelId: 'channel_789',
  };

  beforeEach(() => {
    store = createMockStore();
    handlers = createMockHandlers();
    events = [];

    engine = new WizardEngine({
      store,
      handlers,
      onEvent: (event) => events.push(event),
      debug: false,
    });
  });

  describe('start', () => {
    it('should create a new session', async () => {
      const session = await engine.start(defaultParams);

      expect(session.id).toMatch(/^wiz_/);
      expect(session.state).toBe(WizardState.INIT);
      expect(store.create).toHaveBeenCalledWith(defaultParams);
    });

    it('should emit session_created event', async () => {
      await engine.start(defaultParams);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('session_created');
    });
  });

  describe('resume', () => {
    it('should return existing session', async () => {
      const created = await engine.start(defaultParams);
      const resumed = await engine.resume(created.id);

      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const resumed = await engine.resume('wiz_nonexistent');
      expect(resumed).toBeNull();
    });

    it('should extend TTL on resume', async () => {
      const created = await engine.start(defaultParams);
      await engine.resume(created.id);

      expect(store.extendTTL).toHaveBeenCalledWith(created.id);
    });
  });

  describe('resumeActive', () => {
    it('should return active session for user', async () => {
      const created = await engine.start(defaultParams);
      const resumed = await engine.resumeActive(
        defaultParams.guildId,
        defaultParams.userId
      );

      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe(created.id);
    });

    it('should return null if no active session', async () => {
      const resumed = await engine.resumeActive('guild_new', 'user_new');
      expect(resumed).toBeNull();
    });
  });

  describe('process', () => {
    it('should execute handler for current state', async () => {
      const session = await engine.start(defaultParams);
      const result = await engine.process(session.id);

      expect(result.success).toBe(true);
      expect(handlers[WizardState.INIT]).toHaveBeenCalled();
    });

    it('should transition to next state', async () => {
      const session = await engine.start(defaultParams);
      await engine.process(session.id);

      const updated = await engine.getSession(session.id);
      expect(updated?.state).toBe(WizardState.CHAIN_SELECT);
    });

    it('should emit state_changed event', async () => {
      const session = await engine.start(defaultParams);
      events.length = 0; // Clear creation event

      await engine.process(session.id);

      const stateEvent = events.find((e) => e.type === 'state_changed');
      expect(stateEvent).toBeDefined();
      expect((stateEvent as { from: WizardState }).from).toBe(WizardState.INIT);
      expect((stateEvent as { to: WizardState }).to).toBe(WizardState.CHAIN_SELECT);
    });

    it('should emit step_completed event', async () => {
      const session = await engine.start(defaultParams);
      events.length = 0;

      await engine.process(session.id);

      const stepEvent = events.find((e) => e.type === 'step_completed');
      expect(stepEvent).toBeDefined();
      expect((stepEvent as { state: WizardState }).state).toBe(WizardState.INIT);
    });

    it('should emit session_completed on COMPLETE state', async () => {
      const session = await engine.start(defaultParams);

      // Process through all states
      await engine.process(session.id); // INIT -> CHAIN_SELECT
      await engine.process(session.id); // CHAIN_SELECT -> ASSET_CONFIG
      await engine.process(session.id); // ASSET_CONFIG -> ELIGIBILITY_RULES
      await engine.process(session.id); // ELIGIBILITY_RULES -> ROLE_MAPPING
      await engine.process(session.id); // ROLE_MAPPING -> CHANNEL_STRUCTURE
      await engine.process(session.id); // CHANNEL_STRUCTURE -> REVIEW
      await engine.process(session.id); // REVIEW -> DEPLOY
      await engine.process(session.id); // DEPLOY -> COMPLETE

      const completedEvent = events.find((e) => e.type === 'session_completed');
      expect(completedEvent).toBeDefined();
    });

    it('should throw for non-existent session', async () => {
      await expect(engine.process('wiz_nonexistent')).rejects.toThrow(
        WizardEngineError
      );
    });

    it('should throw for terminal state', async () => {
      const session = await engine.start(defaultParams);

      // Process to completion
      for (let i = 0; i < 8; i++) {
        await engine.process(session.id);
      }

      await expect(engine.process(session.id)).rejects.toThrow(WizardEngineError);
    });

    it('should throw if no handler for state', async () => {
      // Create engine without handlers
      const noHandlerEngine = new WizardEngine({
        store,
        handlers: {},
        debug: false,
      });

      const session = await noHandlerEngine.start(defaultParams);

      await expect(noHandlerEngine.process(session.id)).rejects.toThrow(
        WizardEngineError
      );
    });

    it('should pass input to handler', async () => {
      const session = await engine.start(defaultParams);
      const mockInput = { type: 'button' as const, customId: 'test_button' };

      await engine.process(session.id, mockInput);

      expect(handlers[WizardState.INIT]).toHaveBeenCalledWith(
        expect.objectContaining({ id: session.id }),
        mockInput
      );
    });
  });

  describe('back', () => {
    it('should transition to previous state', async () => {
      const session = await engine.start(defaultParams);
      await engine.process(session.id); // Move to CHAIN_SELECT

      await engine.back(session.id);

      const updated = await engine.getSession(session.id);
      expect(updated?.state).toBe(WizardState.INIT);
    });

    it('should return error result when at beginning', async () => {
      const session = await engine.start(defaultParams);
      const result = await engine.back(session.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot go back');
    });

    it('should throw for non-existent session', async () => {
      await expect(engine.back('wiz_nonexistent')).rejects.toThrow(WizardEngineError);
    });
  });

  describe('cancel', () => {
    it('should delete session', async () => {
      const session = await engine.start(defaultParams);
      const cancelled = await engine.cancel(session.id);

      expect(cancelled).toBe(true);
      expect(store.delete).toHaveBeenCalledWith(session.id);
    });

    it('should emit session_failed event', async () => {
      const session = await engine.start(defaultParams);
      events.length = 0;

      await engine.cancel(session.id);

      const failedEvent = events.find((e) => e.type === 'session_failed');
      expect(failedEvent).toBeDefined();
      expect((failedEvent as { error: string }).error).toBe('Cancelled by user');
    });

    it('should return false for non-existent session', async () => {
      const cancelled = await engine.cancel('wiz_nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  describe('fail', () => {
    it('should mark session as failed', async () => {
      const session = await engine.start(defaultParams);
      const failed = await engine.fail(session.id, 'Test error');

      expect(failed.state).toBe(WizardState.FAILED);
      expect(failed.error).toBe('Test error');
    });

    it('should emit session_failed event', async () => {
      const session = await engine.start(defaultParams);
      events.length = 0;

      await engine.fail(session.id, 'Test error');

      const failedEvent = events.find((e) => e.type === 'session_failed');
      expect(failedEvent).toBeDefined();
      expect((failedEvent as { error: string }).error).toBe('Test error');
    });
  });

  describe('getSession', () => {
    it('should return session by ID', async () => {
      const created = await engine.start(defaultParams);
      const retrieved = await engine.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });
  });

  describe('getProgress', () => {
    it('should return progress info', async () => {
      const session = await engine.start(defaultParams);
      const progress = engine.getProgress(session);

      expect(progress.state).toBe(WizardState.INIT);
      expect(progress.displayName).toBe('Getting Started');
      expect(progress.percentage).toBe(0);
      expect(progress.stepNumber).toBe(1);
      expect(progress.totalSteps).toBe(8);
      expect(progress.canGoBack).toBe(false); // INIT has no previous
      expect(progress.canCancel).toBe(true);
    });

    it('should show canGoBack true for middle states', async () => {
      const session = await engine.start(defaultParams);
      await engine.process(session.id);

      const updated = await engine.getSession(session.id);
      const progress = engine.getProgress(updated!);

      expect(progress.canGoBack).toBe(true);
    });

    it('should show canCancel false for terminal states', async () => {
      const session = await engine.start(defaultParams);

      // Process to completion
      for (let i = 0; i < 8; i++) {
        await engine.process(session.id);
      }

      const updated = await engine.getSession(session.id);
      const progress = engine.getProgress(updated!);

      expect(progress.canCancel).toBe(false);
    });
  });

  describe('generateProgressBar', () => {
    it('should generate progress bar string', async () => {
      const session = await engine.start(defaultParams);
      const progressBar = engine.generateProgressBar(session);

      expect(progressBar).toContain('░'); // Empty blocks
      expect(progressBar).toContain('0%');
      expect(progressBar).toContain('Getting Started');
    });

    it('should show full bar for completed session', async () => {
      const session = await engine.start(defaultParams);

      // Process to completion
      for (let i = 0; i < 8; i++) {
        await engine.process(session.id);
      }

      const updated = await engine.getSession(session.id);
      const progressBar = engine.generateProgressBar(updated!);

      expect(progressBar).toContain('██████████'); // Full blocks
      expect(progressBar).toContain('100%');
    });
  });

  describe('buildNavigationComponents', () => {
    it('should include back button for non-initial states', async () => {
      const session = await engine.start(defaultParams);
      await engine.process(session.id);

      const updated = await engine.getSession(session.id);
      const components = engine.buildNavigationComponents(updated!);

      const backButton = components.find((c) => c.customId?.includes('back'));
      expect(backButton).toBeDefined();
    });

    it('should include cancel button for non-terminal states', async () => {
      const session = await engine.start(defaultParams);
      const components = engine.buildNavigationComponents(session);

      const cancelButton = components.find((c) => c.customId?.includes('cancel'));
      expect(cancelButton).toBeDefined();
    });

    it('should return empty for terminal states', async () => {
      const session = await engine.start(defaultParams);

      // Process to completion
      for (let i = 0; i < 8; i++) {
        await engine.process(session.id);
      }

      const updated = await engine.getSession(session.id);
      const components = engine.buildNavigationComponents(updated!);

      expect(components).toHaveLength(0);
    });
  });

  describe('createWizardEngine', () => {
    it('should create engine instance', () => {
      const newEngine = createWizardEngine({
        store,
        handlers,
      });

      expect(newEngine).toBeInstanceOf(WizardEngine);
    });
  });
});
