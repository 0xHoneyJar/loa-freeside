import { describe, expect, it } from 'vitest';
import { JcsError, jcsBytes, jcsCanonicalize } from '../jcs.js';

describe('RFC 8785 Appendix vectors', () => {
  it('canonicalizes the RFC arrays/literals/weird-numbers sample', () => {
    const input = {
      numbers: [333333333.3333333, 1e30, 4.5, 0.002, 1e-27],
      string: '€$\nA\'B"\\\\"/',
      literals: [null, true, false],
    };
    expect(jcsCanonicalize(input)).toBe(
      '{"literals":[null,true,false],' +
        '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts property names by UTF-16 code units (RFC ordering sample)', () => {
    // From the RFC: "€" (€, one unit 0x20AC) sorts before "𐌠" (𐌠,
    // surrogate pair starting 0xD800)? No — 0x20AC < 0xD800, so € first; and "aa" < "b".
    const input: Record<string, number> = {};
    input['€'] = 1;
    input['𐌠'] = 2;
    input['aa'] = 3;
    input['b'] = 4;
    const out = jcsCanonicalize(input);
    const order = [out.indexOf('"aa"'), out.indexOf('"b"'), out.indexOf('"€"'), out.indexOf('"𐌠"')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('number edge cases follow ECMAScript toString', () => {
    expect(jcsCanonicalize([1e21, 1e-7, -0, 10.0])).toBe('[1e+21,1e-7,0,10]');
  });
});

describe('JSON semantics', () => {
  it('drops undefined object props, nulls undefined array slots', () => {
    expect(jcsCanonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(jcsCanonicalize([undefined, 1])).toBe('[null,1]');
  });

  it('nested objects canonicalize recursively', () => {
    expect(jcsCanonicalize({ z: { b: 2, a: 1 }, a: [{ y: 0, x: 0 }] })).toBe(
      '{"a":[{"x":0,"y":0}],"z":{"a":1,"b":2}}',
    );
  });

  it('determinism: independent construction orders → identical bytes', () => {
    const one = { alpha: 1, beta: { g: [3, 2], d: 'x' } };
    const two: Record<string, unknown> = {};
    two['beta'] = { d: 'x', g: [3, 2] };
    two['alpha'] = 1;
    expect(Buffer.from(jcsBytes(one)).equals(Buffer.from(jcsBytes(two)))).toBe(true);
  });
});

describe('rejections (fail-loud)', () => {
  it('rejects non-finite numbers', () => {
    expect(() => jcsCanonicalize({ x: Infinity })).toThrow(JcsError);
    expect(() => jcsCanonicalize({ x: NaN })).toThrow(JcsError);
  });
  it('rejects non-plain objects (Date/Map/Set/class) loud, never as {}', () => {
    expect(() => jcsCanonicalize({ x: new Date(0) })).toThrow(JcsError);
    expect(() => jcsCanonicalize({ x: new Map() })).toThrow(JcsError);
    expect(() => jcsCanonicalize({ x: new Set() })).toThrow(JcsError);
    class Foo { a = 1; }
    expect(() => jcsCanonicalize({ x: new Foo() })).toThrow(JcsError);
    expect(jcsCanonicalize({ x: Object.create(null) ? { a: 1 } : {} })).toBe('{"x":{"a":1}}');
  });

  it('rejects bigint/function/symbol/top-level undefined', () => {
    expect(() => jcsCanonicalize({ x: 1n })).toThrow(JcsError);
    expect(() => jcsCanonicalize({ x: () => 0 })).toThrow(JcsError);
    expect(() => jcsCanonicalize({ x: Symbol('s') })).toThrow(JcsError);
    expect(() => jcsCanonicalize(undefined)).toThrow(JcsError);
  });
});
