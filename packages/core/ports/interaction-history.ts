/**
 * Interaction History Port
 *
 * The InteractionHistoryProvider contract decouples capability/mesh resolution
 * from the persistent audit query layer (dependency injection). It lives in core
 * (the platform substrate) so that BOTH the theme that produces interaction
 * records and the storage adapter that backs them depend on core — never on each
 * other.
 *
 * Originally declared inside themes/sietch (capability-mesh.ts, cycle-043);
 * relocated here to restore the belt direction platform-core <- theme and remove
 * the platform->theme reach-in import (coherence finding F4 / arrakis-shqm).
 */

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
