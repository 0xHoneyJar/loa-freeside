/**
 * Capability Mesh — Relationship-based capability surfaces (cycle-043 Phase II)
 *
 * Extends the CapabilityCatalog to support ensemble capabilities that unlock
 * when model *combinations* demonstrate quality above a threshold.
 *
 * The MeshResolver uses an InteractionHistoryProvider interface (dependency injection)
 * to decouple from the persistent audit query layer (Sprint 3, Task 3.1).
 *
 * SDD ref: Post-convergence Comment 3, Speculation 1
 * Sprint: 363, Task 2.2
 */

import type {
  CapabilityResolver,
  CapabilitySet,
  ResolutionContext,
} from './capability-catalog.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Record of interaction between two models */
export interface InteractionRecord {
  model_pair: [string, string];
  quality_score: number;
  observation_count: number;
}

/** Provider interface for interaction history — decoupled from storage layer */
export interface InteractionHistoryProvider {
  /**
   * Get interaction records between two models.
   * Returns empty array if no interactions found.
   */
  getInteractions(modelA: string, modelB: string): Promise<InteractionRecord[]>;
}

/** Threshold configuration for ensemble capability unlocking */
export interface MeshThresholdConfig {
  /** Minimum observations required to consider the pair (default: 10) */
  min_observations: number;
  /** Minimum average quality score (0-1) to unlock ensemble (default: 0.7) */
  min_quality_score: number;
}

/** Extended resolution context for mesh evaluation */
export interface MeshResolutionContext extends ResolutionContext {
  /** Ordered list of model_ids in the delegation chain */
  delegation_chain?: string[];
}

// ─── In-Memory Provider ──────────────────────────────────────────────────────

/**
 * In-memory interaction history provider.
 *
 * Seeded from configuration or test fixtures. Sufficient for unit/integration
 * tests and initial deployment with manually-seeded data.
 *
 * TODO (Task 3.1): AuditBackedInteractionHistoryProvider wires
 * AuditQueryService.getModelPairInteractions() into this interface.
 */
export class InMemoryInteractionHistoryProvider implements InteractionHistoryProvider {
  private records: InteractionRecord[];

  constructor(records: InteractionRecord[] = []) {
    this.records = records;
  }

  async getInteractions(modelA: string, modelB: string): Promise<InteractionRecord[]> {
    // Normalize pair ordering for consistent lookup
    const [a, b] = [modelA, modelB].sort();
    return this.records.filter(
      (r) => {
        const [ra, rb] = [...r.model_pair].sort();
        return ra === a && rb === b;
      },
    );
  }

  /** Add a record (for test seeding) */
  addRecord(record: InteractionRecord): void {
    this.records.push(record);
  }
}

// ─── Mesh Resolver ───────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: MeshThresholdConfig = {
  min_observations: 10,
  min_quality_score: 0.7,
};

/**
 * MeshResolver — Grants ensemble capabilities based on model pair interaction quality.
 *
 * When two models have sufficient observations above the quality threshold,
 * the mesh resolver grants ensemble strategy capabilities. These are ADDITIVE
 * to individual capabilities (monotonic expansion preserved).
 */
export class MeshResolver implements CapabilityResolver {
  readonly name = 'mesh';
  readonly priority: number;
  private provider: InteractionHistoryProvider;
  private thresholds: MeshThresholdConfig;
  private ensembleCapabilities: string[];

  constructor(options: {
    provider: InteractionHistoryProvider;
    thresholds?: Partial<MeshThresholdConfig>;
    ensembleCapabilities?: string[];
    priority?: number;
  }) {
    this.provider = options.provider;
    const merged = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    // Validate thresholds — reject non-positive or non-finite values
    if (!Number.isFinite(merged.min_observations) || merged.min_observations < 1) {
      throw new Error('min_observations must be a positive integer >= 1');
    }
    if (!Number.isFinite(merged.min_quality_score) || merged.min_quality_score < 0 || merged.min_quality_score > 1) {
      throw new Error('min_quality_score must be a finite number between 0 and 1');
    }
    this.thresholds = merged;
    this.ensembleCapabilities = options.ensembleCapabilities ?? [
      'can_use_ensemble',
      'ensemble_voting',
      'ensemble_cascade',
    ];
    this.priority = options.priority ?? 75;
  }

  /**
   * Resolve capabilities for a context.
   *
   * Note: This is synchronous per the CapabilityResolver interface, but the
   * interaction history lookup is async. For the initial implementation, we
   * use resolveAsync() and cache the result. The synchronous resolve() returns
   * an empty set (fail-closed) — callers should use resolveAsync() directly.
   */
  resolve(_context: ResolutionContext): CapabilitySet {
    // Synchronous fallback: fail-closed to empty (no ensemble capabilities)
    return {
      capabilities: [],
      schemas: [],
      rate_limit_tier: 'free',
      ensemble_strategies: [],
    };
  }

  /**
   * Async capability resolution — evaluates delegation chains against
   * interaction history to determine if ensemble capabilities should unlock.
   */
  async resolveAsync(context: MeshResolutionContext): Promise<CapabilitySet> {
    const chain = context.delegation_chain;

    // No delegation chain → no ensemble capabilities
    if (!chain || chain.length < 2) {
      return {
        capabilities: [],
        schemas: [],
        rate_limit_tier: 'free',
        ensemble_strategies: [],
      };
    }

    // Check all adjacent pairs in the delegation chain
    const pairResults: boolean[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const meetsThreshold = await this.evaluatePair(chain[i], chain[i + 1]);
      pairResults.push(meetsThreshold);
    }

    // ALL pairs must meet threshold for ensemble capabilities to unlock
    const allPairsMeetThreshold = pairResults.every(Boolean);

    if (!allPairsMeetThreshold) {
      return {
        capabilities: [],
        schemas: [],
        rate_limit_tier: 'free',
        ensemble_strategies: [],
      };
    }

    // Unlock ensemble capabilities
    return {
      capabilities: [...this.ensembleCapabilities],
      schemas: [],
      rate_limit_tier: 'free',
      ensemble_strategies: ['voting', 'cascade', 'mixture'],
    };
  }

  /** Evaluate whether a model pair meets the interaction quality threshold */
  private async evaluatePair(modelA: string, modelB: string): Promise<boolean> {
    const interactions = await this.provider.getInteractions(modelA, modelB);

    if (interactions.length === 0) {
      return false;
    }

    // Aggregate across all interaction records for this pair
    // Skip records with non-positive or non-finite observation counts
    let totalObservations = 0;
    let weightedScoreSum = 0;

    for (const record of interactions) {
      if (!Number.isFinite(record.observation_count) || record.observation_count <= 0) {
        continue;
      }
      if (!Number.isFinite(record.quality_score)) {
        continue;
      }
      totalObservations += record.observation_count;
      weightedScoreSum += record.quality_score * record.observation_count;
    }

    if (totalObservations < this.thresholds.min_observations) {
      return false;
    }

    const averageScore = weightedScoreSum / totalObservations;
    return Number.isFinite(averageScore) && averageScore >= this.thresholds.min_quality_score;
  }
}
