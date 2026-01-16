/**
 * IWizardEngine Interface
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Port interface for the 8-step self-service onboarding wizard.
 * Coordinates session management, step transitions, and deployment.
 *
 * @see SDD §6.3 WizardEngine
 */

import type {
  WizardSession,
  WizardState,
  ChainConfig,
  AssetConfig,
  EligibilityRuleConfig,
  TierRoleMapping,
  ChannelTemplate,
  ChannelConfig,
  CommunityManifest,
  DeploymentStatus,
} from '../domain/wizard.js';

// =============================================================================
// Step Handler Types
// =============================================================================

/**
 * Result of a wizard step execution.
 */
export interface StepResult {
  /** Whether the step succeeded */
  success: boolean;
  /** Updated session data */
  session?: WizardSession;
  /** Error message if failed */
  error?: string;
  /** Whether to show an ephemeral response */
  ephemeral?: boolean;
  /** Response message */
  message?: string;
  /** Response embeds */
  embeds?: unknown[];
  /** Response components (buttons, selects) */
  components?: unknown[];
}

/**
 * Context provided to step handlers.
 */
export interface StepContext {
  /** Session ID */
  sessionId: string;
  /** Current session */
  session: WizardSession;
  /** Discord guild ID */
  guildId: string;
  /** Discord user ID */
  userId: string;
  /** Client IP address */
  ipAddress?: string;
  /** Interaction ID (for responses) */
  interactionId?: string;
  /** Interaction token (for responses) */
  interactionToken?: string;
}

/**
 * Input for step handlers.
 */
export interface StepInput {
  /** Data from user input (varies by step) */
  data: Record<string, unknown>;
  /** Whether this is a "back" navigation */
  isBack?: boolean;
  /** Whether to skip validation (for previews) */
  skipValidation?: boolean;
}

// =============================================================================
// Step-Specific Input Types
// =============================================================================

/**
 * INIT step input - community name.
 */
export interface InitStepInput {
  communityName: string;
}

/**
 * CHAIN_SELECT step input - selected chains.
 */
export interface ChainSelectInput {
  chains: ChainConfig[];
}

/**
 * ASSET_CONFIG step input - configured assets.
 */
export interface AssetConfigInput {
  assets: AssetConfig[];
}

/**
 * ELIGIBILITY_RULES step input - eligibility rules.
 */
export interface EligibilityRulesInput {
  rules: EligibilityRuleConfig[];
}

/**
 * ROLE_MAPPING step input - tier to role mappings.
 */
export interface RoleMappingInput {
  tierRoles: TierRoleMapping[];
}

/**
 * CHANNEL_STRUCTURE step input - channel configuration.
 */
export interface ChannelStructureInput {
  channelTemplate: ChannelTemplate;
  customChannels?: ChannelConfig[];
}

/**
 * REVIEW step input - validation result.
 */
export interface ReviewStepInput {
  validated: boolean;
}

/**
 * DEPLOY step input - deployment confirmation.
 */
export interface DeployStepInput {
  confirmed: boolean;
}

// =============================================================================
// Analytics Types
// =============================================================================

/**
 * Wizard funnel analytics.
 */
export interface WizardFunnelStats {
  /** Total wizards started */
  started: number;
  /** Reached each step */
  reachedByStep: Record<WizardState, number>;
  /** Completed (reached DEPLOY) */
  completed: number;
  /** Completion rate (0-1) */
  completionRate: number;
  /** Average time to complete (seconds) */
  averageCompletionTime: number;
  /** Drop-off by step */
  dropOffByStep: Record<WizardState, number>;
  /** Time period (ISO date range) */
  period: { start: Date; end: Date };
}

/**
 * Step-level analytics.
 */
export interface StepAnalytics {
  /** Step state */
  step: WizardState;
  /** Average time spent on step (seconds) */
  averageTimeSeconds: number;
  /** Number of back navigations from this step */
  backNavigations: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Most common error */
  mostCommonError?: string;
}

// =============================================================================
// IWizardEngine Interface
// =============================================================================

/**
 * Port interface for the WizardEngine.
 *
 * Coordinates the 8-step onboarding flow:
 * 1. INIT - Welcome and community name
 * 2. CHAIN_SELECT - Blockchain selection
 * 3. ASSET_CONFIG - Contract address entry
 * 4. ELIGIBILITY_RULES - Threshold configuration
 * 5. ROLE_MAPPING - Tier to role mapping
 * 6. CHANNEL_STRUCTURE - Channel template selection
 * 7. REVIEW - Manifest preview
 * 8. DEPLOY - Execute synthesis
 */
export interface IWizardEngine {
  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Start a new wizard session.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID (admin)
   * @param communityId - Tenant community ID
   * @param ipAddress - Client IP for binding
   * @returns New session
   * @throws Error if session already exists for guild
   */
  startSession(
    guildId: string,
    userId: string,
    communityId: string,
    ipAddress?: string
  ): Promise<WizardSession>;

