/**
 * Traced Database Wrapper - Database Query Tracing
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides a wrapper around BetterSqlite3 database that automatically
 * adds trace context as SQL comments for query correlation.
 *
 * Features:
 * - Automatic trace ID injection as SQL comments
 * - Span tracking for database operations
 * - Query timing metrics
 * - No changes to existing query code required
 *
 * @module packages/infrastructure/tracing/TracedDatabase
 */

import type Database from 'better-sqlite3';
import {
  getCurrentTrace,
  createSpan,
  getTraceSqlComment,
} from './TraceContext.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Statement execution statistics
 */
export interface QueryStats {
  /** Query SQL (with trace comment) */
  sql: string;
  /** Execution duration (ms) */
  duration: number;
  /** Trace ID */
  traceId?: string;
  /** Span ID */
  spanId?: string;
  /** Whether query succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Query stats callback
 */
export type QueryStatsCallback = (stats: QueryStats) => void;

/**
 * Options for traced database
 */
export interface TracedDatabaseOptions {
  /** Callback for query statistics */
  onQueryStats?: QueryStatsCallback;
  /** Include trace comments in queries (default: true) */
  includeTraceComments?: boolean;
  /** Log slow queries above this threshold (ms) */
  slowQueryThreshold?: number;
}

// =============================================================================
// Traced Statement Wrapper
// =============================================================================

/**
 * Wrapper around a prepared statement that adds tracing
 */
class TracedStatement<BindParameters extends unknown[], Result> {
  private readonly originalStatement: Database.Statement<BindParameters, Result>;
  private readonly sql: string;
  private readonly options: Required<TracedDatabaseOptions>;

  constructor(
    statement: Database.Statement<BindParameters, Result>,
    sql: string,
    options: Required<TracedDatabaseOptions>
  ) {
    this.originalStatement = statement;
    this.sql = sql;
    this.options = options;
  }

  /**
   * Execute the statement and return the result info
   */
  run(...params: BindParameters): Database.RunResult {
    return this.executeWithTracing('run', () =>
      this.originalStatement.run(...params)
    );
  }

  /**
   * Get a single row
   */
  get(...params: BindParameters): Result | undefined {
    return this.executeWithTracing('get', () =>
      this.originalStatement.get(...params)
    );
  }

  /**
   * Get all rows
   */
  all(...params: BindParameters): Result[] {
    return this.executeWithTracing('all', () =>
      this.originalStatement.all(...params)
    );
  }

  /**
   * Iterate over rows
   */
  iterate(...params: BindParameters): IterableIterator<Result> {
    // Note: For iterate, we can't easily wrap the timing
    // since it's a generator. We'll just track the initial call.
    return this.executeWithTracing('iterate', () =>
      this.originalStatement.iterate(...params)
    );
  }

  /**
   * Bind parameters and return new statement
   */
  bind(...params: BindParameters): this {
    this.originalStatement.bind(...params);
    return this;
  }

  /**
   * Check if statement is read-only
   */
  get readonly(): boolean {
    return this.originalStatement.readonly;
  }

  /**
   * Get column names for SELECT statements
   */
  columns(): Database.ColumnDefinition[] {
    return this.originalStatement.columns();
  }

  /**
   * Get the SQL source
   */
  get source(): string {
    return this.originalStatement.source;
  }

