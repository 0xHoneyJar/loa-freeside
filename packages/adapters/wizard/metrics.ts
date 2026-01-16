/**
 * Wizard Prometheus Metrics
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Defines Prometheus metrics for wizard observability:
 * - Session lifecycle (started, resumed, cancelled)
 * - Step completions and errors
 * - Deployment tracking
 * - Funnel analytics
 *
 * @see SDD §12 Observability Architecture
 */

// =============================================================================
// Metric Type Interfaces
// =============================================================================

/**
 * Counter metric interface.
 */
export interface Counter {
  inc(labels?: Record<string, string>): void;
}

/**
 * Gauge metric interface.
 */
export interface Gauge {
  set(value: number): void;
  inc(): void;
  dec(): void;
}

/**
 * Histogram metric interface.
 */
export interface Histogram {
  observe(labels: Record<string, string>, value: number): void;
}

// =============================================================================
// Wizard Metrics
// =============================================================================

/**
 * Complete set of wizard metrics.
 */
export interface WizardMetrics {
  // Session lifecycle
  sessionsStarted: Counter;
  sessionsResumed: Counter;
  sessionsCancelled: Counter;
  sessionsExpired: Counter;
  activeSessionsGauge: Gauge;

  // Step metrics
  stepCompletions: Counter;
  stepErrors: Counter;
  stepBackNavigations: Counter;
  stepDuration: Histogram;

  // Deployment metrics
  deploymentsStarted: Counter;
  deploymentsCompleted: Counter;
  deploymentsFailed: Counter;
  deploymentDuration: Histogram;

  // Funnel metrics
  funnelCompletionRate: Gauge;
  stepDropOffRate: Gauge;
}

// =============================================================================
// No-Op Implementations
// =============================================================================

function createNoOpCounter(): Counter {
  return {
    inc: () => {},
  };
}

function createNoOpGauge(): Gauge {
  return {
    set: () => {},
    inc: () => {},
    dec: () => {},
  };
}

function createNoOpHistogram(): Histogram {
  return {
    observe: () => {},
  };
}

/**
 * Create no-op wizard metrics for testing.
 *
 * @returns No-op metrics implementation
 */
export function createNoOpWizardMetrics(): WizardMetrics {
  return {
    sessionsStarted: createNoOpCounter(),
    sessionsResumed: createNoOpCounter(),
    sessionsCancelled: createNoOpCounter(),
    sessionsExpired: createNoOpCounter(),
    activeSessionsGauge: createNoOpGauge(),
    stepCompletions: createNoOpCounter(),
    stepErrors: createNoOpCounter(),
    stepBackNavigations: createNoOpCounter(),
    stepDuration: createNoOpHistogram(),
    deploymentsStarted: createNoOpCounter(),
    deploymentsCompleted: createNoOpCounter(),
    deploymentsFailed: createNoOpCounter(),
    deploymentDuration: createNoOpHistogram(),
    funnelCompletionRate: createNoOpGauge(),
    stepDropOffRate: createNoOpGauge(),
  };
}

// =============================================================================
// Metric Names and Labels
// =============================================================================

/**
 * Metric name constants.
 */
export const WIZARD_METRIC_NAMES = {
  // Session metrics
  SESSIONS_STARTED: 'wizard_sessions_started_total',
  SESSIONS_RESUMED: 'wizard_sessions_resumed_total',
  SESSIONS_CANCELLED: 'wizard_sessions_cancelled_total',
  SESSIONS_EXPIRED: 'wizard_sessions_expired_total',
  SESSIONS_ACTIVE: 'wizard_sessions_active',

  // Step metrics
  STEP_COMPLETIONS: 'wizard_step_completions_total',
  STEP_ERRORS: 'wizard_step_errors_total',
  STEP_BACK_NAVIGATIONS: 'wizard_step_back_navigations_total',
  STEP_DURATION: 'wizard_step_duration_seconds',

  // Deployment metrics
  DEPLOYMENTS_STARTED: 'wizard_deployments_started_total',
  DEPLOYMENTS_COMPLETED: 'wizard_deployments_completed_total',
  DEPLOYMENTS_FAILED: 'wizard_deployments_failed_total',
  DEPLOYMENT_DURATION: 'wizard_deployment_duration_seconds',

  // Funnel metrics
  FUNNEL_COMPLETION_RATE: 'wizard_funnel_completion_rate',
  STEP_DROP_OFF_RATE: 'wizard_step_drop_off_rate',
} as const;

/**
 * Common labels for wizard metrics.
 */
export const WIZARD_METRIC_LABELS = {
  STEP: 'step',
  ERROR_TYPE: 'error_type',
  REASON: 'reason',
} as const;

/**
 * Histogram bucket configurations.
 */
