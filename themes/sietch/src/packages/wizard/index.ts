/**
 * Wizard Package - Community Onboarding State Machine
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Exports all wizard components for community setup wizard.
 *
 * @module packages/wizard
 */

// Core types
export {
  WizardState,
  VALID_TRANSITIONS,
  STATE_DISPLAY_NAMES,
  STATE_PROGRESS,
  isValidTransition,
  isTerminalState,
  getNextState,
  getPreviousState,
} from './WizardState.js';

export type {
  ChainId,
  AssetType,
  AssetConfig,
  TierConfig,
  RoleMapping,
  ChannelConfig,
  WizardStepData,
  DeploymentResult,
  WizardSession,
  CreateSessionParams,
  UpdateSessionParams,
  SessionQueryResult,
  SessionFilter,
} from './WizardSession.js';

export {
  DEFAULT_SESSION_TTL,
  generateSessionId,
  createWizardSession,
  isSessionExpired,
  serializeSession,
  deserializeSession,
} from './WizardSession.js';

// Session store
export type { SessionStoreConfig } from './WizardSessionStore.js';

export {
  WizardSessionStore,
  SessionStoreError,
  createWizardSessionStore,
} from './WizardSessionStore.js';

// Engine
export type {
  StepHandlerResult,
  WizardEmbed,
  WizardComponent,
  WizardButtonComponent,
  WizardSelectComponent,
  WizardInputComponent,
  StepHandler,
  StepInput,
  EngineEvent,
  EngineEventListener,
  WizardEngineConfig,
} from './WizardEngine.js';

export {
  WizardEngine,
  WizardEngineError,
  createWizardEngine,
} from './WizardEngine.js';

// Handlers
export { stepHandlers } from './handlers/index.js';
export { initHandler } from './handlers/initHandler.js';
export { chainSelectHandler } from './handlers/chainSelectHandler.js';
export { assetConfigHandler } from './handlers/assetConfigHandler.js';
export { eligibilityRulesHandler } from './handlers/eligibilityRulesHandler.js';
export { roleMappingHandler } from './handlers/roleMappingHandler.js';
export { channelStructureHandler } from './handlers/channelStructureHandler.js';
export { reviewHandler } from './handlers/reviewHandler.js';
export { deployHandler } from './handlers/deployHandler.js';
