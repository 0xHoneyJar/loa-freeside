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
declare function bytesToBase64Url(bytes: Uint8Array): string;
declare function base64UrlToBytes(b64u: string): Uint8Array;
export declare class LocalEd25519Signer implements Signer {
    #private;
    readonly keyId: SigningKeyId;
    private constructor();
    static fromSeedBytes(seed: Uint8Array, keyId: SigningKeyId): Promise<LocalEd25519Signer>;
    static fromSeedHex(seedHex: string, keyId: SigningKeyId): Promise<LocalEd25519Signer>;
    sign(message: Uint8Array): Promise<string>;
    /** Public key bytes (32) — useful for tests, JWKS publishing, key rotation. */
    publicKeyBytes(): Uint8Array;
    publicKeyHex(): string;
}
/**
 * Verifier with a pinned in-memory map of `keyId → publicKey`.
 * Useful for tests and for consumers that operate against a small known set
 * of publishers; production consumers should use {@link JwksVerifier}.
 */
export declare class StaticPubkeyVerifier implements Verifier {
    #private;
    constructor(pubkeys?: Record<SigningKeyId, Uint8Array> | Map<SigningKeyId, Uint8Array>);
    add(keyId: SigningKeyId, publicKey: Uint8Array): this;
    verify(keyId: SigningKeyId, message: Uint8Array, signatureBase64Url: string): Promise<boolean>;
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
export declare class JwksVerifier implements Verifier {
    #private;
    readonly jwksUrl: string;
    private constructor();
    static fromUrl(jwksUrl: string, opts?: JwksVerifierOptions): Promise<JwksVerifier>;
    refresh(): Promise<void>;
    verify(keyId: SigningKeyId, message: Uint8Array, signatureBase64Url: string): Promise<boolean>;
}
export declare const _internal: {
    bytesToBase64Url: typeof bytesToBase64Url;
    base64UrlToBytes: typeof base64UrlToBytes;
};
export {};
//# sourceMappingURL=signer.d.ts.map