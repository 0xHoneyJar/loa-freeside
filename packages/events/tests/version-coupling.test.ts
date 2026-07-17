import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION } from "../src/envelope.js";

// Compile-time (IMP-008): SCHEMA_VERSION must be the LITERAL "acvp-l1-v2", not a
// widened `string`. A literal-typed assignment fails to compile if the const is
// ever widened — which is what makes the cross-package equality check (against
// beacon-schema's ACVP_L1_SCHEMA_VERSION) meaningful rather than vacuous.
const _literal: "acvp-l1-v2" = SCHEMA_VERSION;
void _literal;

describe("version coupling (T1.8, OQ-4 / IMP-008 / IMP-010)", () => {
  it("events SCHEMA_VERSION is the pinned acvp-l1-v2 literal", () => {
    assert.equal(SCHEMA_VERSION, "acvp-l1-v2");
  });

  // The CROSS-package assertion (events.SCHEMA_VERSION === beacon-schema's
  // ACVP_L1_SCHEMA_VERSION) lives on the beacon-schema side: beacon-schema
  // validates events' output, so the dependency runs beacon-schema -> events.
  // Adding it here would invert that (events -> beacon-schema). Both constants
  // are already `as const` ("acvp-l1-v2"); the beacon-schema test is the place
  // that imports both and asserts string equality. Tracked for the validator side.
});
