/**
 * Repository exports
 * Sprint S-8: ScyllaDB Integration
 *
 * Repository pattern for hot-path data operations.
 */

// Score operations
export {
  ScoreRepository,
  createScoreRepository,
  type ScoreUpdate,
  type ScoreQuery,
  type ScoreRankUpdate,
} from './ScoreRepository.js';

// Leaderboard operations
export {
  LeaderboardRepository,
  createLeaderboardRepository,
  type LeaderboardPage,
  type LeaderboardRecalculateOptions,
  type ProfileRank,
} from './LeaderboardRepository.js';

// Eligibility operations
export {
  EligibilityRepository,
  createEligibilityRepository,
  type EligibilityCheckRequest,
  type EligibilityCheckResult,
  type EligibilityRule,
  type EligibilityChecker,
} from './EligibilityRepository.js';

// Manager
export {
  RepositoryManager,
  createRepositoryManager,
  type RepositoryManagerConfig,
  type TenantRepositories,
} from './RepositoryManager.js';
