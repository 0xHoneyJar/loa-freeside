import canonicalizeMod from "canonicalize";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

const canonicalize = canonicalizeMod as unknown as (value: unknown) => string | undefined;

export function jcsCanonicalize(value: unknown): string {
  const out = canonicalize(value);
  if (typeof out !== "string") {
    throw new Error(
      "jcsCanonicalize: input is not JSON-representable (functions, symbols, Infinity, NaN, BigInt without toJSON, or undefined at root)",
    );
  }
  return out;
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256(bytes));
}

export function digestJcs(value: unknown): string {
  return sha256Hex(jcsCanonicalize(value));
}
