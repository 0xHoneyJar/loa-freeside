/**
 * WizardEngine - State Machine for Community Onboarding
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Core state machine that orchestrates the wizard flow.
 * Manages state transitions, step handlers, and Discord interactions.
 *
 * Key responsibilities:
 * - State transition validation
 * - Step handler execution
 * - Session persistence via WizardSessionStore
 * - Discord interaction handling (deferReply, editReply)
 * - Error recovery and failure handling
 *
 * @module packages/wizard/WizardEngine
 */

import {
  WizardState,
  isValidTransition,
  isTerminalState,
  getNextState,
  getPreviousState,
  STATE_DISPLAY_NAMES,
  STATE_PROGRESS,
} from './WizardState.js';
import {
  WizardSession,
  WizardStepData,
  CreateSessionParams,
  UpdateSessionParams,
} from './WizardSession.js';
import { WizardSessionStore } from './WizardSessionStore.js';

/**
 * Step handler result.
 */
export interface StepHandlerResult {
  /** Whether the step completed successfully */
  success: boolean;
  /** Next state to transition to (if success) */
  nextState?: WizardState;
  /** Data to update on session */
  data?: Partial<WizardStepData>;
  /** Error message (if failed) */
  error?: string;
  /** Message to display to user */
  message?: string;
  /** Discord embed for response */
  embed?: WizardEmbed;
  /** Components (buttons, selects) for response */
  components?: WizardComponent[];
}

/**
 * Simplified embed structure for wizard responses.
 */
export interface WizardEmbed {
  title: string;
  description: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: string;
}

/**
 * Component for wizard interactions.
 */
export type WizardComponent =
  | WizardButtonComponent
  | WizardSelectComponent
  | WizardInputComponent;

export interface WizardButtonComponent {
  type: 'button';
  customId: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
}

export interface WizardSelectComponent {
  type: 'select';
  customId: string;
  placeholder: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    default?: boolean;
  }>;
  minValues?: number;
  maxValues?: number;
}

export interface WizardInputComponent {
  type: 'input';
  customId: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

/**
 * Step handler function signature.
 */
export type StepHandler = (
  session: WizardSession,
  input?: StepInput
) => Promise<StepHandlerResult>;

/**
 * Input from user interaction.
 */
export interface StepInput {
  /** Type of interaction */
  type: 'button' | 'select' | 'modal' | 'command';
  /** Custom ID of the component */
  customId?: string;
  /** Selected values (for selects) */
  values?: string[];
  /** Input fields (for modals) */
  fields?: Record<string, string>;
}

/**
 * Engine event types.
 */
export type EngineEvent =
  | { type: 'session_created'; session: WizardSession }
  | { type: 'state_changed'; session: WizardSession; from: WizardState; to: WizardState }
  | { type: 'step_completed'; session: WizardSession; state: WizardState }
  | { type: 'session_completed'; session: WizardSession }
  | { type: 'session_failed'; session: WizardSession; error: string };

/**
 * Engine event listener.
 */
export type EngineEventListener = (event: EngineEvent) => void;

/**
 * WizardEngine configuration.
 */
export interface WizardEngineConfig {
  /** Session store instance */
  store: WizardSessionStore;
  /** Step handlers for each state */
  handlers: Partial<Record<WizardState, StepHandler>>;
  /** Event listener */
  onEvent?: EngineEventListener;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Engine error.
 */
export class WizardEngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string,
    public readonly state?: WizardState
  ) {
    super(message);
    this.name = 'WizardEngineError';
  }
}

/**
 * WizardEngine - Core state machine.
 */
export class WizardEngine {
  private readonly store: WizardSessionStore;
  private readonly handlers: Partial<Record<WizardState, StepHandler>>;
  private readonly onEvent?: EngineEventListener;
  private readonly debug: boolean;

  constructor(config: WizardEngineConfig) {
    this.store = config.store;
    this.handlers = config.handlers;
    this.onEvent = config.onEvent;
    this.debug = config.debug ?? false;
  }

