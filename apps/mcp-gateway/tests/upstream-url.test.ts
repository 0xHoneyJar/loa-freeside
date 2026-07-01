import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpstreamUrl } from "../src/upstream-url.js";
import type { Tenant } from "../src/tenants.js";

// A codex-shaped fixture. The guard's property is tenant-independent — it
// asserts the resolved origin equals THIS tenant's upstream origin — so the
// test is hermetic (no coupling to the live tenant table). buildUpstreamUrl
// reads only `slug` and `upstream`; the cast supplies the rest of the shape.
const codex = {
  slug: "codex",
  upstream: "https://codex-mcp-production.up.railway.app",
} as unknown as Tenant;
const upstreamOrigin = new URL(codex.upstream).origin;
const gw = (path: string) => new URL("https://gateway.test" + path);

test("forwards a normal path to the tenant's own upstream origin", () => {
  const r = buildUpstreamUrl(codex, gw("/codex/v1/tools"));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(new URL(r.url).origin, upstreamOrigin);
    assert.equal(new URL(r.url).pathname, "/v1/tools");
  }
});

test("SSRF: a protocol-relative path escaping the upstream origin is REJECTED (fail-closed)", () => {
  // `/codex//evil.com/x` slices to `//evil.com/x` → new URL(...) ⇒ https://evil.com/x.
  // The unfixed code returned that string and the gateway forwarded to evil.com.
  // The guard now rejects: resolved origin != the tenant's upstream origin.
  const r = buildUpstreamUrl(codex, gw("/codex//evil.com/x"));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /does not match tenant upstream origin/);
});

test("SSRF: a userinfo @-authority pointing at a foreign host is REJECTED", () => {
  // `//user@evil.com/x` → the authority host is `evil.com` (userinfo before @ is
  // discarded) → foreign origin → rejected. Deterministic (F1: no branchless skip).
  const r = buildUpstreamUrl(codex, gw("/codex//user@evil.com/x"));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /does not match tenant upstream origin/);
});

test("SSRF: a backslash-smuggled authority is REJECTED (WHATWG normalizes \\ to /)", () => {
  // `/codex/\\evil.com` — the classic WAF/parser-differential vector. WHATWG
  // converts `\` to `/` for https, yielding `//evil.com` → foreign origin.
  const r = buildUpstreamUrl(codex, gw("/codex/\\evil.com/x"));
  assert.equal(r.ok, false);
});

test("encoded slashes are NOT decoded — path stays ON the upstream origin (F2: locks vs a future decode refactor)", () => {
  // `%2F%2Fevil.com` must remain a literal path segment on the upstream origin,
  // never decoded into `//evil.com`. Pins the invariant if anyone later decodes
  // the path before new URL(...).
  const r = buildUpstreamUrl(codex, gw("/codex/%2F%2Fevil.com"));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(new URL(r.url).origin, upstreamOrigin);
});

test("dot-segment traversal that normalizes ON-origin is allowed (not an escape)", () => {
  const r = buildUpstreamUrl(codex, gw("/codex/../../evil.com"));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(new URL(r.url).origin, upstreamOrigin);
});

test("query string is preserved through resolution", () => {
  const r = buildUpstreamUrl(codex, gw("/codex/search?q=mibera&n=3"));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(new URL(r.url).search, "?q=mibera&n=3");
});
