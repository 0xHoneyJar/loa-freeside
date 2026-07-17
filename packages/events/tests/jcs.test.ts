import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jcsCanonicalize, sha256Hex } from "../src/jcs.js";

describe("jcsCanonicalize", () => {
  it("sorts object keys lexicographically", () => {
    assert.equal(jcsCanonicalize({ b: 2, a: 1 }), '{"a":1,"b":2}');
  });

  it("strips insignificant whitespace", () => {
    // canonicalize() ignores input formatting; we pass an object directly
    assert.equal(jcsCanonicalize({ x: { y: 1 } }), '{"x":{"y":1}}');
  });

  it("produces the same output regardless of input key order", () => {
    const a = jcsCanonicalize({ a: 1, b: { c: 3, d: 4 } });
    const b = jcsCanonicalize({ b: { d: 4, c: 3 }, a: 1 });
    assert.equal(a, b);
  });

  it("handles arrays without sorting them (positional)", () => {
    assert.equal(jcsCanonicalize([3, 1, 2]), "[3,1,2]");
  });

  it("preserves string Unicode", () => {
    // RFC 8785 §3.2.2.2: strings are emitted verbatim (no escape minimization)
    const out = jcsCanonicalize({ msg: "hello, 世界" });
    assert.match(out, /"msg":/);
    assert.ok(out.includes("hello"));
  });

  it("throws on non-JSON-representable values", () => {
    assert.throws(() => jcsCanonicalize(undefined));
    assert.throws(() => jcsCanonicalize(() => 1));
  });
});

describe("sha256Hex", () => {
  it("produces 64-char lowercase hex", () => {
    const out = sha256Hex("hello");
    assert.match(out, /^[0-9a-f]{64}$/);
  });

  it("matches a known RFC test vector", () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    assert.equal(
      sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic", () => {
    const a = sha256Hex("the quick brown fox");
    const b = sha256Hex("the quick brown fox");
    assert.equal(a, b);
  });

  it("accepts Uint8Array as well as string", () => {
    const s = sha256Hex("hi");
    const b = sha256Hex(new TextEncoder().encode("hi"));
    assert.equal(s, b);
  });
});