  /**
   * Log debug message.
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[WizardEngine] ${message}`, data ?? '');
    }
  }

  /**
   * Emit engine event.
   */
  private emit(event: EngineEvent): void {
    this.log('Event', { type: event.type });
    this.onEvent?.(event);
  }

  /**
   * Start a new wizard session.
   *
   * @param params - Session creation parameters
   * @returns New session
   */
  async start(params: CreateSessionParams): Promise<WizardSession> {
    this.log('Starting wizard', params);

    const session = await this.store.create(params);
    this.emit({ type: 'session_created', session });

    return session;
  }

  /**
   * Resume an existing session.
   *
   * @param sessionId - Session ID
   * @returns Session or null
   */
  async resume(sessionId: string): Promise<WizardSession | null> {
    this.log('Resuming session', { sessionId });

    const session = await this.store.get(sessionId);
    if (!session) {
      this.log('Session not found', { sessionId });
      return null;
    }

    // Extend TTL on resume
    await this.store.extendTTL(sessionId);

    return session;
  }

  /**
   * Resume user's active session in a guild.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @returns Session or null
   */
  async resumeActive(guildId: string, userId: string): Promise<WizardSession | null> {
    this.log('Resuming active session', { guildId, userId });
    return this.store.getActiveSession(guildId, userId);
  }

