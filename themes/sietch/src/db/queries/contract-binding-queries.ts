/**
 * Contract Binding Query Module
 *
 * Database operations for contract bindings.
 * Sprint 4: Web3 Layer - Contract Binding API
 *
 * @module db/queries/contract-binding-queries
 * @see grimoires/loa/sdd.md §5. Database Schema
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../connection.js';
import { logger } from '../../utils/logger.js';
import type {
  ContractBinding,
  ContractBindingRow,
  ContractType,
  ContractAbiFragment,
} from '../../types/theme-web3.types.js';

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default cache TTL for contract bindings (5 minutes)
 */
const DEFAULT_CACHE_TTL = 300;

// =============================================================================
// Row to Model Converters
// =============================================================================

/**
 * Convert contract binding row to ContractBinding model
 */
function rowToContractBinding(row: ContractBindingRow): ContractBinding {
  const abi = JSON.parse(row.abi) as ContractAbiFragment[];
  return {
    id: row.id,
    name: row.name,
    chainId: row.chain_id,
    address: row.address as `0x${string}`,
    abi,
    type: row.type,
    verified: row.verified === 1,
    cacheTtl: row.cache_ttl,
  };
}

// =============================================================================
// Create Operations
// =============================================================================

/**
 * Input for creating a contract binding
 */
export interface CreateContractBindingInput {
  themeId: string;
  name: string;
  chainId: number;
  address: string;
  type?: ContractType;
  abi?: ContractAbiFragment[];
  verified?: boolean;
  cacheTtl?: number;
}

/**
 * Create a new contract binding
 *
 * @param input - Binding creation input
 * @returns Created contract binding
 * @throws Error if binding already exists for this theme/chain/address combo
 */
export function createContractBinding(input: CreateContractBindingInput): ContractBinding {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  const binding: ContractBinding = {
    id,
    name: input.name,
    chainId: input.chainId,
    address: input.address as `0x${string}`,
    type: input.type ?? 'custom',
    abi: input.abi ?? [],
    verified: input.verified ?? false,
    cacheTtl: input.cacheTtl ?? DEFAULT_CACHE_TTL,
  };

  try {
    const stmt = db.prepare(`
      INSERT INTO contract_bindings (
        id, theme_id, name, chain_id, address, type, abi, verified, cache_ttl, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.themeId,
      binding.name,
      binding.chainId,
      binding.address.toLowerCase(),
      binding.type,
      JSON.stringify(binding.abi),
      binding.verified ? 1 : 0,
      binding.cacheTtl,
      now,
      now
    );

    logger.debug(
      { id, themeId: input.themeId, chainId: binding.chainId, address: binding.address },
      'Contract binding created'
    );

    return binding;
  } catch (error) {
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      throw new Error(
        `Contract binding already exists for theme ${input.themeId} on chain ${input.chainId} at address ${input.address}`
      );
    }
    throw error;
  }
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get a contract binding by ID
 *
 * @param id - Binding ID
 * @returns Contract binding or null if not found
 */
export function getContractBinding(id: string): ContractBinding | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM contract_bindings WHERE id = ?
  `);

  const row = stmt.get(id) as ContractBindingRow | undefined;
  if (!row) {
    return null;
  }

  return rowToContractBinding(row);
}

/**
 * Get a contract binding by theme, chain, and address
 *
 * @param themeId - Theme ID
 * @param chainId - Chain ID
 * @param address - Contract address
 * @returns Contract binding or null if not found
 */
export function getContractBindingByAddress(
  themeId: string,
  chainId: number,
  address: string
): ContractBinding | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM contract_bindings
    WHERE theme_id = ? AND chain_id = ? AND LOWER(address) = LOWER(?)
  `);

  const row = stmt.get(themeId, chainId, address) as ContractBindingRow | undefined;
  if (!row) {
    return null;
  }

  return rowToContractBinding(row);
}

/**
 * Get all contract bindings for a theme
 *
 * @param themeId - Theme ID
 * @returns List of contract bindings
 */
export function getContractBindings(themeId: string): ContractBinding[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM contract_bindings
    WHERE theme_id = ?
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(themeId) as ContractBindingRow[];
  return rows.map(rowToContractBinding);
}

/**
 * Get contract bindings by chain
 *
 * @param themeId - Theme ID
 * @param chainId - Chain ID
 * @returns List of contract bindings for the chain
 */
export function getContractBindingsByChain(themeId: string, chainId: number): ContractBinding[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM contract_bindings
    WHERE theme_id = ? AND chain_id = ?
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(themeId, chainId) as ContractBindingRow[];
  return rows.map(rowToContractBinding);
}

/**
 * Get contract bindings by type
 *
 * @param themeId - Theme ID
 * @param type - Contract type
 * @returns List of contract bindings of the type
 */
export function getContractBindingsByType(themeId: string, type: ContractType): ContractBinding[] {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT * FROM contract_bindings
    WHERE theme_id = ? AND type = ?
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(themeId, type) as ContractBindingRow[];
  return rows.map(rowToContractBinding);
}

// =============================================================================
// Update Operations
// =============================================================================

/**
 * Input for updating a contract binding
 */
export interface UpdateContractBindingInput {
  name?: string;
  abi?: ContractAbiFragment[];
  type?: ContractType;
  verified?: boolean;
  cacheTtl?: number;
}

/**
 * Update a contract binding
 *
 * @param id - Binding ID
 * @param input - Update input
 * @returns Updated contract binding or null if not found
 */
export function updateContractBinding(
  id: string,
  input: UpdateContractBindingInput
): ContractBinding | null {
  const db = getDatabase();

  // Get existing binding
  const existing = getContractBinding(id);
  if (!existing) {
    return null;
  }

  // Build update fields
  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.abi !== undefined) {
    updates.push('abi = ?');
    values.push(JSON.stringify(input.abi));
  }

  if (input.type !== undefined) {
    updates.push('type = ?');
    values.push(input.type);
  }

  if (input.verified !== undefined) {
    updates.push('verified = ?');
    values.push(input.verified ? 1 : 0);
  }

  if (input.cacheTtl !== undefined) {
    updates.push('cache_ttl = ?');
    values.push(input.cacheTtl);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = datetime(\'now\')');
  values.push(id);

  const stmt = db.prepare(`
    UPDATE contract_bindings
    SET ${updates.join(', ')}
    WHERE id = ?
  `);

  stmt.run(...values);

  logger.debug({ id, updates: Object.keys(input) }, 'Contract binding updated');

  return getContractBinding(id);
}

// =============================================================================
// Delete Operations
// =============================================================================

/**
 * Delete a contract binding
 *
 * @param id - Binding ID
 * @returns true if deleted, false if not found
 */
export function deleteContractBinding(id: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    DELETE FROM contract_bindings WHERE id = ?
  `);

  const result = stmt.run(id);

  if (result.changes > 0) {
    logger.debug({ id }, 'Contract binding deleted');
    return true;
  }

  return false;
}

