APPROVED - LETS FUCKING GO

# Sprint 1 Security Audit — fulfillment-surface (platform/ordering)

**Verdict**: APPROVED. 0 CRITICAL, 0 HIGH. The sprint's security posture is a net IMPROVEMENT over base: fail-closed write routes, server-derived (unfakeable) audit evidence, bounded reprobe, redacting projection.

## Verified

- **Secrets**: none hardcoded; tokens from env only; redaction boundary excludes internals; test tokens are fixtures.
- **Fail-closed (FR-10a/b)**: deployed+tokenless → write routes never mounted; verified `Dockerfile:30 ENV NODE_ENV=production` makes the deployed-marker hold for ANY docker deploy, not just Railway (the heuristic-miss hole is closed). 4-row matrix tested.
- **AuthZ surface**: single bearer gate on both write routes via shared `requireToken`; reads deliberately open (registry doctor) — documented and tested.
- **Audit-trail integrity (SKP-003/SKP-011)**: `token_label` server-derived; `evidence` a server-side value copy (immutability tested via structuredClone byte-identity); `caller_note` stored as untrusted, never substitutes.
- **DoS bounds (SKP-001a)**: 10s per-order cooldown → 429, per-probe 10s race-timeout, fan-out ≤3, worst case 20s < 30s budget; hung-probe wall-clock tested. Probe failures are results, never 5xx.
- **Injection**: zod everywhere; `Object.hasOwn` kills the prototype-chain edge; no string-built SQL (parameterized pg); no shell.
- **Info disclosure**: zod `issues` arrays in 400s carry field paths only (internal API — acceptable); no stack traces.

## Observations (LOW / non-blocking)

1. **Timing-unsafe token compare** — pre-existing pattern, already logged as tech debt in NOTES.md with `crypto.timingSafeEqual` follow-up. Impractical over network for long random tokens; LOW.
2. **Rate limit is per-order, not per-token** — SDD-conformant (D1 says per-order cooldown); a token holder can reprobe N distinct orders concurrently (3N outbound probes). Single-token internal service today; revisit when tokens multiply (NFR-8/veve grants).
3. **Pre-existing**: `fulfillment.contact_email` (PII) is exposed on the unauthenticated `GET /v1/orders/:id` — present on base branch before this sprint; the new projection did not widen it. Flag for the SDD threat model when reads go multi-tenant.

Sprint 1 is cleared for PR.
