import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export type SigningKeyId = string;

/** Sign arbitrary bytes; return base64url signature. */
export interface Signer {
  readonly keyId: SigningKeyId;
  sign(message: Uint8Array): Promise<string>;
}

/** Verify a base64url signature against a kid + message bytes. */
export interface Verifier {
  verify(keyId: SigningKeyId, message: Uint8Array, signatureBase64Url: string): Promise<boolean>;
}

// --- base64url helpers -------------------------------------------------------

const PAD_RX = /=+$/;
const STD_RX = /[+/]/g;
const URL_RX = /[-_]/g;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const std = btoa(bin);
  return std.replace(STD_RX, (c) => (c === "+" ? "-" : "_")).replace(PAD_RX, "");
}

function base64UrlToBytes(b64u: string): Uint8Array {
  const std = b64u.replace(URL_RX, (c) => (c === "-" ? "+" : "/"));
  // restore padding
  const padLen = (4 - (std.length % 4)) % 4;
  const padded = std + "=".repeat(padLen);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- LocalEd25519Signer ------------------------------------------------------

export class LocalEd25519Signer implements Signer {
  readonly keyId: SigningKeyId;
  readonly #secretKey: Uint8Array;

  private constructor(keyId: SigningKeyId, secretKey: Uint8Array) {
    this.keyId = keyId;
    this.#secretKey = secretKey;
  }

  static async fromSeedBytes(seed: Uint8Array, keyId: SigningKeyId): Promise<LocalEd25519Signer> {
    if (seed.length !== 32) {
      throw new Error(`LocalEd25519Signer: seed must be exactly 32 bytes (got ${seed.length})`);
    }
    return new LocalEd25519Signer(keyId, seed);
  }

  static async fromSeedHex(seedHex: string, keyId: SigningKeyId): Promise<LocalEd25519Signer> {
    if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
      throw new Error("LocalEd25519Signer.fromSeedHex: expected 64 hex chars (32 bytes)");
    }
    return LocalEd25519Signer.fromSeedBytes(hexToBytes(seedHex.toLowerCase()), keyId);
  }

  async sign(message: Uint8Array): Promise<string> {
    const sig = ed25519.sign(message, this.#secretKey);
    return bytesToBase64Url(sig);
  }

  /** Public key bytes (32) — useful for tests, JWKS publishing, key rotation. */
  publicKeyBytes(): Uint8Array {
    return ed25519.getPublicKey(this.#secretKey);
  }

  publicKeyHex(): string {
    return bytesToHex(this.publicKeyBytes());
  }
}

// --- StaticPubkeyVerifier (for tests / fixed-key consumers) ------------------

/**
 * Verifier with a pinned in-memory map of `keyId → publicKey`.
 * Useful for tests and for consumers that operate against a small known set
 * of publishers; production consumers should use {@link JwksVerifier}.
 */
export class StaticPubkeyVerifier implements Verifier {
  readonly #pubkeys: Map<SigningKeyId, Uint8Array>;

  constructor(pubkeys: Record<SigningKeyId, Uint8Array> | Map<SigningKeyId, Uint8Array> = {}) {
    this.#pubkeys =
      pubkeys instanceof Map ? new Map(pubkeys) : new Map(Object.entries(pubkeys));
  }

  add(keyId: SigningKeyId, publicKey: Uint8Array): this {
    if (publicKey.length !== 32) {
      throw new Error(`StaticPubkeyVerifier.add: ed25519 pubkey must be 32 bytes (got ${publicKey.length})`);
    }
    this.#pubkeys.set(keyId, publicKey);
    return this;
  }

  async verify(keyId: SigningKeyId, message: Uint8Array, signatureBase64Url: string): Promise<boolean> {
    const pubkey = this.#pubkeys.get(keyId);
    if (!pubkey) return false;
    try {
      const sigBytes = base64UrlToBytes(signatureBase64Url);
      return ed25519.verify(sigBytes, message, pubkey);
    } catch {
      return false;
    }
  }
}

// --- JwksVerifier (fetches JWKS from a URL; caches) --------------------------

interface JwksKey {
  kty: string;
  crv?: string;
  kid: string;
  x?: string; // base64url public key for OKP/Ed25519
  use?: string;
  alg?: string;
}

interface Jwks {
  keys: JwksKey[];
}

/**
 * Verifier that fetches a JWKS document from an HTTPS endpoint and verifies
 * Ed25519 signatures against the resolved kid.
 *
 * Per ADR-009 §D-5, the cluster's JWKS endpoint lives at `apps/gateway`.
 * Consumers pass that URL at construction time. The JWKS is cached in-memory
 * with a configurable TTL; cache misses re-fetch.
 */
export interface JwksVerifierOptions {
  /** Refresh TTL in milliseconds; default 5 minutes. */
  ttlMs?: number;
  /**
   * Per-fetch timeout in milliseconds; default 5s. A hung JWKS endpoint
   * would otherwise stall every subscriber's `consume()` loop indefinitely
   * (verification is awaited per-message). Bound the blast radius here.
   * Pass `0` to disable (NOT recommended in production).
   */
  timeoutMs?: number;
  /** Injectable fetch — useful for tests. */
  fetchImpl?: typeof fetch;
  /** Optional warn-logger fired when a refresh returns zero keys; default no-op. */
  onEmptyJwks?: (jwksUrl: string) => void;
}

export class JwksVerifier implements Verifier {
  #cache: Map<SigningKeyId, Uint8Array> = new Map();
  #lastFetchMs = 0;
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch;
  readonly #onEmptyJwks: (jwksUrl: string) => void;

  private constructor(readonly jwksUrl: string, opts: JwksVerifierOptions = {}) {
    this.#ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.#timeoutMs = opts.timeoutMs ?? 5_000;
    this.#fetchImpl = opts.fetchImpl ?? fetch;
    this.#onEmptyJwks = opts.onEmptyJwks ?? (() => undefined);
  }

  static async fromUrl(jwksUrl: string, opts: JwksVerifierOptions = {}): Promise<JwksVerifier> {
    const v = new JwksVerifier(jwksUrl, opts);
    await v.refresh();
    return v;
  }

  async refresh(): Promise<void> {
    // F-001 (BB#227): bound the fetch — a hung JWKS endpoint must not stall
    // the subscriber's consume loop. AbortController + timer; clearTimeout
    // on completion in either branch.
    const controller = this.#timeoutMs > 0 ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.#timeoutMs)
      : null;
    let res: Response;
    try {
      res = await this.#fetchImpl(this.jwksUrl, {
        headers: { accept: "application/json" },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`JwksVerifier.refresh: ${this.jwksUrl} returned ${res.status}`);
    }
    const jwks = (await res.json()) as Jwks;
    const next = new Map<SigningKeyId, Uint8Array>();
    for (const k of jwks.keys ?? []) {
      if (k.kty === "OKP" && k.crv === "Ed25519" && k.x && k.kid) {
        next.set(k.kid, base64UrlToBytes(k.x));
      }
    }

    // F-004 (BB#227): non-empty guard. An empty-but-200 JWKS response (mid-
    // rotation, partial deploy) must NOT wipe the cache — that would self-DoS
    // verification until the next non-empty refresh lands. Keep the stale
    // cache; notify the operator via onEmptyJwks; still advance lastFetchMs
    // so we don't hot-loop the refresh on every verify() call.
    if (next.size === 0 && this.#cache.size > 0) {
      this.#onEmptyJwks(this.jwksUrl);
    } else {
      this.#cache = next;
    }
    this.#lastFetchMs = Date.now();
  }

  async verify(keyId: SigningKeyId, message: Uint8Array, signatureBase64Url: string): Promise<boolean> {
    if (Date.now() - this.#lastFetchMs > this.#ttlMs) {
      try {
        await this.refresh();
      } catch {
        // best-effort refresh; fall through to cached lookup
      }
    }
    const pubkey = this.#cache.get(keyId);
    if (!pubkey) {
      // unknown kid; try one forced refresh in case key was just rotated in
      try {
        await this.refresh();
      } catch {
        return false;
      }
      const retry = this.#cache.get(keyId);
      if (!retry) return false;
      try {
        return ed25519.verify(base64UrlToBytes(signatureBase64Url), message, retry);
      } catch {
        return false;
      }
    }
    try {
      return ed25519.verify(base64UrlToBytes(signatureBase64Url), message, pubkey);
    } catch {
      return false;
    }
  }
}

export const _internal = { bytesToBase64Url, base64UrlToBytes };