/**
 * Delete all contract bindings for a theme
 *
 * @param themeId - Theme ID
 * @returns Number of bindings deleted
 */
export function deleteContractBindingsForTheme(themeId: string): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    DELETE FROM contract_bindings WHERE theme_id = ?
  `);

  const result = stmt.run(themeId);

  logger.debug({ themeId, deleted: result.changes }, 'Contract bindings deleted for theme');

  return result.changes;
}

// =============================================================================
// Existence Checks
// =============================================================================

/**
 * Check if a contract binding exists by ID
 */
export function contractBindingExists(id: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT 1 FROM contract_bindings WHERE id = ? LIMIT 1
  `);

  return stmt.get(id) !== undefined;
}

/**
 * Check if a contract binding exists for a theme/chain/address combo
 */
export function contractBindingExistsForAddress(
  themeId: string,
  chainId: number,
  address: string
): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT 1 FROM contract_bindings
    WHERE theme_id = ? AND chain_id = ? AND LOWER(address) = LOWER(?)
    LIMIT 1
  `);

  return stmt.get(themeId, chainId, address) !== undefined;
}

// =============================================================================
// Count Operations
// =============================================================================

/**
 * Count contract bindings for a theme
 */
export function countContractBindings(themeId: string): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM contract_bindings WHERE theme_id = ?
  `);

  const result = stmt.get(themeId) as { count: number };
  return result.count;
}

/**
 * Count contract bindings by type for a theme
 */
export function countContractBindingsByType(themeId: string): Record<ContractType, number> {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT type, COUNT(*) as count FROM contract_bindings
    WHERE theme_id = ?
    GROUP BY type
  `);

  const rows = stmt.all(themeId) as Array<{ type: ContractType; count: number }>;

  const counts: Record<ContractType, number> = {
    erc20: 0,
    erc721: 0,
    erc1155: 0,
    custom: 0,
  };

  for (const row of rows) {
    counts[row.type] = row.count;
  }

  return counts;
}
