# BYOK Threat Model

> Sprint 204, Task 2.5 (BB3-7): Document accepted risks and mitigations for BYOK key handling.

## Overview

BYOK (Bring Your Own Key) allows communities to use their own API keys for LLM inference.
Keys flow through arrakis to loa-finn and are proxied to provider APIs (OpenAI, Anthropic).

## Architecture

```
Admin → arrakis API → BYOKManager → KMS (envelope encrypt) → Store (encrypted at rest)
                                                                    ↓
Request → AgentGateway → BYOKManager.getDecryptedKey() → Buffer → BYOK Proxy → Provider API
```

## Threat: V8 Heap String Interning (Accepted Risk)

### Description

When an admin stores or rotates a BYOK key via the admin API, the key arrives as a JSON string
in the request body (`req.body.apiKey`). Express/body-parser parses this into a V8 string before
our route handler can intercept it. The route handler converts to `Buffer.from(apiKey, 'utf8')`
for secure handling, but the original string may already be interned in V8's string table.

V8's garbage collector will eventually reclaim the string, but the timing is non-deterministic.
The key may persist in heap memory for seconds to minutes after the request completes.

### Impact

- **Severity**: Low (requires memory dump access)
- **Attack vector**: An attacker with access to a heap dump or `/proc/<pid>/mem` of the
  arrakis process could potentially extract plaintext API keys from V8's string heap.
- **Window**: From request parsing until V8 GC reclaims the interned string (typically < 60s).

### Why This Is Accepted

1. **Memory dump access implies root/container escape**: If an attacker can read process memory,
   they already have sufficient access to intercept keys via other means (env vars, network tap).
2. **Keys are encrypted at rest**: The BYOKManager uses KMS envelope encryption. The plaintext
   key only exists in memory during store/rotate (admin operation) and during proxy execution
   (request-scoped).
3. **No V8 API for secure string erasure**: V8 does not expose APIs to zero-fill or eagerly
   reclaim specific strings. `Buffer.fill(0)` works for Buffers but cannot retroactively clear
   the source string.
4. **Industry standard**: This is a known limitation of all Node.js/V8 applications handling
   secrets. AWS SDK, Stripe SDK, and other production systems operate under the same constraint.

### Mitigations In Place

| Layer | Mitigation | Reference |
|-------|-----------|-----------|
| **Transport** | TLS 1.2+ for all API traffic | SDD §3.4.5 |
| **Storage** | KMS envelope encryption (AES-256-GCM) | SDD §6.2 |
| **Memory** | `Buffer.from()` conversion at earliest opportunity | byok.routes.ts:119 |
| **Memory** | `Buffer.fill(0)` after proxy use | byok-proxy-handler.ts |
| **Network** | Dedicated BYOK subnet with Network Firewall | byok-security.tf |
| **Network** | Egress restricted to provider FQDNs only | byok-security.tf:57-61 |
| **Network** | Port 443 only, VPC Flow Logs on REJECT | byok-security.tf:192-282 |
| **Access** | Admin-only key management (AC-4.10) | byok.routes.ts:95 |
| **Feature** | BYOK feature gate — disabled by default | byok.routes.ts:97-102 |
| **Audit** | All key operations logged with admin userId | byok-manager.ts |

### Future Hardening (Optional)

If the threat model changes (e.g., multi-tenant container sharing):

1. **Dedicated key ingestion sidecar**: A Rust/Go microservice that accepts keys over a Unix
   socket, encrypts immediately, and never exposes plaintext to the Node.js process.
2. **Direct-to-KMS upload**: Client encrypts with a KMS data key before transmission, so
   the plaintext never enters the Node.js process at all.
3. **Isolate to AWS Nitro Enclaves**: Run the BYOK proxy in a Nitro Enclave with attestation,
   providing hardware-level memory isolation.

## Threat: SSRF via BYOK Proxy

### Description

The BYOK proxy forwards requests to provider APIs using community-supplied keys. A compromised
or malicious key endpoint URL could redirect to internal services.

### Mitigations

| Layer | Mitigation |
|-------|-----------|
| **Application** | URL allowlist in byok-provider-endpoints.ts (exact FQDN match) |
| **Application** | Private IP block (RFC 1918, link-local, loopback) |
| **Network** | AWS Network Firewall domain allowlist (TLS SNI + HTTP Host) |
| **Network** | Security group: egress port 443 only |
| **Monitoring** | CloudWatch alarm on firewall DENY events |
| **Monitoring** | VPC Flow Logs on REJECT traffic |

### Defense in Depth

SSRF defense operates at two independent layers:
1. **Application layer** (byok-proxy-handler.ts): URL validation, private IP blocking
2. **Network layer** (byok-security.tf): Network Firewall + security group

Both layers must be bypassed for a successful SSRF attack.

## Threat: BYOK Quota Bypass

### Description

Concurrent requests could bypass the daily BYOK quota if the check is non-atomic.

### Mitigation

Atomic Redis `INCR` pattern (BB3-2 fix): `INCR` returns the new count atomically, and the
check `newCount > quota` happens on the incremented value. No TOCTOU race is possible.

See: agent-gateway.ts `checkByokQuota()` method.

## Review History

| Date | Reviewer | Changes |
|------|----------|---------|
| 2026-02-11 | Sprint 204 (BB3-7) | Initial threat model |
