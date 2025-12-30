/**
 * Coexistence Jobs - Scheduled Tasks for Shadow Mode, Rollback & Health Monitoring
 *
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 * Sprint 63: Migration Engine - Rollback & Takeover (RollbackWatcherJob)
 * Sprint 64: Incumbent Health Monitoring (IncumbentHealthJob)
 *
 * @module packages/jobs/coexistence
 */

// Shadow Sync Job (Sprint 57)
export {
  ShadowSyncJob,
  createShadowSyncJob,
  type ShadowSyncJobConfig,
  type ShadowSyncJobResult,
  type AccuracyAlert,
  type CommunityGuildMapping,
  type GetCommunityGuildMappings,
  type AdminDigest,
} from './ShadowSyncJob.js';

// Rollback Watcher Job (Sprint 63)
export {
  RollbackWatcherJob,
  createRollbackWatcherJob,
  type RollbackWatcherJobConfig,
  type RollbackWatcherJobResult,
  type RollbackDetail,
  type WatcherCommunityMapping,
  type GetWatcherCommunityMappings,
  type GetAccessCounts,
  type GetErrorCounts,
} from './RollbackWatcherJob.js';

// Incumbent Health Job (Sprint 64)
export {
  IncumbentHealthJob,
  createIncumbentHealthJob,
  createHealthCheckTask,
  DEFAULT_JOB_INTERVAL_MS,
  JOB_NAME as HEALTH_JOB_NAME,
  type HealthJobResult,
  type HealthJobConfig,
  type HealthJobPayload,
} from './IncumbentHealthJob.js';
