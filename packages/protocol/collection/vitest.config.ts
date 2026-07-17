import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Isolated pack epochs run a full TypeScript build; keep headroom.
    testTimeout: 120_000,
  },
});
