/**
 * Command Handlers Barrel Export
 *
 * Exports all command handler factories for registration.
 */

export { createStatsHandler } from './stats.js';
export { createPositionHandler } from './position.js';
export { createThresholdHandler } from './threshold.js';
export { createLeaderboardHandler } from './leaderboard.js';
export {
  createDirectoryHandler,
  createDirectoryButtonHandler,
  createDirectorySelectHandler,
} from './directory.js';
export {
  createProfileHandler,
  createProfileAutocompleteHandler,
} from './profile.js';
export {
  createBadgesHandler,
  createBadgesAutocompleteHandler,
} from './badges.js';
export {
  createAlertsHandler,
  createAlertsButtonHandler,
  createAlertsSelectHandler,
} from './alerts.js';
export { createNaibHandler } from './naib.js';
export { createAdminStatsHandler } from './admin-stats.js';
export {
  createAdminBadgeHandler,
  createAdminBadgeAutocompleteHandler,
} from './admin-badge.js';

// Sprint S-9: Hot-Path Handlers (ScyllaDB)
export { createPositionHotPathHandler } from './position-hotpath.js';
export { createThresholdHotPathHandler } from './threshold-hotpath.js';
export { createConvictionLeaderboardHandler } from './conviction-leaderboard.js';

// Sprint S-23: Wizard Commands
export {
  createSetupHandler,
  createWizardButtonHandler,
  createWizardSelectHandler,
} from './setup.js';
export {
  createResumeHandler,
  createCancelSetupHandler,
  createSetupStatusHandler,
} from './resume.js';
