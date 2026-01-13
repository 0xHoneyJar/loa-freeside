/**
 * SQL Safety Utilities (Sprint 72)
 *
 * Column whitelist pattern to prevent SQL injection attacks
 * when using dynamic column names in queries.
 *
 * CRIT-3: Dynamic column names create injection vectors.
 * Solution: Strict whitelist validation for all dynamic SQL elements.
 */

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when an invalid column name is provided
 */
export class SqlInjectionAttemptError extends Error {
  constructor(
    public readonly tableName: string,
    public readonly invalidValue: string,
    public readonly allowedValues: readonly string[]
  ) {
    super(
      `SQL injection attempt blocked: "${invalidValue}" is not a valid column for table "${tableName}". ` +
        `Allowed values: [${allowedValues.join(', ')}]`
    );
    this.name = 'SqlInjectionAttemptError';
  }
}

// =============================================================================
// Column Whitelists
// =============================================================================

/**
 * Badge settings table - allowed column names
 */
export const BADGE_SETTINGS_COLUMNS = {
  display_on_discord: 'display_on_discord',
  display_on_telegram: 'display_on_telegram',
  badge_style: 'badge_style',
  member_id: 'member_id',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const;

export type BadgeSettingsColumn = keyof typeof BADGE_SETTINGS_COLUMNS;

/**
 * Subscriptions table - allowed column names for updates
 */
export const SUBSCRIPTION_UPDATE_COLUMNS = {
  payment_customer_id: 'payment_customer_id',
  payment_subscription_id: 'payment_subscription_id',
  payment_provider: 'payment_provider',
  tier: 'tier',
  status: 'status',
  grace_until: 'grace_until',
  current_period_start: 'current_period_start',
  current_period_end: 'current_period_end',
  updated_at: 'updated_at',
} as const;

export type SubscriptionUpdateColumn = keyof typeof SUBSCRIPTION_UPDATE_COLUMNS;

/**
 * Platform display column mapping
 */
export const PLATFORM_DISPLAY_COLUMNS = {
  discord: 'display_on_discord',
  telegram: 'display_on_telegram',
} as const;

export type Platform = keyof typeof PLATFORM_DISPLAY_COLUMNS;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Get validated column name for platform display queries
 *
 * @param platform - The platform ('discord' | 'telegram')
 * @returns The safe column name
 * @throws SqlInjectionAttemptError if platform is invalid
 */
export function getPlatformDisplayColumn(platform: string): string {
  const column = PLATFORM_DISPLAY_COLUMNS[platform as Platform];

  if (!column) {
    throw new SqlInjectionAttemptError(
      'badge_settings',
      platform,
      Object.keys(PLATFORM_DISPLAY_COLUMNS)
    );
  }

  return column;
}

/**
 * Validate badge settings column name
 *
 * @param column - Column name to validate
 * @returns The validated column name
 * @throws SqlInjectionAttemptError if column is invalid
 */
export function validateBadgeSettingsColumn(column: string): BadgeSettingsColumn {
  if (!(column in BADGE_SETTINGS_COLUMNS)) {
    throw new SqlInjectionAttemptError(
      'badge_settings',
      column,
      Object.keys(BADGE_SETTINGS_COLUMNS)
    );
  }

  return column as BadgeSettingsColumn;
}

/**
 * Validate subscription update column name
 *
 * @param column - Column name to validate
 * @returns The validated column name
 * @throws SqlInjectionAttemptError if column is invalid
 */
export function validateSubscriptionColumn(column: string): SubscriptionUpdateColumn {
  if (!(column in SUBSCRIPTION_UPDATE_COLUMNS)) {
    throw new SqlInjectionAttemptError(
      'subscriptions',
      column,
      Object.keys(SUBSCRIPTION_UPDATE_COLUMNS)
    );
  }

  return column as SubscriptionUpdateColumn;
}

// =============================================================================
// Safe SET Clause Builders
// =============================================================================

/**
 * Build a safe SET clause for badge_settings updates
 *
 * Only includes columns that are in the whitelist.
 * Automatically adds updated_at.
 *
 * @param updates - Map of column names to values
 * @returns Object with { clause: string, values: array }
 */
export function buildBadgeSettingsSetClause(
  updates: Partial<Record<BadgeSettingsColumn, string | number>>
): { clause: string; values: (string | number)[] } {
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: (string | number)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    // Validate each column
    const validColumn = validateBadgeSettingsColumn(key);
    if (validColumn !== 'updated_at' && validColumn !== 'created_at') {
      sets.push(`${validColumn} = ?`);
      values.push(value as string | number);
    }
  }

  return {
    clause: sets.join(', '),
    values,
  };
}

/**
 * Build a safe SET clause for subscriptions updates
 *
 * Only includes columns that are in the whitelist.
 * Automatically adds updated_at.
 *
 * @param updates - Map of column names to values
 * @returns Object with { clause: string, values: array }
 */
export function buildSubscriptionSetClause(
  updates: Partial<Record<SubscriptionUpdateColumn, string | number | null>>
): { clause: string; values: (string | number | null)[] } {
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    // Validate each column
    const validColumn = validateSubscriptionColumn(key);
    if (validColumn !== 'updated_at') {
      sets.push(`${validColumn} = ?`);
      values.push(value as string | number | null);
    }
  }

  return {
    clause: sets.join(', '),
    values,
  };
}
