/**
 * Capability Mesh — Unit tests (Task 2.2)
 */

import { describe, it, expect } from 'vitest';
import {
  MeshResolver,
  InMemoryInteractionHistoryProvider,
} from '../../themes/sietch/src/packages/core/protocol/capability-mesh.js';

describe('InMemoryInteractionHistoryProvider', () => {
  it('should return matching records for a model pair', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelA', 'modelB'], quality_score: 0.8, observation_count: 20 },
      { model_pair: ['modelC', 'modelD'], quality_score: 0.6, observation_count: 5 },
    ]);

    const results = await provider.getInteractions('modelA', 'modelB');
    expect(results).toHaveLength(1);
    expect(results[0].quality_score).toBe(0.8);
  });

  it('should normalize pair ordering for consistent lookup', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelB', 'modelA'], quality_score: 0.9, observation_count: 15 },
    ]);

    // Query with reversed order should still match
    const results = await provider.getInteractions('modelA', 'modelB');
    expect(results).toHaveLength(1);
  });

  it('should return empty for unknown pairs', async () => {
    const provider = new InMemoryInteractionHistoryProvider([]);
    const results = await provider.getInteractions('unknown1', 'unknown2');
    expect(results).toEqual([]);
  });
});

describe('MeshResolver', () => {
  it('should return empty capabilities for single model (no delegation chain)', async () => {
    const provider = new InMemoryInteractionHistoryProvider([]);
    const resolver = new MeshResolver({ provider });

    const result = await resolver.resolveAsync({ delegation_chain: ['modelA'] });
    expect(result.capabilities).toEqual([]);
    expect(result.ensemble_strategies).toEqual([]);
  });

  it('should return empty capabilities when no delegation chain provided', async () => {
    const provider = new InMemoryInteractionHistoryProvider([]);
    const resolver = new MeshResolver({ provider });

    const result = await resolver.resolveAsync({});
    expect(result.capabilities).toEqual([]);
  });

  it('should unlock ensemble capabilities when pair exceeds threshold', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelA', 'modelB'], quality_score: 0.85, observation_count: 20 },
    ]);

    const resolver = new MeshResolver({
      provider,
      thresholds: { min_observations: 10, min_quality_score: 0.7 },
    });

    const result = await resolver.resolveAsync({
      delegation_chain: ['modelA', 'modelB'],
    });

    expect(result.capabilities).toContain('can_use_ensemble');
    expect(result.ensemble_strategies).toContain('voting');
    expect(result.ensemble_strategies).toContain('cascade');
  });

  it('should NOT unlock ensemble capabilities when below observation threshold', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelA', 'modelB'], quality_score: 0.9, observation_count: 5 },
    ]);

    const resolver = new MeshResolver({
      provider,
      thresholds: { min_observations: 10, min_quality_score: 0.7 },
    });

    const result = await resolver.resolveAsync({
      delegation_chain: ['modelA', 'modelB'],
    });

    // Below min_observations — fail-closed
    expect(result.capabilities).toEqual([]);
  });

  it('should NOT unlock ensemble capabilities when below quality threshold', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelA', 'modelB'], quality_score: 0.5, observation_count: 20 },
    ]);

    const resolver = new MeshResolver({
      provider,
      thresholds: { min_observations: 10, min_quality_score: 0.7 },
    });

    const result = await resolver.resolveAsync({
      delegation_chain: ['modelA', 'modelB'],
    });

    // Below min_quality_score — fail-closed
    expect(result.capabilities).toEqual([]);
  });

  it('should require ALL pairs in chain to meet threshold', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelA', 'modelB'], quality_score: 0.85, observation_count: 20 },
      // modelB-modelC has no history
    ]);

    const resolver = new MeshResolver({
      provider,
      thresholds: { min_observations: 10, min_quality_score: 0.7 },
    });

    const result = await resolver.resolveAsync({
      delegation_chain: ['modelA', 'modelB', 'modelC'],
    });

    // Second pair (B-C) has no history — fail-closed
    expect(result.capabilities).toEqual([]);
  });

  it('should fail-closed with synchronous resolve()', () => {
    const provider = new InMemoryInteractionHistoryProvider([]);
    const resolver = new MeshResolver({ provider });

    const result = resolver.resolve({});
    expect(result.capabilities).toEqual([]);
  });

  it('should reject invalid thresholds (negative min_observations)', () => {
    const provider = new InMemoryInteractionHistoryProvider([]);
    expect(() => new MeshResolver({
      provider,
      thresholds: { min_observations: -1, min_quality_score: 0.7 },
    })).toThrow('min_observations must be a positive integer >= 1');
  });

  it('should reject invalid thresholds (quality score > 1)', () => {
    const provider = new InMemoryInteractionHistoryProvider([]);
    expect(() => new MeshResolver({
      provider,
      thresholds: { min_observations: 10, min_quality_score: 1.5 },
    })).toThrow('min_quality_score must be a finite number between 0 and 1');
  });

  it('should skip records with non-positive observation counts', async () => {
    const provider = new InMemoryInteractionHistoryProvider([
      { model_pair: ['modelA', 'modelB'], quality_score: 0.9, observation_count: 0 },
      { model_pair: ['modelA', 'modelB'], quality_score: 0.85, observation_count: 15 },
    ]);

    const resolver = new MeshResolver({
      provider,
      thresholds: { min_observations: 10, min_quality_score: 0.7 },
    });

    const result = await resolver.resolveAsync({
      delegation_chain: ['modelA', 'modelB'],
    });

    // Only the record with count=15 counts — should unlock
    expect(result.capabilities).toContain('can_use_ensemble');
  });
});
