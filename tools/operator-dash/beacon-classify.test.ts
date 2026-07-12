#!/usr/bin/env tsx
// The METER for the beacon classifier (Kuang iter-2). Deterministic, no network —
// it settles whether classifyBeacon catches the storage masked-200 that fooled the
// iter-1 status-only probe. A passing run is the gate: the false positive is closed.
import { classifyBeacon } from "./beacon-classify";

// the actual storage-api catch-all the iter-1 probe captured (GraphQL playground HTML)
const STORAGE_HTML =
  '<!DOCTYPE html>\n<html><head><title>GraphQL playground</title></head>' +
  '<body><div id="graphiql">Loading...</div></body></html>';
const BEACON_V3 = JSON.stringify({
  schema_version: "3",
  slug: "activities-api",
  publisher: "0xHoneyJar",
  is: { one_liner: "x", scope: [] },
  is_not: [],
});
const BEACON_V2 = JSON.stringify({ schema_version: "2", name: "x", capabilities: [] });

const cases: Array<[string, () => boolean]> = [
  ["storage catch-all 200 HTML → masked (THE iter-1 false positive — must NOT be live)",
    () => classifyBeacon(200, STORAGE_HTML) === "masked"],
  ["valid BeaconV3 200 → live", () => classifyBeacon(200, BEACON_V3) === "live"],
  ["valid BeaconV2 200 → live", () => classifyBeacon(200, BEACON_V2) === "live"],
  ["401 → auth-gated (NOT dark — ADR-007 D-8 may intend it)", () => classifyBeacon(401, "") === "auth-gated"],
  ["403 → auth-gated", () => classifyBeacon(403, "") === "auth-gated"],
  ["404 → 404 (no route)", () => classifyBeacon(404, "") === "404"],
  ["503 broken-build → scaffold (route exists, not serving)", () => classifyBeacon(503, '{"error":"beacon_unavailable"}') === "scaffold"],
  ["200 empty body → masked", () => classifyBeacon(200, "") === "masked"],
  ["200 JSON-but-not-a-beacon → masked", () => classifyBeacon(200, '{"hello":"world"}') === "masked"],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  let ok = false;
  try {
    ok = fn();
  } catch {
    ok = false;
  }
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}`);
  ok ? pass++ : fail++;
}
console.log(`\n  ${pass}/${pass + fail} passed — beacon classifier meter`);
process.exit(fail === 0 ? 0 : 1);
