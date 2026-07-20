import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("009_public_prep_dispatch_and_kitchen_target.sql", () => {
  it("is expand-only with durable dispatch ledger + kitchen_target", () => {
    const sql = readFileSync(
      join(dir, "../../migrations/009_public_prep_dispatch_and_kitchen_target.sql"),
      "utf8",
    );
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS kitchen_target/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public_prep_dispatch/);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});
