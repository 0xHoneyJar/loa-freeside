# ADR-002: ES256 (ECDSA P-256) for JWT Signing

**Status**: Accepted
**Date**: 2026-02-09
**Context**: Spice Gate Phase 4 — JWT Service

## Context

The gateway signs JWTs that are forwarded to loa-finn (the agent orchestrator). These JWTs carry request context (tenant, user, tier, allowed models) and must be verifiable by loa-finn without sharing secrets.

## Decision

Use ES256 (ECDSA with P-256 curve) for JWT signing instead of RS256 (RSA-PKCS1-v1_5) or HS256 (HMAC-SHA256).

## Rationale

**Why asymmetric (not HS256)?**
- The gateway (signer) and loa-finn (verifier) are separate services. Shared secrets (HS256) would mean both services hold the signing key, violating least privilege.
- Asymmetric allows key rotation without coordinating secret distribution.

**Why ES256 over RS256?**
- **Key size**: EC P-256 private key is 32 bytes vs RSA-2048 at 256 bytes. Smaller keys = faster operations.
- **Signing speed**: ES256 signing is ~3-5x faster than RS256 on modern hardware. Our benchmark shows p95 < 0.5ms for ES256 sign (SG-1 ship gate target: < 5ms).
- **JWT size**: ES256 signatures are 64 bytes vs RS256 at 256 bytes. Smaller JWTs = less overhead per request.
- **Industry trend**: ES256 is the default for new systems (e.g., Apple Push Notifications, WebAuthn).

**Trade-offs accepted:**
- EC key generation requires a cryptographically secure random number generator (Node.js `crypto.generateKeyPairSync` handles this).
- Some older JWT libraries have weaker ECDSA support (not a concern — we use `jose` which has excellent ES256 support).

## Consequences

- Private key stored as PEM, loaded via `KeyLoader` interface (supports file, env var, or vault).
- Key rotation via `PreviousKeyConfig` — old key kept for verification during rotation window.
- JWKS endpoint exposes public key for loa-finn verification (with TTL caching — see ADR for JWKS).
- Benchmark harness validates p95 < 5ms as ship gate SG-1.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| HS256 (HMAC) | Shared secret between services; no key rotation without downtime |
| RS256 (RSA) | 3-5x slower signing; larger keys and signatures; no practical security advantage over ES256 for our use case |
| EdDSA (Ed25519) | Not yet widely supported in JWT ecosystem; `jose` supports it but loa-finn's JWT library may not |
