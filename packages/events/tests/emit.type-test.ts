/**
 * Compile-time proof of the SchemaId<P> payload binding (cycle-112 T1.1,
 * SKP-005/IMP-001). This file is NOT run; it is type-checked by
 * `tsconfig.test.json` (the base build excludes tests/). Each `@ts-expect-error`
 * asserts that the line below it is a COMPILE error — if it ever compiles, tsc
 * fails on the unused directive.
 *
 * NOTE: an `as any` cast at a call site cannot be caught by the type system (any
 * is assignable to everything by design). That bypass is caught by the S2 lint
 * (T2.1 — ban `as SchemaId` / `as any` at emit sites), not here.
 */
import type { Emitter } from "../src/emit.js";
import { NftMintDetectedId } from "../src/registry.js";

declare const emitter: Emitter;

const VALID_MINT = {
  chain_id: 80094,
  contract: "0x" + "a".repeat(40),
  token_id: "1",
  minter: "0x" + "b".repeat(40),
  block_number: 100,
  transaction_hash: "0x" + "c".repeat(64),
  timestamp: "2026-05-31T00:00:00Z",
};

// A correctly-shaped payload compiles (no directive).
void emitter.emit(NftMintDetectedId, VALID_MINT, "mibera-shadow");

// @ts-expect-error - wrong payload SHAPE for NftMintDetectedId
void emitter.emit(NftMintDetectedId, { foo: 1 });

// @ts-expect-error - a string is not the mint payload
void emitter.emit(NftMintDetectedId, "nope");

// @ts-expect-error - missing required fields
void emitter.emit(NftMintDetectedId, { chain_id: 1 });