  /**
   * Execute with tracing wrapper
   */
  private executeWithTracing<T>(operation: string, fn: () => T): T {
    const trace = getCurrentTrace();
    const { span, endSpan } = createSpan({
      operationName: `db.${operation}`,
      attributes: {
        'db.system': 'sqlite',
        'db.operation': operation,
      },
    });

    const startTime = performance.now();
    let success = true;
    let errorMessage: string | undefined;

    try {
      const result = fn();
      return result;
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      endSpan(success ? 'ok' : 'error');

      // Report stats
      if (this.options.onQueryStats) {
        this.options.onQueryStats({
          sql: this.sql,
          duration,
          traceId: trace?.traceId,
          spanId: span.spanId,
          success,
          error: errorMessage,
        });
      }

      // Log slow queries
      if (
        this.options.slowQueryThreshold > 0 &&
        duration > this.options.slowQueryThreshold
      ) {
        console.warn(
          `[SLOW QUERY] ${duration.toFixed(2)}ms - ${this.sql.slice(0, 100)}...`
        );
      }
    }
  }
}

// =============================================================================
// Traced Database Wrapper
// =============================================================================

/**
 * Wrapper around better-sqlite3 Database that adds tracing
 */
export class TracedDatabase {
  private readonly db: Database.Database;
  private readonly options: Required<TracedDatabaseOptions>;

  constructor(db: Database.Database, options: TracedDatabaseOptions = {}) {
    this.db = db;
    this.options = {
      onQueryStats: options.onQueryStats ?? (() => {}),
      includeTraceComments: options.includeTraceComments ?? true,
      slowQueryThreshold: options.slowQueryThreshold ?? 0,
    };
  }

  /**
   * Prepare a statement with trace context
   */
  prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    sql: string
  ): TracedStatement<BindParameters, Result> {
    // Add trace comment to SQL if enabled and in trace context
    let tracedSql = sql;
    if (this.options.includeTraceComments) {
      const traceComment = getTraceSqlComment();
      if (traceComment) {
        // Prepend trace comment to SQL
        tracedSql = `${traceComment} ${sql}`;
      }
    }

    const statement = this.db.prepare<BindParameters, Result>(tracedSql);
    return new TracedStatement(statement, tracedSql, this.options);
  }

  /**
   * Execute raw SQL (for DDL, etc.)
   */
  exec(sql: string): this {
    const { span, endSpan } = createSpan({
      operationName: 'db.exec',
      attributes: {
        'db.system': 'sqlite',
        'db.operation': 'exec',
      },
    });

    try {
      this.db.exec(sql);
      endSpan('ok');
    } catch (error) {
      endSpan('error');
      throw error;
    }

    return this;
  }

  /**
   * Create a transaction
   */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    const originalTransaction = this.db.transaction(fn);

    return (...args: unknown[]) => {
      const { endSpan } = createSpan({
        operationName: 'db.transaction',
        attributes: {
          'db.system': 'sqlite',
          'db.operation': 'transaction',
        },
      });

      try {
        const result = originalTransaction(...args);
        endSpan('ok');
        return result;
      } catch (error) {
        endSpan('error');
        throw error;
      }
    };
  }

  /**
   * Check if database is open
   */
  get open(): boolean {
    return this.db.open;
  }

  /**
   * Check if database is in memory
   */
  get inTransaction(): boolean {
    return this.db.inTransaction;
  }

  /**
   * Get the underlying database (for advanced operations)
   */
  get underlying(): Database.Database {
    return this.db;
  }

  /**
   * Close the database
   */
  close(): void {
    this.db.close();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a traced database wrapper
 *
 * @param db - BetterSqlite3 database instance
 * @param options - Tracing options
 * @returns Traced database wrapper
 *
 * @example
 * ```typescript
 * import Database from 'better-sqlite3';
 * import { createTracedDatabase } from '../packages/infrastructure/tracing';
 *
 * const db = new Database('mydb.sqlite');
 * const tracedDb = createTracedDatabase(db, {
 *   slowQueryThreshold: 100,
 *   onQueryStats: (stats) => {
 *     metrics.recordQueryDuration(stats.duration);
 *   }
 * });
 *
 * // Use like normal
 * const stmt = tracedDb.prepare('SELECT * FROM users WHERE id = ?');
 * const user = stmt.get(userId);
 * ```
 */
export function createTracedDatabase(
  db: Database.Database,
  options?: TracedDatabaseOptions
): TracedDatabase {
  return new TracedDatabase(db, options);
}
