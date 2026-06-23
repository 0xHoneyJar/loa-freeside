/** JCS twin identity + invariants (RFC 8785). */
import { describe, it, expect } from "vitest";
import { jcsCanonicalize, sha256Hex, jcsHash } from "../jcs.js";

describe("jcsCanonicalize — RFC 8785", () => {
  it("sorts object keys by code unit", () => {
    expect(jcsCanonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcsCanonicalize({ c: 3, a: 1, b: 2 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it("preserves array order and emits no whitespace", () => {
    expect(jcsCanonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(jcsCanonicalize({ x: [1, { z: 2, y: 3 }] })).toBe('{"x":[1,{"y":3,"z":2}]}');
  });

  it("serializes primitives canonically", () => {
    expect(jcsCanonicalize("a")).toBe('"a"');
    expect(jcsCanonicalize(true)).toBe("true");
    expect(jcsCanonicalize(null)).toBe("null");
    expect(jcsCanonicalize(-0)).toBe("0");
    expect(jcsCanonicalize(1000000)).toBe("1000000");
  });

  it("escapes control characters per RFC 8785 (lowercase \\u)", () => {
    expect(jcsCanonicalize("")).toBe('"\\u0001"');
    expect(jcsCanonicalize("a\nb")).toBe('"a\\nb"');
  });

  it("rejects non-integer numbers (the no-floats invariant)", () => {
    expect(() => jcsCanonicalize(0.5)).toThrow(/non-integer/);
    expect(() => jcsCanonicalize({ p: 1.5 })).toThrow(/non-integer/);
  });

  it("rejects non-finite numbers and undefined at root", () => {
    expect(() => jcsCanonicalize(NaN)).toThrow();
    expect(() => jcsCanonicalize(Infinity)).toThrow();
    expect(() => jcsCanonicalize(undefined)).toThrow();
  });

  it("is order-independent (the property that makes the hash stable)", () => {
    expect(jcsCanonicalize({ a: 1, b: 2 })).toBe(jcsCanonicalize({ b: 2, a: 1 }));
  });
});

describe("sha256Hex / jcsHash", () => {
  it("matches the known SHA-256 of the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes the canonical form (key order does not change the hash)", () => {
    expect(jcsHash({ a: 1, b: 2 })).toBe(jcsHash({ b: 2, a: 1 }));
    expect(jcsHash({ a: 1 })).not.toBe(jcsHash({ a: 2 }));
  });
});
