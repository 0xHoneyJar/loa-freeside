# Implementation Report — Order System, Sprint 4 (provenance + security hardening)

**Branch**: `cycle/shadow-audit-runtime-ordering` · **Run**: autonomous (goal: finish all sprints) · local-only.
**Domain (ADR-007)**: `platform` only. Traces to `sprint.md` Sprint 4 + SDD §9, §13 H-5/H-6/M-8.

## Executive Summary
Built the platform hardening: canonical signed order (H-5), intake authn/authz + replay protection (H-6),
and the private signed ops channel (M-8). S4-T4 (authed full migration-delta) is **blocked** on PR #395 +
main's frozen Unit Tests gate and is deferred. **Gate: tsc clean · 54 tests pass (+11).**

## AC Verification

### S4-T1 — canonical signed order (H-5)
> "the signed envelope carries the full canonical order; verification fails on any field tamper"

**✓ Met.** `src/order-signer.ts` — `signOrder`/`verifyOrder`: ed25519 over `jcsCanonicalize(order)` where the
canonical order is the FULL payload (validated inputs + `schema_version` + `preset_version` +
`audit_request_digest`), not just an inputs digest. Tested: `src/__tests__/order-signer.test.ts` — sign→verify
true; tamper of a deep input, the bound AuditRequest digest, or the preset version each → verify **false**;
wrong key → false.

### S4-T2 — intake authn/authz (H-6)
> "unauthenticated/replayed order → rejected + logged"

**✓ Met.** `src/intake-auth.ts` `requireOperatorAuth` middleware: requires operator identity + credential
(injected `authenticate`), authz (`authorize`), timestamp freshness (`maxSkewMs`), and nonce replay
protection (`NonceStore`); writes an intake audit entry for EVERY attempt. Tested: `src/__tests__/intake-auth.test.ts`
— 200 authed; 401 missing headers / bad credential / stale timestamp / replayed nonce; 403 unauthorized;
audit log captures accepted + rejected.

### S4-T3 — private signed ops channel (M-8)
> "a refusal emits sanitized public + full private event"

**✓ Met.** `src/private-ops.ts` `PrivateOpsPublisher` + orchestrator wiring (`opsChannel` dep). On a refusal
the orchestrator emits the sanitized public `failed.v1` AND the FULL raw cause + correlation id privately.
Tested: `src/__tests__/private-ops.test.ts` — public refusal reason is sanitized (no `INTERNAL` leak), the
private ops event carries the raw reason + `correlation_id`; without an ops channel, only the public event
fires (back-compat).

### S4-T4 — authed full migration-delta + shareable export
> "order with `auth` → full delta + shareable export; gated until #395 lands"

**⏸ [ACCEPTED-DEFERRED — BLOCKED].** Explicitly gated on PR #395 (the wedge's authed migration-delta) +
main's frozen Unit Tests gate (`arrakis-yp7q`/PR #310). Not built this run. Bead `arrakis-pttv` left open;
NOTES.md Decision Log entry filed. The pieces it builds on are ready: the order signer (H-5) binds the
authed order, and `includeRecords` already toggles anon vs authed in the ACL — the delta wiring lands once #395 is in.

## Tasks Completed
| Task | Files | Status |
|------|-------|--------|
| S4-T1 | `src/order-signer.ts` (+test) | platform — ed25519/JCS full-order signing |
| S4-T2 | `src/intake-auth.ts` (+test) | platform — auth + authz + nonce/timestamp + audit log |
| S4-T3 | `src/private-ops.ts` (+test), `src/orchestrator.ts` (opsChannel) | platform — M-8 public/private split |
| S4-T4 | — | BLOCKED on PR #395 + frozen gate (deferred) |

## Technical Highlights
- **Whole-payload signing (H-5):** signing `jcsCanonicalize(fullOrder)` means tampering ANY field (incl. the
  bound AuditRequest digest) invalidates the signature — the R-1 money/ops guarantee, not just an inputs hash.
- **Replay defense (H-6):** nonce store + timestamp skew window; every attempt audited (the credential itself never logged).
- **M-8 split:** the public topic stays sanitized; the full cause goes to a private correlated channel — additive (`opsChannel` optional → S1 tests unchanged).

## Known Limitations
- Keys (H-5) / credential verifier (H-6) / nonce store / ops publisher are injected ports; concrete cluster
  key-management (Legba/gaib), a shared TTL nonce store (Redis), and the signed private subject wire at deploy.
- S4-T4 blocked (above).

## Review status
Independent cross-model review still unavailable (OpenAI quota + codex dispatch). Self-review + adversarial
tests: signer tamper-rejection (4), auth rejection paths (6), M-8 sanitization (2). Security: ed25519 via
node:crypto; credentials never logged; sanitized public refusal verified to not leak raw cause.

## Verification Steps
```bash
cd packages/services/ordering && pnpm test && pnpm typecheck   # 54 pass, clean
```
