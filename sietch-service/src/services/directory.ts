/**
 * Directory Service
 *
 * Provides member directory browsing with pagination and filtering.
 * All returned data is privacy-filtered (no wallet or Discord correlation).
 *
 * Features:
 * - Paginated member list
 * - Filter by tier (naib, fedaykin)
 * - Filter by badge
 * - Filter by tenure category
 * - Sort by nym, tenure, or badge count
 */

import { logger } from '../utils/logger.js';
import {
  getMemberDirectory,
  searchMembersByNym,
  getMemberCount,
  getMemberCountByTier,
  getAllBadges,
} from '../db/queries.js';
import type {
  DirectoryFilters,
  DirectoryResult,
  PublicProfile,
  Badge,
} from '../types/index.js';

/**
 * Default page size for directory listing
 */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Maximum page size to prevent excessive queries
 */
const MAX_PAGE_SIZE = 50;

/**
 * Directory Service
 *
 * Handles member directory operations with privacy protection.
 */
class DirectoryService {
  /**
   * Get paginated member directory with optional filters
   */
  getDirectory(filters: DirectoryFilters = {}): DirectoryResult {
    // Validate and normalize pagination
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE)
    );

    // Normalize sort direction
    const sortDir = filters.sortDir === 'desc' ? 'desc' : 'asc';

    // Build normalized filters
    const normalizedFilters: DirectoryFilters = {
      ...filters,
      page,
      pageSize,
      sortDir,
    };

    logger.debug({ filters: normalizedFilters }, 'Fetching directory');

    const result = getMemberDirectory(normalizedFilters);

    return result;
  }

  /**
   * Search members by nym (partial match, case-insensitive)
   */
  searchByNym(query: string, limit: number = 10): PublicProfile[] {
    // Validate query
    if (!query || query.trim().length < 1) {
      return [];
    }

    // Limit max results
    const normalizedLimit = Math.min(25, Math.max(1, limit));

    return searchMembersByNym(query.trim(), normalizedLimit);
  }

  /**
   * Get member count statistics
   */
  getStats(): {
    total: number;
    naib: number;
    fedaykin: number;
  } {
    const total = getMemberCount();
    const byTier = getMemberCountByTier();

    return {
      total,
      naib: byTier.naib,
      fedaykin: byTier.fedaykin,
    };
  }

  /**
   * Get available badges for filtering
   */
  getAvailableBadges(): Badge[] {
    return getAllBadges();
  }

  /**
   * Validate filter parameters
   * Returns error message if invalid, null if valid
   */
  validateFilters(filters: DirectoryFilters): string | null {
    // Validate tier
    if (filters.tier && !['naib', 'fedaykin'].includes(filters.tier)) {
      return 'Invalid tier filter. Must be "naib" or "fedaykin"';
    }

    // Validate tenure category
    if (
      filters.tenureCategory &&
      !['og', 'veteran', 'elder', 'member'].includes(filters.tenureCategory)
    ) {
      return 'Invalid tenure category. Must be "og", "veteran", "elder", or "member"';
    }

    // Validate sort field
    if (
      filters.sortBy &&
      !['nym', 'tenure', 'badgeCount'].includes(filters.sortBy)
    ) {
      return 'Invalid sort field. Must be "nym", "tenure", or "badgeCount"';
    }

    // Validate sort direction
    if (filters.sortDir && !['asc', 'desc'].includes(filters.sortDir)) {
      return 'Invalid sort direction. Must be "asc" or "desc"';
    }

    // Validate pagination
    if (filters.page !== undefined && (filters.page < 1 || !Number.isInteger(filters.page))) {
      return 'Invalid page number. Must be a positive integer';
    }

    if (
      filters.pageSize !== undefined &&
      (filters.pageSize < 1 || filters.pageSize > MAX_PAGE_SIZE || !Number.isInteger(filters.pageSize))
    ) {
      return `Invalid page size. Must be between 1 and ${MAX_PAGE_SIZE}`;
    }

    return null;
  }
}

/**
 * Singleton directory service instance
 */
export const directoryService = new DirectoryService();
