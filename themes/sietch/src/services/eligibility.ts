import type { Address } from 'viem';
import { logger } from '../utils/logger.js';
import { getActiveAdminOverrides, logAuditEvent } from '../db/index.js';
import type { EligibilityEntry, EligibilityDiff, AdminOverride } from '../types/index.js';

/**
 * Eligibility Service
 *
 * Core logic for computing eligibility diffs and managing role assignments.
 */
class EligibilityService {
  /**
   * Compute the diff between previous and current eligibility snapshots
   *
   * @param previous - Previous eligibility snapshot
   * @param current - Current eligibility snapshot
   * @returns Diff with added, removed, promoted, and demoted entries
   */
  computeDiff(previous: EligibilityEntry[], current: EligibilityEntry[]): EligibilityDiff {
    const prevMap = new Map<string, EligibilityEntry>();
    const currMap = new Map<string, EligibilityEntry>();

    // Build maps for efficient lookup (normalize addresses to lowercase)
    for (const entry of previous) {
      prevMap.set(entry.address.toLowerCase(), entry);
    }
    for (const entry of current) {
      currMap.set(entry.address.toLowerCase(), entry);
    }

    const diff: EligibilityDiff = {
      added: [],
      removed: [],
      promotedToNaib: [],
      demotedFromNaib: [],
    };

    // Find added entries (in current but not in previous top 69)
    for (const entry of current) {
      const address = entry.address.toLowerCase();
      const prevEntry = prevMap.get(address);

      if (entry.rank !== undefined && entry.rank <= 69) {
        // Entry is in current top 69
        if (!prevEntry || prevEntry.rank === undefined || prevEntry.rank > 69) {
          // Newly added to top 69
          diff.added.push(entry);
          logAuditEvent('member_added', {
            address: entry.address,
            rank: entry.rank,
            role: entry.role,
            bgtHeld: entry.bgtHeld.toString(),
          });
        }
      }

      // Check for Naib promotions (entered top 7)
      if (entry.role === 'naib') {
        if (!prevEntry || prevEntry.role !== 'naib') {
          diff.promotedToNaib.push(entry);
          logAuditEvent('naib_promotion', {
            address: entry.address,
            newRank: entry.rank,
            previousRank: prevEntry?.rank,
            previousRole: prevEntry?.role,
          });
        }
      }
    }

    // Find removed entries (in previous top 69 but not in current top 69)
    for (const entry of previous) {
      const address = entry.address.toLowerCase();
      const currEntry = currMap.get(address);

      if (entry.rank !== undefined && entry.rank <= 69) {
        // Entry was in previous top 69
        if (!currEntry || currEntry.rank === undefined || currEntry.rank > 69) {
          // Removed from top 69
          diff.removed.push({
            ...entry,
            // Include reason hint based on whether they still have BGT
            role: 'none',
          });
          logAuditEvent('member_removed', {
            address: entry.address,
            previousRank: entry.rank,
            previousRole: entry.role,
            reason: currEntry ? 'rank_change' : 'redemption',
          });
        }
      }

      // Check for Naib demotions (left top 7)
      if (entry.role === 'naib') {
        if (!currEntry || currEntry.role !== 'naib') {
          diff.demotedFromNaib.push({
            ...entry,
            role: currEntry?.role ?? 'none',
            rank: currEntry?.rank,
          });
          logAuditEvent('naib_demotion', {
            address: entry.address,
            previousRank: entry.rank,
            newRank: currEntry?.rank,
            newRole: currEntry?.role ?? 'none',
          });
        }
      }
    }

    logger.info(
      {
        added: diff.added.length,
        removed: diff.removed.length,
        promotedToNaib: diff.promotedToNaib.length,
        demotedFromNaib: diff.demotedFromNaib.length,
      },
      'Computed eligibility diff'
    );

    return diff;
  }