export const WIZARD_HISTOGRAM_BUCKETS = {
  // Step duration: 1s, 5s, 10s, 30s, 1min, 2min, 5min
  STEP_DURATION: [1, 5, 10, 30, 60, 120, 300],
  // Deployment duration: 10s, 30s, 1min, 2min, 5min, 10min
  DEPLOYMENT_DURATION: [10, 30, 60, 120, 300, 600],
} as const;

// =============================================================================
// Prometheus Registry Integration
// =============================================================================

/**
 * Create wizard metrics with a Prometheus registry.
 *
 * @param registry - Prometheus registry (prom-client compatible)
 * @returns Wizard metrics instance
 */
export function createWizardMetrics(registry: unknown): WizardMetrics {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = registry as any;

  if (!reg || typeof reg.registerMetric !== 'function') {
    return createNoOpWizardMetrics();
  }

  // Create counters
  const sessionsStarted = new reg.Counter({
    name: WIZARD_METRIC_NAMES.SESSIONS_STARTED,
    help: 'Total number of wizard sessions started',
  });

  const sessionsResumed = new reg.Counter({
    name: WIZARD_METRIC_NAMES.SESSIONS_RESUMED,
    help: 'Total number of wizard sessions resumed',
  });

  const sessionsCancelled = new reg.Counter({
    name: WIZARD_METRIC_NAMES.SESSIONS_CANCELLED,
    help: 'Total number of wizard sessions cancelled',
  });

  const sessionsExpired = new reg.Counter({
    name: WIZARD_METRIC_NAMES.SESSIONS_EXPIRED,
    help: 'Total number of wizard sessions expired',
  });

  const activeSessionsGauge = new reg.Gauge({
    name: WIZARD_METRIC_NAMES.SESSIONS_ACTIVE,
    help: 'Current number of active wizard sessions',
  });

  const stepCompletions = new reg.Counter({
    name: WIZARD_METRIC_NAMES.STEP_COMPLETIONS,
    help: 'Total number of step completions',
    labelNames: [WIZARD_METRIC_LABELS.STEP],
  });

  const stepErrors = new reg.Counter({
    name: WIZARD_METRIC_NAMES.STEP_ERRORS,
    help: 'Total number of step errors',
    labelNames: [WIZARD_METRIC_LABELS.STEP],
  });

  const stepBackNavigations = new reg.Counter({
    name: WIZARD_METRIC_NAMES.STEP_BACK_NAVIGATIONS,
    help: 'Total number of back navigations',
    labelNames: [WIZARD_METRIC_LABELS.STEP],
  });

  const stepDuration = new reg.Histogram({
    name: WIZARD_METRIC_NAMES.STEP_DURATION,
    help: 'Time spent on each wizard step in seconds',
    labelNames: [WIZARD_METRIC_LABELS.STEP],
    buckets: WIZARD_HISTOGRAM_BUCKETS.STEP_DURATION,
  });

  const deploymentsStarted = new reg.Counter({
    name: WIZARD_METRIC_NAMES.DEPLOYMENTS_STARTED,
    help: 'Total number of deployments started',
  });

  const deploymentsCompleted = new reg.Counter({
    name: WIZARD_METRIC_NAMES.DEPLOYMENTS_COMPLETED,
    help: 'Total number of deployments completed',
  });

  const deploymentsFailed = new reg.Counter({
    name: WIZARD_METRIC_NAMES.DEPLOYMENTS_FAILED,
    help: 'Total number of deployments failed',
  });

  const deploymentDuration = new reg.Histogram({
    name: WIZARD_METRIC_NAMES.DEPLOYMENT_DURATION,
    help: 'Time to complete deployment in seconds',
    buckets: WIZARD_HISTOGRAM_BUCKETS.DEPLOYMENT_DURATION,
  });

  const funnelCompletionRate = new reg.Gauge({
    name: WIZARD_METRIC_NAMES.FUNNEL_COMPLETION_RATE,
    help: 'Wizard funnel completion rate (0-1)',
  });

  const stepDropOffRate = new reg.Gauge({
    name: WIZARD_METRIC_NAMES.STEP_DROP_OFF_RATE,
    help: 'Step drop-off rate (0-1)',
    labelNames: [WIZARD_METRIC_LABELS.STEP],
  });

  return {
    sessionsStarted,
    sessionsResumed,
    sessionsCancelled,
    sessionsExpired,
    activeSessionsGauge,
    stepCompletions,
    stepErrors,
    stepBackNavigations,
    stepDuration,
    deploymentsStarted,
    deploymentsCompleted,
    deploymentsFailed,
    deploymentDuration,
    funnelCompletionRate,
    stepDropOffRate,
  };
}
