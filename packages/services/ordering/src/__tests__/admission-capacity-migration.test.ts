import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("CR-201C migration rollback safety", () => {
  it("008_admission_capacity.sql is expand-only", () => {
    const sql = readFileSync(join(dir, "../../migrations/008_admission_capacity.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admission_capacity_pools/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admission_capacity_reservations/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS order_admission_idempotency/);
    expect(sql).toMatch(/admission_rate/);
    expect(sql).toMatch(/queued_work/);
    expect(sql).toMatch(/active_execution/);
  });
});
