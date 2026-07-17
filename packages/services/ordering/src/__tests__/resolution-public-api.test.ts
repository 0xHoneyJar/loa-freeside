import { describe, expect, it } from "vitest";
import * as orderingApi from "../index.js";

describe("Ordering resolution public API", () => {
  it("exports the persistence port without publishing the test-only in-memory adapter", () => {
    expect(orderingApi).not.toHaveProperty("InMemoryResolutionStore");
  });
});
