/**
 * Discord Handlers Barrel Export
 */

export { handleInteraction } from './InteractionHandler.js';
export { handleAutocomplete } from './AutocompleteHandler.js';
export { setupEventHandlers } from './EventHandler.js';

// Sprint 102: Intelligent Onboarding
export {
  GuildJoinHandler,
  createGuildJoinHandler,
  type OnboardingResult,
  type GuildJoinHandlerOptions,
} from './GuildJoinHandler.js';
export {
  ModeSelector,
  createModeSelector,
  selectOnboardingMode,
  MODE_THRESHOLDS,
  type OnboardingMode,
  type DetectionEvidence,
  type ModeSelectionResult,
} from './ModeSelector.js';
