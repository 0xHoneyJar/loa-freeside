/**
 * Drizzle ORM Configuration
 *
 * Sprint 38: Drizzle Schema Design
 *
 * Configuration for database migrations and schema generation.
 * Uses PostgreSQL with Row-Level Security support.
 *
 * @module drizzle.config
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/packages/adapters/storage/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://arrakis:arrakis@localhost:5432/arrakis',
  },
  verbose: true,
  strict: true,
});