  /**
   * Resume an existing session.
   *
   * @param sessionId - Session UUID
   * @param ipAddress - Client IP for validation
   * @returns Session or null if not found/invalid
   */
  resumeSession(sessionId: string, ipAddress?: string): Promise<WizardSession | null>;

  /**
   * Resume session by guild ID.
   *
   * @param guildId - Discord guild ID
   * @param ipAddress - Client IP for validation
   * @returns Session or null if not found/invalid
   */
  resumeByGuild(guildId: string, ipAddress?: string): Promise<WizardSession | null>;

  /**
   * Cancel a wizard session.
   *
   * @param sessionId - Session UUID
   * @returns True if cancelled
   */
  cancelSession(sessionId: string): Promise<boolean>;

  // ===========================================================================
  // Step Execution
  // ===========================================================================

  /**
   * Execute a step in the wizard.
   *
   * @param context - Step execution context
   * @param input - Step input data
   * @returns Step result with updated session
   */
  executeStep(context: StepContext, input: StepInput): Promise<StepResult>;

  /**
   * Navigate back to previous step.
   *
   * @param sessionId - Session UUID
   * @returns Step result with updated session
   */
  goBack(sessionId: string): Promise<StepResult>;

  /**
   * Get the current step's display data.
   *
   * @param sessionId - Session UUID
   * @returns Step display data (embeds, components)
   */
  getCurrentStepDisplay(sessionId: string): Promise<StepResult>;

  // ===========================================================================
  // Manifest Operations
  // ===========================================================================

  /**
   * Generate manifest from session data.
   *
   * @param sessionId - Session UUID
   * @returns Generated manifest
   * @throws Error if session data incomplete
   */
  generateManifest(sessionId: string): Promise<CommunityManifest>;

  /**
   * Validate manifest before deployment.
   *
   * @param manifest - Manifest to validate
   * @returns Validation result
   */
  validateManifest(manifest: CommunityManifest): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;

  // ===========================================================================
  // Deployment
  // ===========================================================================

  /**
   * Deploy the wizard configuration.
   * Triggers SynthesisEngine to create roles/channels.
   *
   * @param sessionId - Session UUID
   * @returns Deployment job ID
   * @throws Error if manifest not validated
   */
  deploy(sessionId: string): Promise<string>;

  /**
   * Get deployment status.
   *
   * @param sessionId - Session UUID
   * @returns Current deployment status
   */
  getDeploymentStatus(sessionId: string): Promise<{
    status: DeploymentStatus;
    progress: number;
    jobIds: string[];
    errors?: string[];
  }>;

  // ===========================================================================
  // Analytics
  // ===========================================================================

  /**
   * Get funnel analytics for a time period.
   *
   * @param startDate - Start of period
   * @param endDate - End of period
   * @returns Funnel statistics
   */
  getFunnelStats(startDate: Date, endDate: Date): Promise<WizardFunnelStats>;

  /**
   * Get analytics for a specific step.
   *
   * @param step - Step state
   * @param startDate - Start of period
   * @param endDate - End of period
   * @returns Step analytics
   */
  getStepAnalytics(
    step: WizardState,
    startDate: Date,
    endDate: Date
  ): Promise<StepAnalytics>;

  /**
   * Track analytics event.
   *
   * @param sessionId - Session UUID
   * @param event - Event name
   * @param data - Event data
   */
  trackEvent(sessionId: string, event: string, data?: Record<string, unknown>): Promise<void>;
}

// =============================================================================
// Step Handler Interface
// =============================================================================

/**
 * Interface for individual step handlers.
 */
export interface IWizardStepHandler {
  /** Step this handler manages */
  readonly step: WizardState;

  /**
   * Execute the step with given input.
   *
   * @param context - Step context
   * @param input - Step input
   * @returns Step result
   */
  execute(context: StepContext, input: StepInput): Promise<StepResult>;

  /**
   * Get display data for this step.
   *
   * @param session - Current session
   * @returns Display data (embeds, components)
   */
  getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }>;

  /**
   * Validate input for this step.
   *
   * @param input - Input to validate
   * @param session - Current session
   * @returns Validation result
   */
  validate(input: StepInput, session: WizardSession): Promise<{
    valid: boolean;
    errors: string[];
  }>;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Analytics event names.
 */
export const WIZARD_ANALYTICS_EVENTS = {
  SESSION_STARTED: 'wizard.session.started',
  SESSION_RESUMED: 'wizard.session.resumed',
  SESSION_CANCELLED: 'wizard.session.cancelled',
  SESSION_EXPIRED: 'wizard.session.expired',
  STEP_ENTERED: 'wizard.step.entered',
  STEP_COMPLETED: 'wizard.step.completed',
  STEP_ERROR: 'wizard.step.error',
  STEP_BACK: 'wizard.step.back',
  DEPLOYMENT_STARTED: 'wizard.deployment.started',
  DEPLOYMENT_COMPLETED: 'wizard.deployment.completed',
  DEPLOYMENT_FAILED: 'wizard.deployment.failed',
} as const;

/**
 * Target completion rate (80% per SDD).
 */
export const TARGET_COMPLETION_RATE = 0.8;
