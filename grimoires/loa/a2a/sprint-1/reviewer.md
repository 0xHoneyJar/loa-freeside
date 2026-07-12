# Sprint 1 Implementation Report — beacon-consumer (PR-A, network domain)

> Cycle: beacon-consumer · Branch: `feature/beacon-consumer-s1` (worktree `.worktrees/beacon-consumer`) · Commits: `04eddd0d` (S1-T2..T6) + `dfa9598e` (FAGAN F1 fix). S1-T1 already on `cycle/beacon-consumer`. Supersedes the archived fulfillment-surface report (`_archive-fulfillment-20260702/`).

## Executive Summary

`freeside-cli inspect <slug>` is now the first **live beacon consumer**: it fetches a cell's declared `beacon_url` over an SSRF-safe path, validates BeaconV3, and renders the single-owned `OrientationPacket` with an honest classification (`beacon_valid`/`dark`/`void`/`invalid`/`unreachable`) mapped to a stable exit code. The security-critical `hardenBeaconFetch` (https-only + IDNA/dot-boundary host allowlist + complete private-range reject + **IP-pinned connect closing the DNS-rebinding TOCTOU** + 256KB cap) is shared by `inspect` and `doctor --remote` — one hardened path, no parallel copy. Cross-model adversarial review (FAGAN) ran on the committed diff; its one MEDIUM finding (hex-form IPv4-mapped bypass) is fixed and regression-tested.

Both suites green, network-domain only.

## AC Verification

### S1-T2 — Shared conformance-vector suite
> "the JSON parses + is schema-checked; a beacon-schema test drives `buildOrientationPacket` + the `hardenBeaconFetch` classifier through EVERY vector and asserts `expect` (incl. enumerated `detail`)."

**✓ Met.** Vectors: `packages/beacon-schema/test-vectors/orientation-conformance.json` (host_guard bypass set incl. `0xhoneyjar.xyz.evil.tld`/trailing-dot/UPPERCASE/punycode; private_range v4+v6+IPv4-mapped **dotted AND hex** form; classification→exit rows). Driven at the owner package: `packages/beacon-schema/tests/orientation-conformance.test.ts:36,50` (builder + `BEACON_EXIT`), and the guard side at `packages/freeside-cli/tests/harden-beacon-fetch.test.ts:38,52` (host_guard + private_range). freeside-cli reads the vectors from the beacon-schema package path (`tests/harden-beacon-fetch.test.ts:22`).

### S1-T3 — SSRF hardening `hardenBeaconFetch` [SECURITY]
> "http→scheme_rejected; suffix-bypass set→host_not_allowlisted, no fetch; each private range (v4+v6+IPv4-mapped) resolving→resolved_private, no fetch (DNS mocked); DNS-rebinding test — pinned-IP fetch connects to the validated address; oversize→beacon_invalid; off-host redirect→void; error-detail never a body substring. Existing doctor tests stay green."

**✓ Met.** `packages/freeside-cli/src/lib/harden-beacon-fetch.ts`:
- https-only `harden-beacon-fetch.ts:212`; canonical IDNA/dot-boundary allowlist `normalizeHost`+`isHostAllowlisted` `:35,:48`; complete private-range set `isBlockedV4`/`isBlockedV6` `:62,:120` (v4 0/8,10/8,100.64/10,127/8,169.254/16,172.16/12,192.0.0/24,192.168/16,198.18/15,224/4,240/4; v6 loopback/unspecified/link-local/ULA/multicast/fec0 + **numeric** IPv4-mapped unwrap).
- **IP-pinned connect** `pinnedGet` custom `lookup` returning the validated IP with TLS `servername` preserved `:135`; single-resolution + reject-if-ANY-blocked `resolveValidated` `:126`.
- oversize→`beacon_invalid`(detail `oversize`) `:153` + `inspect.ts:46`; off-host redirect surfaced as `finalUrl`→void `:203`; errors carry no body `:196`.
- **DNS-rebinding test** (injected transport, network-free): `tests/harden-beacon-fetch.test.ts:120` asserts connect pins the pre-validated IP; resolved-private-no-connect `:88`; mixed-record poison `:101`.
- Existing doctor tests green (redirect tests ported to the injectable transport `tests/doctor.test.ts:471,496`).

