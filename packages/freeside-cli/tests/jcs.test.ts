/**
 * Unit tests · freeside-cli JCS recipe (sprint-400 T3, R-2 cross-impl identity)
 *
 * The recipe in src/lib/jcs.ts is a VERBATIM copy of packages/events/src/jcs.ts
 * (G-4: copied not imported). These frozen values were computed by running the
 * events recipe on a known input — if they ever drift, this copy has diverged
 * from events and sealed-hash recomputes would mismatch cluster-wide (R-2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jcsCanonicalize, sha256Hex } from "../src/lib/jcs.js";

// FROZEN from packages/events/src/jcs.ts output for KNOWN (R-2):
const KNOWN = { b: 1, a: [3, 2], nested: { z: true, y: null }, s: "hello" };
const FROZEN_CANON = '{"a":[3,2],"b":1,"nested":{"y":null,"z":true},"s":"hello"}';
const FROZEN_HASH = "72649b4477ff56c75a07ae87270676f1728598b8957541c28e68a0dea78493c4";

test("jcsCanonicalize matches frozen events/jcs.ts output (R-2 cross-impl identity)", () => {
  assert.equal(jcsCanonicalize(KNOWN), FROZEN_CANON);
});

test("sha256Hex(jcsCanonicalize(...)) matches the frozen events hash (R-2)", () => {
  assert.equal(sha256Hex(jcsCanonicalize(KNOWN)), FROZEN_HASH);
});

test("sha256Hex returns 64-char lowercase hex (sealed_schemas.hash shape)", () => {
  assert.match(sha256Hex("abc"), /^[a-f0-9]{64}$/);
});

test("jcsCanonicalize throws on non-JSON-representable input", () => {
  assert.throws(() => jcsCanonicalize(() => 1));
});
