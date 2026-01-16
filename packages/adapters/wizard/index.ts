/**
 * Wizard Adapters
 *
 * Sprint S-20: Wizard Session Store & State Model
 * Sprint S-23: WizardEngine Implementation
 *
 * Exports wizard-related adapter implementations:
 * - RedisWizardSessionStore - Redis-backed session management
 * - S3ShadowStateStore - S3-backed manifest history and drift detection
 * - WizardEngine - 8-step onboarding wizard orchestrator
 * - Step Handlers - Individual step implementations
 */

// Redis Session Store
export {
  RedisWizardSessionStore,
  createRedisWizardSessionStore,
  type RedisClient,
  type RedisSessionStoreOptions,
} from './redis-session-store.js';

// S3 Shadow State Store
export {
  S3ShadowStateStore,
  createShadowStateStore,
  type S3Client,
  type ShadowStateStoreOptions,
  type ShadowStateMetadata,
  type ShadowStateSnapshot,
  type DriftComparisonResult,
  type DriftItem,
  type ActualDiscordState,
  type ActualRole,
  type ActualChannel,
} from './shadow-state-store.js';

// WizardEngine (Sprint S-23)
export {
  WizardEngine,
  createWizardEngine,
  type WizardEngineOptions,
  type AnalyticsRedisClient,
} from './engine.js';

// Wizard Metrics
export {
  createNoOpWizardMetrics,
  createWizardMetrics,
  WIZARD_METRIC_NAMES,
  WIZARD_METRIC_LABELS,
  WIZARD_HISTOGRAM_BUCKETS,
  type WizardMetrics,
  type Counter,
  type Gauge,
  type Histogram,
} from './metrics.js';

// Step Handlers
export {
  BaseStepHandler,
  createButton,
  createSelectMenu,
  createActionRow,
  createNavigationButtons,
  ButtonStyle,
  InitStepHandler,
  createInitStepHandler,
  ChainSelectStepHandler,
  createChainSelectStepHandler,
  AssetConfigStepHandler,
  createAssetConfigStepHandler,
  EligibilityRulesStepHandler,
  createEligibilityRulesStepHandler,
  RoleMappingStepHandler,
  createRoleMappingStepHandler,
  ChannelStructureStepHandler,
  createChannelStructureStepHandler,
  ReviewStepHandler,
  createReviewStepHandler,
  DeployStepHandler,
  createDeployStepHandler,
  createAllStepHandlers,
} from './steps/index.js';
