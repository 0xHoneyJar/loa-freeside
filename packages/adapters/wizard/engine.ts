/**
 * WizardEngine Implementation
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Orchestrates the 8-step self-service onboarding wizard.
 * Coordinates session management, step handlers, and deployment.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type {
  IWizardEngine,
  IWizardStepHandler,
  StepContext,
  StepInput,
  StepResult,
  WizardFunnelStats,
  StepAnalytics,
} from '@arrakis/core/ports';
import type {
  IWizardSessionStore,
} from '@arrakis/core/ports';
import type { ISynthesisEngine } from '@arrakis/core/ports';
import type {
  WizardSession,
  WizardState,
  CommunityManifest,
  DeploymentStatus,
} from '@arrakis/core/domain';
import {
  WizardState as WizardStateEnum,
  getNextState,
  getPreviousState,
  getStepNumber,
} from '@arrakis/core/domain';
import { WIZARD_ANALYTICS_EVENTS } from '@arrakis/core/ports';
import type { WizardMetrics } from './metrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Redis client interface for analytics.
 */
export interface AnalyticsRedisClient {
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  get(key: string): Promise<string | null>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
}

/**
 * Options for WizardEngine.
 */
export interface WizardEngineOptions {
  /** Session store */
  sessionStore: IWizardSessionStore;
  /** Synthesis engine for deployment */
  synthesisEngine: ISynthesisEngine;
  /** Step handlers map */
  stepHandlers: Map<WizardState, IWizardStepHandler>;
  /** Redis client for analytics */
  analyticsRedis: AnalyticsRedisClient;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: WizardMetrics;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * WizardEngine orchestrates the 8-step onboarding flow.
 */
export class WizardEngine implements IWizardEngine {
  private readonly sessionStore: IWizardSessionStore;
  private readonly synthesisEngine: ISynthesisEngine;
  private readonly stepHandlers: Map<WizardState, IWizardStepHandler>;
  private readonly analyticsRedis: AnalyticsRedisClient;
  private readonly log: Logger;
  private readonly metrics: WizardMetrics;

  constructor(options: WizardEngineOptions) {
    this.sessionStore = options.sessionStore;
    this.synthesisEngine = options.synthesisEngine;
    this.stepHandlers = options.stepHandlers;
    this.analyticsRedis = options.analyticsRedis;
    this.log = options.logger.child({ component: 'WizardEngine' });
    this.metrics = options.metrics;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  async startSession(
    guildId: string,
    userId: string,
    communityId: string,
    ipAddress?: string
  ): Promise<WizardSession> {
    // Check for existing session
    const existing = await this.sessionStore.getByGuild(guildId);
    if (existing) {
      throw new Error(`Session already exists for guild ${guildId}. Use /resume to continue.`);
    }

    // Create new session
    const session = await this.sessionStore.create({
      guildId,
      userId,
      communityId,
      state: WizardStateEnum.INIT,
      data: {},
      ipAddress,
    });

    // Track analytics
    await this.trackEvent(session.id, WIZARD_ANALYTICS_EVENTS.SESSION_STARTED, {
      guildId,
      userId,
    });
    this.metrics.sessionsStarted.inc();

    this.log.info(
      { sessionId: session.id, guildId, userId },
      'Wizard session started'
    );

    return session;
  }

  async resumeSession(sessionId: string, ipAddress?: string): Promise<WizardSession | null> {
    const validation = await this.sessionStore.validateSession(sessionId, ipAddress ?? '');

    if (!validation.valid) {
      this.log.warn({ sessionId, reason: validation.reason }, 'Invalid session resume attempt');
      return null;
    }

    const session = validation.session!;

    // Refresh TTL
    await this.sessionStore.refresh(sessionId);

    // Track analytics
    await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.SESSION_RESUMED);
    this.metrics.sessionsResumed.inc();

    this.log.info({ sessionId, state: session.state }, 'Wizard session resumed');

    return session;
  }

  async resumeByGuild(guildId: string, ipAddress?: string): Promise<WizardSession | null> {
    const session = await this.sessionStore.getByGuild(guildId);
    if (!session) {
      return null;
    }

    return this.resumeSession(session.id, ipAddress);
  }

  async cancelSession(sessionId: string): Promise<boolean> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return false;
    }

    const deleted = await this.sessionStore.delete(sessionId);