### S1-T4 — `freeside-cli inspect` un-stub
> "contract tests via injected fetcher — happy (valid→full packet exit 0), each classification→exit row (0/2/3/4/5), unknown slug→exit 1+list, `--raw` valid vs non-valid, `--pretty`. Verdict agrees with doctor for the same cell (G-5)."

**✓ Met.** `packages/freeside-cli/src/verbs/inspect.ts` — async `inspectModule`→`InspectResult{packet,exit,raw}` `:98`; 5-class `classify`→exit `:40`; error JSON shape `{error,slug?,available_slugs?,detail?}` `:25`; `--raw`(null on non-valid)+`--pretty` in `bin/freeside-cli.ts:72`. Contract tests (injected fetcher, no live network): `tests/inspect.test.ts` — happy `:38`, mismatch→4 `:63`, non-beacon→3 `:76`, 404→4 `:86`, off-host→5 `:96`, timeout→2 `:106`, oversize→3 `:116`, guard-reject→2 `:126`, unknown-slug→1+list (no fetch) `:138`, null-url→4 (no fetch) `:154`, `--raw` `:172`. Exit table is the single-owned `BEACON_EXIT` (beacon-schema) shared by inspect + doctor + loa model (G-5, IMP-003/004): `orientation-packet.ts:126`.

### S1-T5 — CLAUDE.md reach pointer (inspect-only)
> "pointer present in the nav block; references only `freeside-cli inspect`; ≤~50 tokens; no forward-reference to an unbuilt command."

**✓ Met.** `CLAUDE.md` §"Ecosystem Navigation", the paragraph after the `loa census` block — names `freeside-cli inspect <slug>` only; no `loa model` reference (that is the PR-B step-4 flip).

### S1-T6 — Wire + verify
> "all green; `tools/check-beacon-domain.sh` → network-only (zero platform paths); grep-assert no live-network in default test run."

**✓ Met.** beacon-schema `pnpm test` 59+3 green; freeside-cli `pnpm build`+`pnpm test` 89 pass / 0 fail / 1 skip (the pre-existing `ORDERING_DIFFERENTIAL`-env-gated live test — not run by default). `tools/check-beacon-domain.sh --since origin/main` → `✓ Domain: network`. Grep-assert: zero live-network primitives in the beacon-consumer test files (all injected fetcher/transport).

## Cross-model review (FAGAN)

Adversarial dissent on the committed diff. Verdict APPROVE-WITH-FINDINGS; 7 anti-SSRF guards affirmed sound (check-and-connect-same-host, exact-IP pin / rebind TOCTOU closed, reject-if-ANY-blocked, v4 bitmask across 26 boundary cases, redirect body containment, classify ordering, doctor unification). Findings:
- **F1 MEDIUM (FIXED, `dfa9598e`)** — hex-form IPv4-mapped IPv6 (`::ffff:a9fe:a9fe`=169.254.169.254) bypassed the private-range block. Fixed by numeric hextet unwrap; hex vectors added.
- **F2 LOW (documented, no live impact)** — `doctor --remote` now reports non-allowlisted hosts as dark; all 12 registry hosts are `*.0xhoneyjar.xyz` (allowlisted). Fail-closed, and it *fixes* a prior doctor SSRF. Follow-up: a distinct `host_not_consumable` verdict for operator clarity.
- **F3/F4/F5 LOW/INFO** — non-internal TEST-NET ranges (not SSRF vectors); raw socket `err.message` reaches doctor findings (inspect sanitizes via the `VerdictDetail` enum; doctor is operator-facing); port dropped (fail-safe). No action.

## Known limitations / deferrals
- PR-B (`loa model` in external loa-cli) is the operator-gated cross-repo follow-on (not this PR); the CLAUDE.md pointer names only `freeside-cli inspect` until it lands (partial-rollout invariant).
- G-1 kill-test is operator-run post-land.

## Verification steps
```
cd packages/beacon-schema && pnpm test           # 59 unit + 3 cli green
cd packages/freeside-cli && pnpm build && pnpm test   # 89 pass, 1 env-gated skip
tools/check-beacon-domain.sh --since origin/main # ✓ network
```
