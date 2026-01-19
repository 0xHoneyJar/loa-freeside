/**
 * Migration System - Admin Migration Prompts
 *
 * Sprint 105: Migration System
 *
 * @module services/discord/migration
 */

export {
  MigrationPrompter,
  createMigrationPrompter,
  // Constants
  MIGRATION_THRESHOLDS,
  MIGRATION_MODES,
  PROMPT_ACTIONS,
  // Types
  type MigrationMode,
  type PromptAction,
  type ReadinessResult,
  type PromptContent,
  type MigrationPrompt,
  type CommunityState,
  type IMigrationStorage,
  type IMigrationNotifier,
  type IMigrationEvents,
} from './MigrationPrompter.js';