    if (deleted) {
      await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.SESSION_CANCELLED, {
        lastState: session.state,
      });
      this.metrics.sessionsCancelled.inc();
      this.log.info({ sessionId, lastState: session.state }, 'Wizard session cancelled');
    }

    return deleted;
  }

  // ===========================================================================
  // Step Execution
  // ===========================================================================

  async executeStep(context: StepContext, input: StepInput): Promise<StepResult> {
    const { sessionId, session } = context;
    const currentState = session.state;
    const stepNumber = getStepNumber(currentState);

    // Get handler for current state
    const handler = this.stepHandlers.get(currentState);
    if (!handler) {
      return {
        success: false,
        error: `No handler for state ${currentState}`,
      };
    }

    // Track step entry
    await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.STEP_ENTERED, {
      step: currentState,
      stepNumber,
    });

    const startTime = Date.now();

    try {
      // Validate input (unless skipped)
      if (!input.skipValidation) {
        const validation = await handler.validate(input, session);
        if (!validation.valid) {
          this.metrics.stepErrors.inc({ step: currentState });
          await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.STEP_ERROR, {
            step: currentState,
            errors: validation.errors,
          });
          return {
            success: false,
            error: validation.errors.join(', '),
          };
        }
      }

      // Execute the step
      const result = await handler.execute(context, input);

      if (result.success) {
        const duration = Date.now() - startTime;
        this.metrics.stepDuration.observe({ step: currentState }, duration / 1000);
        this.metrics.stepCompletions.inc({ step: currentState });

        await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.STEP_COMPLETED, {
          step: currentState,
          durationMs: duration,
        });

        // Transition to next state if not already terminal
        const nextState = getNextState(currentState);
        if (nextState && !input.isBack) {
          const transitionResult = await this.sessionStore.transition(
            sessionId,
            nextState,
            input.data as Record<string, unknown>
          );

          if (transitionResult.success) {
            result.session = transitionResult.session;
          }
        }
      }

      return result;
    } catch (error) {
      const err = error as Error;
      this.log.error({ sessionId, step: currentState, error: err.message }, 'Step execution error');
      this.metrics.stepErrors.inc({ step: currentState });

      await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.STEP_ERROR, {
        step: currentState,
        error: err.message,
      });

      return {
        success: false,
        error: err.message,
      };
    }
  }

  async goBack(sessionId: string): Promise<StepResult> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const previousState = getPreviousState(session.state);
    if (!previousState) {
      return { success: false, error: 'Cannot go back from initial state' };
    }

    const result = await this.sessionStore.transition(sessionId, previousState);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    this.metrics.stepBackNavigations.inc({ step: session.state });
    await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.STEP_BACK, {
      from: session.state,
      to: previousState,
    });

    this.log.debug({ sessionId, from: session.state, to: previousState }, 'Step back navigation');

    return {
      success: true,
      session: result.session,
    };
  }

  async getCurrentStepDisplay(sessionId: string): Promise<StepResult> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const handler = this.stepHandlers.get(session.state);
    if (!handler) {
      return { success: false, error: `No handler for state ${session.state}` };
    }

    const display = await handler.getDisplay(session);

    return {
      success: true,
      session,
      embeds: display.embeds,
      components: display.components,
    };
  }

  // ===========================================================================
  // Manifest Operations
  // ===========================================================================

  async generateManifest(sessionId: string): Promise<CommunityManifest> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const { data } = session;

    // Validate required data
    if (!data.communityName) throw new Error('Community name required');
    if (!data.chains || data.chains.length === 0) throw new Error('Chains required');
    if (!data.assets || data.assets.length === 0) throw new Error('Assets required');
    if (!data.rules || data.rules.length === 0) throw new Error('Rules required');
    if (!data.tierRoles || data.tierRoles.length === 0) throw new Error('Tier roles required');
    if (!data.channelTemplate) throw new Error('Channel template required');

    const now = new Date();
    const manifest: CommunityManifest = {
      version: '1.0.0',
      name: data.communityName,
      themeId: 'basic', // Default theme, can be customized
      chains: data.chains,
      assets: data.assets,
      rules: data.rules,
      tierRoles: data.tierRoles,
      channelTemplate: data.channelTemplate,
      channels: data.customChannels,
      createdAt: now,
      updatedAt: now,
    };

    // Store manifest in session
    await this.sessionStore.update(sessionId, {
      data: { ...data, manifest },
    });

    this.log.info({ sessionId, manifestName: manifest.name }, 'Manifest generated');

    return manifest;
  }

  async validateManifest(manifest: CommunityManifest): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (!manifest.name?.trim()) {
      errors.push('Community name is required');
    }

    if (!manifest.chains || manifest.chains.length === 0) {
      errors.push('At least one chain must be configured');
    }

    if (!manifest.assets || manifest.assets.length === 0) {
      errors.push('At least one asset must be configured');
    }

    if (!manifest.rules || manifest.rules.length === 0) {
      errors.push('At least one eligibility rule must be configured');
    }

    if (!manifest.tierRoles || manifest.tierRoles.length === 0) {
      errors.push('At least one tier role mapping is required');
    }

    // Validate chains have enabled flag
    for (const chain of manifest.chains ?? []) {
      if (!chain.enabled) {
        warnings.push(`Chain ${chain.name} is not enabled`);
      }
    }

    // Validate assets reference valid chains
    const validChainIds = new Set(manifest.chains?.map(c => c.chainId) ?? []);
    for (const asset of manifest.assets ?? []) {
      if (!validChainIds.has(asset.chainId)) {
        errors.push(`Asset ${asset.name} references unknown chain ${asset.chainId}`);
      }
    }

    // Validate rules reference valid assets
    const validAssetIds = new Set(manifest.assets?.map(a => a.id) ?? []);
    for (const rule of manifest.rules ?? []) {
      if (!validAssetIds.has(rule.assetId)) {
        errors.push(`Rule ${rule.id} references unknown asset ${rule.assetId}`);
      }
    }

    // Validate channel configuration
    if (manifest.channelTemplate === 'custom' && (!manifest.channels || manifest.channels.length === 0)) {
      errors.push('Custom channel template requires at least one channel');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ===========================================================================
  // Deployment
  // ===========================================================================

  async deploy(sessionId: string): Promise<string> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const { data } = session;
    if (!data.manifest || !data.validated) {
      throw new Error('Manifest must be generated and validated before deployment');
    }

    // Start deployment
    await this.sessionStore.update(sessionId, {
      data: { ...data, deploymentStatus: 'pending' },
    });

    await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.DEPLOYMENT_STARTED);
    this.metrics.deploymentsStarted.inc();

    try {
      // Trigger synthesis
      const result = await this.synthesisEngine.enqueueSynthesis(
        session.communityId,
        session.guildId,
        data.manifest
      );

      // Update session with job info
      await this.sessionStore.update(sessionId, {
        state: WizardStateEnum.DEPLOY,
        data: {
          ...data,
          deploymentStatus: 'roles_creating',
          synthesisJobId: result.jobIds[0],
        },
      });

      this.log.info(
        { sessionId, jobCount: result.jobCount, firstJobId: result.jobIds[0] },
        'Deployment started'
      );

      return result.jobIds[0] ?? sessionId;
    } catch (error) {
      const err = error as Error;
      await this.sessionStore.update(sessionId, {
        data: {
          ...data,
          deploymentStatus: 'failed',
          deploymentError: err.message,
        },
      });

      await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.DEPLOYMENT_FAILED, {
        error: err.message,
      });
      this.metrics.deploymentsFailed.inc();

      throw error;
    }
  }

  async getDeploymentStatus(sessionId: string): Promise<{
    status: DeploymentStatus;
    progress: number;
    jobIds: string[];
    errors?: string[];
  }> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return { status: 'failed', progress: 0, jobIds: [], errors: ['Session not found'] };
    }

    const { data } = session;
    if (!data.synthesisJobId) {
      return { status: data.deploymentStatus ?? 'pending', progress: 0, jobIds: [] };
    }

    // Get job status from synthesis engine
    const jobs = await this.synthesisEngine.getJobsByCommunity(session.communityId);
    const totalJobs = jobs.length;
    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    const failedJobs = jobs.filter(j => j.status === 'failed');

    const progress = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;

    let status: DeploymentStatus = data.deploymentStatus ?? 'pending';
    if (failedJobs.length > 0) {
      status = 'failed';
    } else if (completedJobs === totalJobs && totalJobs > 0) {
      status = 'completed';
      await this.trackEvent(sessionId, WIZARD_ANALYTICS_EVENTS.DEPLOYMENT_COMPLETED);
      this.metrics.deploymentsCompleted.inc();
    } else if (completedJobs > 0) {
      // Determine stage based on completed jobs
      const roleJobs = jobs.filter(j => j.data.type.includes('role'));
      const channelJobs = jobs.filter(j => j.data.type.includes('channel'));

      if (channelJobs.some(j => j.status === 'completed')) {
        status = 'channels_created';
      } else if (roleJobs.every(j => j.status === 'completed')) {
        status = 'channels_creating';
      } else {
        status = 'roles_creating';
      }
    }

    return {
      status,
      progress,
      jobIds: jobs.map(j => j.jobId),
      errors: failedJobs.map(j => j.failedReason).filter((r): r is string => !!r),
    };
  }

  // ===========================================================================
  // Analytics
  // ===========================================================================

  async getFunnelStats(startDate: Date, endDate: Date): Promise<WizardFunnelStats> {
    const period = { start: startDate, end: endDate };
    const key = `wizard:analytics:${startDate.toISOString().split('T')[0]}`;

    // Get counters from Redis
    const started = parseInt(await this.analyticsRedis.hget(key, 'started') ?? '0', 10);
    const completed = parseInt(await this.analyticsRedis.hget(key, 'completed') ?? '0', 10);

    const reachedByStep: Record<WizardState, number> = {
      [WizardStateEnum.INIT]: started,
      [WizardStateEnum.CHAIN_SELECT]: 0,
      [WizardStateEnum.ASSET_CONFIG]: 0,
      [WizardStateEnum.ELIGIBILITY_RULES]: 0,
      [WizardStateEnum.ROLE_MAPPING]: 0,
      [WizardStateEnum.CHANNEL_STRUCTURE]: 0,
      [WizardStateEnum.REVIEW]: 0,
      [WizardStateEnum.DEPLOY]: completed,
    };

    // Get per-step counts
    for (const state of Object.values(WizardStateEnum)) {
      const count = await this.analyticsRedis.hget(key, `step:${state}`);
      if (count) {
        reachedByStep[state] = parseInt(count, 10);
      }
    }

    // Calculate drop-offs
    const dropOffByStep: Record<WizardState, number> = {
      [WizardStateEnum.INIT]: 0,
      [WizardStateEnum.CHAIN_SELECT]: 0,
      [WizardStateEnum.ASSET_CONFIG]: 0,
      [WizardStateEnum.ELIGIBILITY_RULES]: 0,
      [WizardStateEnum.ROLE_MAPPING]: 0,
      [WizardStateEnum.CHANNEL_STRUCTURE]: 0,
      [WizardStateEnum.REVIEW]: 0,
      [WizardStateEnum.DEPLOY]: 0,
    };

    const states = Object.values(WizardStateEnum);
    for (let i = 0; i < states.length - 1; i++) {
      const current = states[i]!;
      const next = states[i + 1]!;
      dropOffByStep[current] = (reachedByStep[current] ?? 0) - (reachedByStep[next] ?? 0);
    }

    // Get average completion time
    const avgTime = await this.analyticsRedis.hget(key, 'avgCompletionTime');

    return {
      started,
      reachedByStep,
      completed,
      completionRate: started > 0 ? completed / started : 0,
      averageCompletionTime: avgTime ? parseFloat(avgTime) : 0,
      dropOffByStep,
      period,
    };
  }

  async getStepAnalytics(
    step: WizardState,
    startDate: Date,
    _endDate: Date
  ): Promise<StepAnalytics> {
    const key = `wizard:analytics:${startDate.toISOString().split('T')[0]}`;

    const avgTime = await this.analyticsRedis.hget(key, `step:${step}:avgTime`);
    const backNavs = await this.analyticsRedis.hget(key, `step:${step}:back`);
    const errors = await this.analyticsRedis.hget(key, `step:${step}:errors`);
    const total = await this.analyticsRedis.hget(key, `step:${step}`);

    const totalCount = parseInt(total ?? '0', 10);
    const errorCount = parseInt(errors ?? '0', 10);

    return {
      step,
      averageTimeSeconds: avgTime ? parseFloat(avgTime) : 0,
      backNavigations: parseInt(backNavs ?? '0', 10),
      errorRate: totalCount > 0 ? errorCount / totalCount : 0,
    };
  }

  async trackEvent(
    sessionId: string,
    event: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `wizard:analytics:${today}`;

    try {
      // Increment event counter
      await this.analyticsRedis.incr(`${key}:${event}`);

      // Track step-specific events
      if (event === WIZARD_ANALYTICS_EVENTS.STEP_COMPLETED && data?.step) {
        await this.analyticsRedis.incr(`${key}:step:${data.step}`);
        if (data.durationMs) {
          // Update average time (simplified - stores latest)
          await this.analyticsRedis.hset(
            key,
            `step:${data.step}:avgTime`,
            String((data.durationMs as number) / 1000)
          );
        }
      }

      if (event === WIZARD_ANALYTICS_EVENTS.STEP_BACK && data?.from) {
        await this.analyticsRedis.incr(`${key}:step:${data.from}:back`);
      }

      if (event === WIZARD_ANALYTICS_EVENTS.STEP_ERROR && data?.step) {
        await this.analyticsRedis.incr(`${key}:step:${data.step}:errors`);
      }

      if (event === WIZARD_ANALYTICS_EVENTS.SESSION_STARTED) {
        await this.analyticsRedis.incr(`${key}:started`);
      }

      if (event === WIZARD_ANALYTICS_EVENTS.DEPLOYMENT_COMPLETED) {
        await this.analyticsRedis.incr(`${key}:completed`);
      }

      // Log event with session context
      this.log.debug({ sessionId, event, ...data }, 'Analytics event tracked');
    } catch (error) {
      // Analytics errors shouldn't break the flow
      this.log.warn({ sessionId, event, error }, 'Failed to track analytics event');
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a WizardEngine instance.
 *
 * @param options - Engine options
 * @returns WizardEngine instance
 */
export function createWizardEngine(options: WizardEngineOptions): IWizardEngine {
  return new WizardEngine(options);
}
