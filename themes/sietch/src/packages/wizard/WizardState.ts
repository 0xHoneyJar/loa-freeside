/**
 * WizardState Enum
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Defines the 8 states of the community onboarding wizard.
 * Each state represents a step in the configuration process.
 *
 * State flow:
 *   INIT → CHAIN_SELECT → ASSET_CONFIG → ELIGIBILITY_RULES →
 *   ROLE_MAPPING → CHANNEL_STRUCTURE → REVIEW → DEPLOY → COMPLETE
 *
 * Error state (FAILED) is terminal and requires session restart.
 *
 * @module packages/wizard/WizardState
 */

/**
 * Wizard state enumeration.
 *
 * States represent the wizard's progression through community setup.
 * The state machine enforces valid transitions between states.
 */
export enum WizardState {
  /**
   * Initial state - wizard just started
   * User has invoked /onboard command
   */
  INIT = 'INIT',

  /**
   * Chain selection - user chooses blockchain network
   * Supported: Berachain, Ethereum, Arbitrum, etc.
   */
  CHAIN_SELECT = 'CHAIN_SELECT',

  /**
   * Asset configuration - user specifies tokens/NFTs for eligibility
   * Configures token addresses, minimum amounts, etc.
   */
  ASSET_CONFIG = 'ASSET_CONFIG',

  /**
   * Eligibility rules - user defines tier thresholds and criteria
   * Maps rank ranges to tiers (e.g., 1-10 = Gold)
   */
  ELIGIBILITY_RULES = 'ELIGIBILITY_RULES',

  /**
   * Role mapping - user maps tiers to Discord roles
   * Creates/selects roles for each tier
   */
  ROLE_MAPPING = 'ROLE_MAPPING',

  /**
   * Channel structure - user configures channel categories
   * Sets up private channels for tiers
   */
  CHANNEL_STRUCTURE = 'CHANNEL_STRUCTURE',

  /**
   * Review - user reviews all configuration before deployment
   * Shows summary of all choices
   */
  REVIEW = 'REVIEW',

  /**
   * Deploy - configuration is being applied to Discord
   * Creates roles, channels, sets permissions
   */
  DEPLOY = 'DEPLOY',

  /**
   * Complete - wizard finished successfully
   * Terminal state - session can be cleaned up
   */
  COMPLETE = 'COMPLETE',

  /**
   * Failed - wizard encountered an error
   * Terminal state - requires /resume or restart
   */
  FAILED = 'FAILED',
}

/**
 * Valid state transitions map.
 *
 * Each state maps to an array of states it can transition to.
 * This enforces the wizard flow and prevents invalid jumps.
 */
export const VALID_TRANSITIONS: Record<WizardState, WizardState[]> = {
  [WizardState.INIT]: [WizardState.CHAIN_SELECT, WizardState.FAILED],
  [WizardState.CHAIN_SELECT]: [WizardState.ASSET_CONFIG, WizardState.INIT, WizardState.FAILED],
  [WizardState.ASSET_CONFIG]: [WizardState.ELIGIBILITY_RULES, WizardState.CHAIN_SELECT, WizardState.FAILED],
  [WizardState.ELIGIBILITY_RULES]: [WizardState.ROLE_MAPPING, WizardState.ASSET_CONFIG, WizardState.FAILED],
  [WizardState.ROLE_MAPPING]: [WizardState.CHANNEL_STRUCTURE, WizardState.ELIGIBILITY_RULES, WizardState.FAILED],
  [WizardState.CHANNEL_STRUCTURE]: [WizardState.REVIEW, WizardState.ROLE_MAPPING, WizardState.FAILED],
  [WizardState.REVIEW]: [WizardState.DEPLOY, WizardState.CHANNEL_STRUCTURE, WizardState.FAILED],
  [WizardState.DEPLOY]: [WizardState.COMPLETE, WizardState.FAILED],
  [WizardState.COMPLETE]: [], // Terminal state
  [WizardState.FAILED]: [WizardState.INIT], // Can restart from failure
};

/**
 * State display names for user-friendly messages.
 */
export const STATE_DISPLAY_NAMES: Record<WizardState, string> = {
  [WizardState.INIT]: 'Getting Started',
  [WizardState.CHAIN_SELECT]: 'Blockchain Selection',
  [WizardState.ASSET_CONFIG]: 'Asset Configuration',
  [WizardState.ELIGIBILITY_RULES]: 'Eligibility Rules',
  [WizardState.ROLE_MAPPING]: 'Role Mapping',
  [WizardState.CHANNEL_STRUCTURE]: 'Channel Structure',
  [WizardState.REVIEW]: 'Review Configuration',
  [WizardState.DEPLOY]: 'Deploying...',
  [WizardState.COMPLETE]: 'Setup Complete',
  [WizardState.FAILED]: 'Setup Failed',
};

/**
 * State progress percentages for progress bar display.
 */
export const STATE_PROGRESS: Record<WizardState, number> = {
  [WizardState.INIT]: 0,
  [WizardState.CHAIN_SELECT]: 12,
  [WizardState.ASSET_CONFIG]: 25,
  [WizardState.ELIGIBILITY_RULES]: 37,
  [WizardState.ROLE_MAPPING]: 50,
  [WizardState.CHANNEL_STRUCTURE]: 62,
  [WizardState.REVIEW]: 75,
  [WizardState.DEPLOY]: 87,
  [WizardState.COMPLETE]: 100,
  [WizardState.FAILED]: 0,
};

/**
 * Check if a state transition is valid.
 *
 * @param from - Current state
 * @param to - Target state
 * @returns true if transition is allowed
 */
export function isValidTransition(from: WizardState, to: WizardState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Check if a state is terminal (no further transitions).
 *
 * @param state - State to check
 * @returns true if state is terminal
 */
export function isTerminalState(state: WizardState): boolean {
  return state === WizardState.COMPLETE || state === WizardState.FAILED;
}

/**
 * Get the next state in the normal wizard flow.
 *
 * @param current - Current state
 * @returns Next state or null if terminal
 */
export function getNextState(current: WizardState): WizardState | null {
  const order: WizardState[] = [
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

  const currentIndex = order.indexOf(current);
  if (currentIndex === -1 || currentIndex >= order.length - 1) {
    return null;
  }
  return order[currentIndex + 1];
}

/**
 * Get the previous state in the wizard flow (for back navigation).
 *
 * @param current - Current state
 * @returns Previous state or null if at beginning
 */
export function getPreviousState(current: WizardState): WizardState | null {
  const order: WizardState[] = [
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

  const currentIndex = order.indexOf(current);
  if (currentIndex <= 0) {
    return null;
  }
  return order[currentIndex - 1];
}
