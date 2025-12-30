/**
 * Coexistence Adapters - Shadow Mode & Incumbent Detection
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 *
 * This module provides adapters for coexisting with incumbent token-gating
 * solutions (Collab.Land, Matrica, Guild.xyz) during migration.
 *
 * Components:
 * - CoexistenceStorage: PostgreSQL storage for incumbent configs and migration states
 * - IncumbentDetector: Detects incumbent bots using multiple methods
 *
 * @module packages/adapters/coexistence
 */

// Storage adapter
export {
  CoexistenceStorage,
  createCoexistenceStorage,
} from './CoexistenceStorage.js';

// Incumbent detector
export {
  IncumbentDetector,
  createIncumbentDetector,
  KNOWN_INCUMBENTS,
  CONFIDENCE,
  type DetectionResult,
  type DetectionOptions,
} from './IncumbentDetector.js';
