import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("CR-201C migration rollback safety", () => {
  it("008_admission_capacity.sql is expand-only with fan-in-safe constraints", () => {
    const sql = readFileSync(join(dir, "../../migrations/008_admission_capacity.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admission_capacity_pools/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admission_capacity_reservations/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS order_admission_idempotency/);
    expect(sql).toMatch(/admission_rate/);
    expect(sql).toMatch(/queued_work/);
    expect(sql).toMatch(/active_execution/);
    // Fan-in markers: quantity >= 0; held rows require quantity > 0.
    expect(sql).toMatch(/admission_capacity_reservations_qty_nonneg CHECK \(quantity >= 0\)/);
    expect(sql).toMatch(/admission_capacity_reservations_held_qty_check/);
    expect(sql).not.toMatch(/reservations_qty_positive/);
    // Public scope cannot duplicate via NULL community_ref.
    expect(sql).toMatch(/community_ref\s+TEXT NOT NULL DEFAULT ''/);
    expect(sql).toMatch(/admission_capacity_pools_scope_unique/);
    expect(sql).toMatch(/admission_capacity_reservations_work_held_unique_idx/);
  });
});
