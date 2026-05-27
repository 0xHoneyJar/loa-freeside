import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
// --- base64url helpers -------------------------------------------------------
// rd-3 F-003 BB#227: use Node's Buffer instead of browser globals btoa/atob.
// The package is Node-targeted (NodeNext + nats.js peer dep); declaring a
// dependency on browser globals would leak into edge runtimes that lack them
// (e.g. Cloudflare Workers' older compat dates). Buffer's `'base64url'`
// encoding is the idiomatic + portable Node choice (added in 16.0.0; the
// package.json `engines` field caps at >=20 to be safe).
function bytesToBase64Url(bytes) {
    return Buffer.from(bytes).toString("base64url");
}
function base64UrlToBytes(b64u) {
    // `Buffer.from(str, 'base64url')` returns a Buffer that's also a Uint8Array
    // (Buffer extends Uint8Array). We slice to a fresh Uint8Array so callers
    // don't accidentally pin a larger underlying ArrayBuffer.
    const buf = Buffer.from(b64u, "base64url");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
// --- LocalEd25519Signer ------------------------------------------------------
export class LocalEd25519Signer {
    keyId;
    #secretKey;
    constructor(keyId, secretKey) {
        this.keyId = keyId;
        this.#secretKey = secretKey;
    }
    static async fromSeedBytes(seed, keyId) {
        if (seed.length !== 32) {
            throw new Error(`LocalEd25519Signer: seed must be exactly 32 bytes (got ${seed.length})`);
        }
        return new LocalEd25519Signer(keyId, seed);
    }
    static async fromSeedHex(seedHex, keyId) {
        if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
            throw new Error("LocalEd25519Signer.fromSeedHex: expected 64 hex chars (32 bytes)");
        }
        return LocalEd25519Signer.fromSeedBytes(hexToBytes(seedHex.toLowerCase()), keyId);
    }
    async sign(message) {
        const sig = ed25519.sign(message, this.#secretKey);
        return bytesToBase64Url(sig);
    }
    /** Public key bytes (32) — useful for tests, JWKS publishing, key rotation. */
    publicKeyBytes() {
        return ed25519.getPublicKey(this.#secretKey);
    }
    publicKeyHex() {
        return bytesToHex(this.publicKeyBytes());
    }
}
// --- StaticPubkeyVerifier (for tests / fixed-key consumers) ------------------
/**
 * Verifier with a pinned in-memory map of `keyId → publicKey`.
 * Useful for tests and for consumers that operate against a small known set
 * of publishers; production consumers should use {@link JwksVerifier}.
 */
export class StaticPubkeyVerifier {
    #pubkeys;
    constructor(pubkeys = {}) {
        this.#pubkeys =
            pubkeys instanceof Map ? new Map(pubkeys) : new Map(Object.entries(pubkeys));
    }
    add(keyId, publicKey) {
        if (publicKey.length !== 32) {
            throw new Error(`StaticPubkeyVerifier.add: ed25519 pubkey must be 32 bytes (got ${publicKey.length})`);
        }
        this.#pubkeys.set(keyId, publicKey);
        return this;
    }
    async verify(keyId, message, signatureBase64Url) {
        const pubkey = this.#pubkeys.get(keyId);
        if (!pubkey)
            return false;
        try {
            const sigBytes = base64UrlToBytes(signatureBase64Url);
            return ed25519.verify(sigBytes, message, pubkey);
        }
        catch {
            return false;
        }
    }
}
export class JwksVerifier {
    jwksUrl;
    #cache = new Map();
    #lastFetchMs = 0;
    /**
     * In-flight refresh dedup (EVT-003 BB#227). When a refresh is already
     * mid-flight, subsequent callers await the same promise instead of
     * launching parallel fetches; this prevents thundering herd on first
     * verify after TTL expiry AND closes the last-write-wins rotation race.
     */
    #refreshInFlight = null;
    #ttlMs;
    #timeoutMs;
    #fetchImpl;
    #onEmptyJwks;
    constructor(jwksUrl, opts = {}) {
        this.jwksUrl = jwksUrl;
        this.#ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
        this.#timeoutMs = opts.timeoutMs ?? 5_000;
        this.#fetchImpl = opts.fetchImpl ?? fetch;
        this.#onEmptyJwks = opts.onEmptyJwks ?? (() => undefined);
    }
    static async fromUrl(jwksUrl, opts = {}) {
        const v = new JwksVerifier(jwksUrl, opts);
        await v.refresh();
        // EVT-004 (BB#227): empty-on-boot is almost always a misconfiguration
        // (wrong URL, wrong key type, partial deploy). Fail loud at construction
        // so operators get an immediately actionable deployment error rather
        // than a silent stream of `signature-invalid` failures later.
        if (v.#cache.size === 0) {
            throw new Error(`JwksVerifier.fromUrl: ${jwksUrl} returned zero OKP/Ed25519 keys — refusing to construct an empty-on-boot verifier (likely misconfiguration; pass an empty-tolerant verifier explicitly if intentional)`);
        }
        return v;
    }
    async refresh() {
        // EVT-003 BB#227: coalesce concurrent callers onto the same in-flight
        // promise. Without this, a burst of messages from a just-rotated key
        // triggers O(burst-size) parallel fetches AND a last-write-wins race
        // where a stale CDN-cached response can revert a just-loaded new key.
        if (this.#refreshInFlight) {
            return this.#refreshInFlight;
        }
        this.#refreshInFlight = this.#doRefresh().finally(() => {
            this.#refreshInFlight = null;
        });
        return this.#refreshInFlight;
    }
    async #doRefresh() {
        // F-001 (BB#227): bound the fetch — a hung JWKS endpoint must not stall
        // the subscriber's consume loop. AbortController + timer; clearTimeout
        // on completion in either branch.
        const controller = this.#timeoutMs > 0 ? new AbortController() : null;
        const timer = controller
            ? setTimeout(() => controller.abort(), this.#timeoutMs)
            : null;
        let res;
        try {
            res = await this.#fetchImpl(this.jwksUrl, {
                headers: { accept: "application/json" },
                ...(controller ? { signal: controller.signal } : {}),
            });
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
        if (!res.ok) {
            throw new Error(`JwksVerifier.refresh: ${this.jwksUrl} returned ${res.status}`);
        }
        const jwks = (await res.json());
        const next = new Map();
        for (const k of jwks.keys ?? []) {
            if (k.kty === "OKP" && k.crv === "Ed25519" && k.x && k.kid) {
                next.set(k.kid, base64UrlToBytes(k.x));
            }
        }
        // EVT-004 (BB#227): fire onEmptyJwks WHENEVER the fetch returns zero
        // keys, regardless of prior cache state. The earlier F-004 fix only
        // fired this on subsequent-refresh empties — the initial-load empty
        // was silent. Now operators always get the signal.
        if (next.size === 0) {
            this.#onEmptyJwks(this.jwksUrl);
        }
        // Non-empty guard (F-004): only replace the cache when next has keys.
        // An empty-but-200 response (mid-rotation, partial deploy) must NOT
        // wipe the cache — that would self-DoS verification until the next
        // non-empty refresh. Still advance lastFetchMs so we don't hot-loop
        // refresh on every verify() call.
        if (next.size > 0) {
            this.#cache = next;
        }
        this.#lastFetchMs = Date.now();
    }
    async verify(keyId, message, signatureBase64Url) {
        if (Date.now() - this.#lastFetchMs > this.#ttlMs) {
            try {
                await this.refresh();
            }
            catch {
                // best-effort refresh; fall through to cached lookup
            }
        }
        const pubkey = this.#cache.get(keyId);
        if (!pubkey) {
            // unknown kid; try one forced refresh in case key was just rotated in
            try {
                await this.refresh();
            }
            catch {
                return false;
            }
            const retry = this.#cache.get(keyId);
            if (!retry)
                return false;
            try {
                return ed25519.verify(base64UrlToBytes(signatureBase64Url), message, retry);
            }
            catch {
                return false;
            }
        }
        try {
            return ed25519.verify(base64UrlToBytes(signatureBase64Url), message, pubkey);
        }
        catch {
            return false;
        }
    }
}
export const _internal = { bytesToBase64Url, base64UrlToBytes };
//# sourceMappingURL=signer.js.map