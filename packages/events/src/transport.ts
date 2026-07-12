/**
 * The NATS transport capability boundary (cycle-112 T1.5, FR-7).
 *
 * Today `publishEnvelope` takes a structural `NatsLike` as an input field, so any
 * cell holds the raw NATS client and can call `.publish` directly — the boundary
 * is unenforced. An earlier design exposed an `unwrap()` method on a branded
 * transport, but the Flatline SDD review (SKP-001/SKP-002) proved that is NOT a
 * hard boundary: an exported `unwrap()` / `wrapTransport()` lets any cell do
 * `wrapTransport(client).unwrap().publish(...)`. A documented `@internal` comment
 * plus a lint rule is convention, not capability.
 *
 * The fix is a CLOSURE-held raw client. `createNatsTransport` stores the raw
 * client in a module-private `WeakMap` keyed by an opaque token and returns only
 * the token. The token has NO member that yields the raw client. The single
 * function that can reach it — `internalPublish` — lives in this module and is
 * NOT exported from the package entrypoint (`index.ts`). `emit.ts` and
 * `publisher.ts` import it directly from `./transport.js`; no code outside
 * `packages/events` can. This is a capability boundary, with the lint (S2) as
 * defense-in-depth, not the primary fence.
 */

/** The minimal raw NATS publish surface (mirrors the prior internal `NatsLike`). */
export interface RawNats {
  publish(subject: string, data: Uint8Array, opts?: { headers?: unknown }): void | Promise<unknown>;
}

declare const TransportBrand: unique symbol;

/**
 * Opaque transport token. A cell can hold one (to pass into `makeEmitter`) but it
 * exposes no member that yields the raw client — there is nothing to call
 * `.publish` on.
 */
export interface NatsTransport {
  readonly [TransportBrand]: true;
}

// The raw client lives ONLY here, keyed by the opaque token. No exported
// accessor returns it; a cell holding a `NatsTransport` cannot reach the WeakMap.
const RAW = new WeakMap<NatsTransport, RawNats>();

/**
 * Build a transport from a raw NATS client. The events package owns the raw
 * client end to end; cells call THIS (typically at their composition root) and
 * thereafter hold only the opaque token.
 */
export function createNatsTransport(raw: RawNats): NatsTransport {
  const token: NatsTransport = Object.freeze({} as NatsTransport);
  RAW.set(token, raw);
  return token;
}

/**
 * Package-private capability: resolve the raw client behind a transport token.
 *
 * NOT exported from `index.ts`. Only `emit.ts` / `publisher.ts` import it
 * directly from `./transport.js`. The lint (S2) flags any deep-import of this
 * symbol from outside the events package.
 */
export function internalPublish(transport: NatsTransport): RawNats {
  const raw = RAW.get(transport);
  if (raw === undefined) {
    throw new Error("[events] transport was not constructed via createNatsTransport");
  }
  return raw;
}