  /**
   * Assign roles based on rank
   *
   * @param entries - Eligibility entries sorted by BGT held
   * @returns Entries with assigned roles
   */
  assignRoles(entries: EligibilityEntry[]): EligibilityEntry[] {
    return entries.map((entry, index) => {
      const rank = index + 1;
      let role: 'naib' | 'fedaykin' | 'none' = 'none';

      if (rank <= 7) {
        role = 'naib';
      } else if (rank <= 69) {
        role = 'fedaykin';
      }

      return {
        ...entry,
        rank: rank <= 69 ? rank : undefined,
        role,
      };
    });
  }

  /**
   * Apply admin overrides to eligibility list
   *
   * Admin overrides can:
   * - Add addresses to eligibility (action: 'add')
   * - Remove addresses from eligibility (action: 'remove')
   *
   * @param entries - Original eligibility entries
   * @returns Entries with overrides applied
   */
  async applyAdminOverrides(entries: EligibilityEntry[]): Promise<EligibilityEntry[]> {
    const overrides = getActiveAdminOverrides();

    if (overrides.length === 0) {
      return entries;
    }

    const entriesMap = new Map<string, EligibilityEntry>();
    for (const entry of entries) {
      entriesMap.set(entry.address.toLowerCase(), entry);
    }

    // Process removals first
    const removals = overrides.filter((o) => o.action === 'remove');
    for (const override of removals) {
      const address = override.address.toLowerCase();
      if (entriesMap.has(address)) {
        entriesMap.delete(address);
        logger.info(
          { address: override.address, reason: override.reason },
          'Applied removal override'
        );
      }
    }

    // Process additions
    const additions = overrides.filter((o) => o.action === 'add');
    for (const override of additions) {
      const address = override.address.toLowerCase() as Address;
      if (!entriesMap.has(address)) {
        // Create a synthetic entry for the added address
        // They will be ranked after natural entries based on sort
        const syntheticEntry: EligibilityEntry = {
          address,
          bgtClaimed: 0n,
          bgtBurned: 0n,
          bgtHeld: 0n, // Will be ranked last among eligible
          role: 'none',
        };
        entriesMap.set(address, syntheticEntry);
        logger.info(
          { address: override.address, reason: override.reason },
          'Applied addition override'
        );
      }
    }

    // Convert back to array and re-sort/rank
    const result = Array.from(entriesMap.values());

    // Sort by BGT held descending (synthetic additions go to bottom)
    result.sort((a, b) => {
      if (b.bgtHeld > a.bgtHeld) return 1;
      if (b.bgtHeld < a.bgtHeld) return -1;
      return 0;
    });

    // Re-assign ranks and roles
    return this.assignRoles(result);
  }

  /**
   * Get top N eligible wallets
   */
  getTopN(entries: EligibilityEntry[], n: number): EligibilityEntry[] {
    return entries.filter((e) => e.rank !== undefined && e.rank <= n);
  }

  /**
   * Get top 7 (Naib council)
   */
  getNaibCouncil(entries: EligibilityEntry[]): EligibilityEntry[] {
    return entries.filter((e) => e.role === 'naib');
  }

  /**
   * Get top 69 eligible addresses
   */
  getEligibleAddresses(entries: EligibilityEntry[]): Address[] {
    return entries
      .filter((e) => e.rank !== undefined && e.rank <= 69)
      .map((e) => e.address);
  }

  /**
   * Check if an address is eligible
   */
  isEligible(entries: EligibilityEntry[], address: Address): boolean {
    const normalizedAddress = address.toLowerCase();
    const entry = entries.find((e) => e.address.toLowerCase() === normalizedAddress);
    return entry !== undefined && entry.rank !== undefined && entry.rank <= 69;
  }

  /**
   * Check if an address is Naib (top 7)
   */
  isNaib(entries: EligibilityEntry[], address: Address): boolean {
    const normalizedAddress = address.toLowerCase();
    const entry = entries.find((e) => e.address.toLowerCase() === normalizedAddress);
    return entry !== undefined && entry.role === 'naib';
  }
}

/**
 * Singleton eligibility service instance
 */
export const eligibilityService = new EligibilityService();
