import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("CR-201A migration rollback safety", () => {
  it("007_shared_preparation_work.sql is expand-only", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(dir, "../../migrations/007_shared_preparation_work.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS shared_preparation_work/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS preparation_work_items/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS report_work_links/);
    expect(sql).toMatch(/shared_preparation_work_key_active_idx/);
    expect(sql).toMatch(/capability IN \('collection_identity\.v1', 'ownership_index\.v1'\)/);
    expect(sql).toMatch(/privacy_class = 'public_chain'/);
  });
});
