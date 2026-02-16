/**
 * ScoreImportService — Bulk Score Snapshot Import
 *
 * Admin-only service for importing score snapshots from external
 * scoring systems. Supports bulk upsert with validation.
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Task 11.5
 *
 * @module packages/adapters/billing/ScoreImportService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ScoreEntry {
  walletAddress: string;
  chainId?: number;
  score: number;
  period: string;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  updated: number;
  errors: string[];
}

// =============================================================================
// Constants
// =============================================================================

/** Valid period format: YYYY-MM */
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Basic Ethereum address regex */
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// =============================================================================
// ScoreImportService
// =============================================================================

export class ScoreImportService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Bulk import score snapshots.
   * Upserts via INSERT ... ON CONFLICT ... DO UPDATE.
   */
  importScores(entries: ScoreEntry[]): ImportResult {
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;

    // Validate all entries first
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (!ADDRESS_REGEX.test(entry.walletAddress)) {
        errors.push(`Entry ${i}: invalid wallet address '${entry.walletAddress}'`);
      }

      if (typeof entry.score !== 'number' || entry.score < 0 || !Number.isFinite(entry.score)) {
        errors.push(`Entry ${i}: score must be a non-negative number`);
      }

      if (!PERIOD_REGEX.test(entry.period)) {
        errors.push(`Entry ${i}: invalid period format '${entry.period}' (expected YYYY-MM)`);
      }
    }

    if (errors.length > 0) {
      return { success: false, imported: 0, updated: 0, errors };
    }

    // Upsert in a single transaction
    const upsertStmt = this.db.prepare(`
      INSERT INTO score_snapshots (id, wallet_address, chain_id, score, snapshot_period)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(wallet_address, chain_id, snapshot_period) DO UPDATE
      SET score = excluded.score
    `);

    const checkStmt = this.db.prepare(`
      SELECT id FROM score_snapshots
      WHERE wallet_address = ? AND chain_id = ? AND snapshot_period = ?
    `);

    this.db.transaction(() => {
      for (const entry of entries) {
        const normalizedAddress = entry.walletAddress.toLowerCase();
        const chainId = entry.chainId ?? 1;

        const existing = checkStmt.get(normalizedAddress, chainId, entry.period);

        upsertStmt.run(
          randomUUID(),
          normalizedAddress,
          chainId,
          Math.floor(entry.score),
          entry.period,
        );

        if (existing) {
          updated++;
        } else {
          imported++;
        }
      }
    })();

    logger.info({
      event: 'score.import',
      imported,
      updated,
      total: entries.length,
    }, `Score import: ${imported} new, ${updated} updated`);

    return { success: true, imported, updated, errors: [] };
  }

  /**
   * Get scores for a period.
   */
  getScoresForPeriod(period: string): Array<{ walletAddress: string; chainId: number; score: number }> {
    return this.db.prepare(`
      SELECT wallet_address as walletAddress, chain_id as chainId, score
      FROM score_snapshots
      WHERE snapshot_period = ?
      ORDER BY score DESC
    `).all(period) as Array<{ walletAddress: string; chainId: number; score: number }>;
  }
}