  /**
   * Process user input and advance wizard.
   *
   * @param sessionId - Session ID
   * @param input - User input
   * @returns Handler result
   */
  async process(sessionId: string, input?: StepInput): Promise<StepHandlerResult> {
    this.log('Processing input', { sessionId, input });

    const session = await this.store.get(sessionId);
    if (!session) {
      throw new WizardEngineError(
        `Session not found: ${sessionId}`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }

    if (isTerminalState(session.state)) {
      throw new WizardEngineError(
        `Session is in terminal state: ${session.state}`,
        'TERMINAL_STATE',
        sessionId,
        session.state
      );
    }

    // Get handler for current state
    const handler = this.handlers[session.state];
    if (!handler) {
      throw new WizardEngineError(
        `No handler registered for state: ${session.state}`,
        'NO_HANDLER',
        sessionId,
        session.state
      );
    }

    try {
      // Execute handler
      const result = await handler(session, input);

      if (result.success && result.nextState) {
        // Transition to next state
        const fromState = session.state;
        const updatedSession = await this.store.transition(
          sessionId,
          result.nextState,
          result.data
        );

        this.emit({
          type: 'state_changed',
          session: updatedSession,
          from: fromState,
          to: result.nextState,
        });

        this.emit({
          type: 'step_completed',
          session: updatedSession,
          state: fromState,
        });

        // Check for completion
        if (result.nextState === WizardState.COMPLETE) {
          this.emit({ type: 'session_completed', session: updatedSession });
        }
      } else if (!result.success && result.error) {
        // Handle failure - don't auto-transition to FAILED, let caller decide
        this.log('Step failed', { sessionId, error: result.error });
      } else if (result.data) {
        // Update data without state change
        await this.store.update(sessionId, { data: result.data });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log('Handler error', { sessionId, error: errorMessage });

      // Don't auto-fail - let caller decide
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Navigate back to previous step.
   *
   * @param sessionId - Session ID
   * @returns Handler result for previous state
   */
  async back(sessionId: string): Promise<StepHandlerResult> {
    this.log('Going back', { sessionId });

    const session = await this.store.get(sessionId);
    if (!session) {
      throw new WizardEngineError(
        `Session not found: ${sessionId}`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }

    const previousState = getPreviousState(session.state);
    if (!previousState) {
      return {
        success: false,
        error: 'Cannot go back from current state',
      };
    }

    // Transition to previous state
    const fromState = session.state;
    const updatedSession = await this.store.transition(sessionId, previousState);

    this.emit({
      type: 'state_changed',
      session: updatedSession,
      from: fromState,
      to: previousState,
    });

    // Get and execute handler for previous state to generate response
    const handler = this.handlers[previousState];
    if (handler) {
      return handler(updatedSession);
    }

    return {
      success: true,
      message: `Returned to ${STATE_DISPLAY_NAMES[previousState]}`,
    };
  }

  /**
   * Cancel and delete a session.
   *
   * @param sessionId - Session ID
   * @returns true if cancelled
   */
  async cancel(sessionId: string): Promise<boolean> {
    this.log('Cancelling session', { sessionId });

    const session = await this.store.get(sessionId);
    if (!session) {
      return false;
    }

    // Mark as failed before deletion
    await this.store.fail(sessionId, 'Cancelled by user');
    this.emit({ type: 'session_failed', session, error: 'Cancelled by user' });

    // Delete session
    return this.store.delete(sessionId);
  }

  /**
   * Fail a session with error.
   *
   * @param sessionId - Session ID
   * @param error - Error message
   * @returns Failed session
   */
  async fail(sessionId: string, error: string): Promise<WizardSession> {
    this.log('Failing session', { sessionId, error });

    const session = await this.store.fail(sessionId, error);
    this.emit({ type: 'session_failed', session, error });

    return session;
  }

  /**
   * Get current session state.
   *
   * @param sessionId - Session ID
   * @returns Session or null
   */
  async getSession(sessionId: string): Promise<WizardSession | null> {
    return this.store.get(sessionId);
  }

  /**
   * Get progress information for current session.
   *
   * @param session - Session
   * @returns Progress info
   */
  getProgress(session: WizardSession): {
    state: WizardState;
    displayName: string;
    percentage: number;
    stepNumber: number;
    totalSteps: number;
    canGoBack: boolean;
    canCancel: boolean;
  } {
    const state = session.state;
    const stepOrder = [
      WizardState.INIT,
      WizardState.CHAIN_SELECT,
      WizardState.ASSET_CONFIG,
      WizardState.ELIGIBILITY_RULES,
      WizardState.ROLE_MAPPING,
      WizardState.CHANNEL_STRUCTURE,
      WizardState.REVIEW,
      WizardState.DEPLOY,
      WizardState.COMPLETE,
    ];

    const stepNumber = stepOrder.indexOf(state) + 1;
    const totalSteps = stepOrder.length - 1; // Don't count COMPLETE as a step

    return {
      state,
      displayName: STATE_DISPLAY_NAMES[state],
      percentage: STATE_PROGRESS[state],
      stepNumber: Math.min(stepNumber, totalSteps),
      totalSteps,
      canGoBack: getPreviousState(state) !== null && !isTerminalState(state),
      canCancel: !isTerminalState(state),
    };
  }

  /**
   * Generate a progress bar string.
   *
   * @param session - Session
   * @returns Progress bar string
   */
  generateProgressBar(session: WizardSession): string {
    const progress = this.getProgress(session);
    const filled = Math.floor(progress.percentage / 10);
    const empty = 10 - filled;

    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${progress.percentage}% - ${progress.displayName}`;
  }

  /**
   * Build standard navigation components.
   *
   * @param session - Session
   * @returns Navigation components
   */
  buildNavigationComponents(session: WizardSession): WizardComponent[] {
    const progress = this.getProgress(session);
    const components: WizardComponent[] = [];

    if (progress.canGoBack) {
      components.push({
        type: 'button',
        customId: `wizard:back:${session.id}`,
        label: '← Back',
        style: 'secondary',
      });
    }

    if (progress.canCancel) {
      components.push({
        type: 'button',
        customId: `wizard:cancel:${session.id}`,
        label: 'Cancel',
        style: 'danger',
      });
    }

    return components;
  }
}

/**
 * Create a WizardEngine instance.
 *
 * @param config - Engine configuration
 * @returns Engine instance
 */
export function createWizardEngine(config: WizardEngineConfig): WizardEngine {
  return new WizardEngine(config);
}
