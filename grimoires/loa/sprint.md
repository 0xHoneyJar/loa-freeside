# Sprint Plan — First Live Beacon Consumer

> Cycle: beacon-consumer. Implements `sdd.md` §4 delivery plan (flatline-reviewed PRD+SDD). Branch: `cycle/beacon-consumer` worktree (off origin/main).
> **Sprint 1 = PR-A (in-repo, `network/` domain) — the `/run` target.** The loa-cli work (PR-B) is a **cross-repo follow-on** run in the external `~/Documents/GitHub/loa-cli` repo, operator-gated (NFR-2); it is NOT a `/run`-here sprint (this worktree can't build/test loa-cli). Release order: PR-A → PR-B → parity → pointer flip (SDD §4).

## Sprint 1 — PR-A: beacon-schema packet + freeside-cli inspect un-stub + SSRF hardening (network domain)

**Goal**: `freeside-cli inspect <slug>` fetches, distills, and honestly verdicts a cell's beacon — reusing doctor's machinery, SSRF-safe, conformance-tested. (G-2, G-4, G-5; enables G-1)

### S1-T1 — `OrientationPacket` type + `buildOrientationPacket` (beacon-schema)
`packages/beacon-schema/src/orientation-packet.ts`: the `OrientationPacket` type (SDD D1) + the total pure builder `buildOrientationPacket(registryEntry, probe, beacon?)` (SDD D0 — missing-field policy: beacon fields null unless `beacon_valid`; never partial-fill; never throws). Export from index.
**Accept**: unit — valid input → full packet; `beacon_valid=false` inputs (dark/void/invalid/unreachable) → all beacon fields null + correct verdict; registry fields always present; builder is total (bad input → packet, no throw).

### S1-T2 — Shared conformance-vector suite (beacon-schema)
`packages/beacon-schema/test-vectors/orientation-conformance.json` (SDD D6): one vector per classification + hardening + **bypass-boundary** case, each `{name, input, expect:{packet, classification, exit_code, detail}}`. Versioned with beacon-schema. Coverage MUST include [flatline sprint IMP-005/006, SKP-002/003]: valid; dark(404/non-beacon); void(off-host); invalid(bad-V3, oversize); unreachable(timeout, scheme_rejected, dns_failure); host allowlist bypass set (`0xhoneyjar.xyz.evil.tld`, `evilcluster.example.com`, trailing-dot, UPPERCASE, punycode/IDNA); private-range set per family (v4 RFC1918+CGNAT+metadata+loopback, v6 loopback/link-local/ULA/multicast, IPv4-mapped); DNS-rebinding (precheck≠connect); unknown-slug.
**Accept**: the JSON parses + is schema-checked; a beacon-schema test drives `buildOrientationPacket` + the `hardenBeaconFetch` classifier through EVERY vector and asserts `expect` (incl. enumerated `detail`, SDD IMP-005). This suite is the drift alarm both repos consume; import mechanics [flatline IMP-001] — freeside-cli reads it from the beacon-schema package path; loa-cli copies with a checksum-pinned drift check.

### S1-T3 — SSRF hardening `hardenBeaconFetch` (freeside-cli, shared with doctor) [SECURITY — flatline sprint 5 blockers integrated]
The single security-critical task. One `hardenBeaconFetch` helper (shared by `inspect` + `doctor --remote`) enforcing, in order:

1. **https-only** (a) — non-https → `scheme_rejected`, no fetch.
2. **Canonical host allowlist** (b, primary control) [SKP-002/003]: normalize the host — lowercase, strip exactly one trailing dot, **IDNA→ASCII (punycode)**, reject syntactically-invalid hosts and any embedded port/userinfo. Match `ALLOWED_BEACON_HOST_SUFFIXES` (`*.0xhoneyjar.xyz`, `*.up.railway.app`, `*.vercel.app`) by **exact host OR dot-boundary suffix** (`x.0xhoneyjar.xyz` ✓; `evil0xhoneyjar.xyz`, `0xhoneyjar.xyz.evil.tld`, trailing-dot/case/punycode variants ✗). Non-match → `host_not_allowlisted`, no fetch.
3. **DNS resolve + complete private-range reject** (c) [SKP-003]: `dns.lookup(host,{all:true})`; reject if ANY resolved A/AAAA is in the **complete blocked set** — IPv4: 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (incl. 169.254.169.254 metadata), 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, multicast 224/4, 240/4; IPv6: ::1, ::, ::ffff:0:0/96 (**IPv4-mapped — unwrap + re-check v4**), fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast). Resolution failure → `unreachable`. Reject → `resolved_private`.
4. **IP-pinned fetch** (CRITICAL) [SKP-001, severity 835]: connect ONLY to the validated resolved IP — no re-resolution at connect time (closes the rebinding TOCTOU). Impl: an `undici` Agent (or `https.Agent`) with a pinned `lookup`/`connect` returning the validated address, **TLS SNI + cert hostname preserved** (verify against the original host, connect to the IP). If the fetch stack cannot pin the connected address, FALL BACK to documented residual-risk + operator acceptance (do NOT ship an unpinned fetch silently). Redirects stay `manual` + host-pinned (existing).
5. **size cap** (d) — 256KB → oversize → `beacon_invalid` (classification name `beacon_invalid`, detail `oversize` [SKP IMP-009]).

Errors never carry body/headers. Existing redirect-manual/host-pin/timeout kept.
**Accept** (conformance vectors S1-T2 + unit): http→scheme_rejected; suffix-bypass set (`0xhoneyjar.xyz.evil.tld`, `evilcluster`, trailing-dot, UPPERCASE, punycode)→host_not_allowlisted, no fetch; each private range (v4 + v6 + IPv4-mapped) resolving→resolved_private, no fetch (DNS mocked); **DNS-rebinding test** — precheck resolves public, connect-time would resolve private → the pinned-IP fetch connects to the validated (public-in-test) address, and a mismatch is rejected; oversize→beacon_invalid; off-host redirect→void; error-detail never a body substring. Existing doctor tests stay green.

### S1-T4 — `freeside-cli inspect` un-stub (freeside-cli)
Rewrite `packages/freeside-cli/src/verbs/inspect.ts` (SDD D2): resolve slug (unknown→exit 1 + available list, FR-11), `probeBeacon`+`classifyProbe` with `hardenBeaconFetch`, `loadBeaconFromText`/`validateBeaconV3` when valid, `buildOrientationPacket`, emit single-line JSON. Flags: `--pretty`, `--raw` (SDD IMP-004 no-leak: raw null on non-valid). Exit-code table `src/lib/exit-codes.ts` (SDD D5 — the enumerated 0/1/2/3/4/5 map, one const [flatline IMP-003]). Error JSON shape is fixed `{error, classification?, slug?, available_slugs?, detail}` [flatline IMP-007]. Update `bin/freeside-cli.ts` usage + dispatch. doctor + inspect share the SAME classifier/guard code (one `hardenBeaconFetch` + one classifier), not parallel copies [flatline IMP-004].
**Accept**: contract tests via injected fetcher (no live network) — happy (valid fixture→full packet exit 0), each classification→exit row (0/2/3/4/5), unknown slug→exit 1+list, `--raw` valid vs non-valid, `--pretty`. Verdict agrees with doctor for the same cell (G-5).

### S1-T5 — CLAUDE.md reach pointer (inspect-only this PR)
Add the ~50-token pointer (SDD D7) to `CLAUDE.md` §"Ecosystem Navigation" — referencing **`freeside-cli inspect <slug>`** only (NOT `loa model` — that's the step-4 flip after PR-B, SDD §3.4). Honest: names only what exists on PR-A land.
**Accept**: pointer present in the nav block; references only `freeside-cli inspect`; ≤~50 tokens; no forward-reference to an unbuilt command.

### S1-T6 — Wire + verify (freeside-cli)
`pnpm build` + `pnpm typecheck` + full `pnpm test` green (beacon-schema + freeside-cli); the conformance suite runs from freeside-cli's side.
**Accept**: all green; `tools/check-beacon-domain.sh` → network-only (zero platform paths); grep-assert no live-network in default test run.

**Sprint 1 verification**: beacon-schema + freeside-cli suites green; commit scope `network/*`; PR contains zero `packages/services/**` (platform) paths — `tools/check-beacon-domain.sh` mechanically.

## Cross-repo follow-on — PR-B: `loa model` (external loa-cli, operator-gated — NOT this `/run`)

> Runs in `~/Documents/GitHub/loa-cli`, after PR-A lands. Documented here for traceability; implemented + reviewed in that repo (operator-gated merge, NFR-2). Its acceptance is the SAME conformance vectors (S1-T2), copied in with a checksum-pinned drift check.

- **F-1**: `lib/model.mjs` + `bin/loa.mjs` `model` case — read-only (no run/pipe). Ports the D3 guards (identical rules) + builds the same `OrientationPacket` shape in pure mjs. `loa model <slug> --brief`.
- **F-2**: loa-cli conformance test drives the mjs mirror through the copied `orientation-conformance.json` (checksum must match beacon-schema's — stale copy fails). Every classification + guard vector passes.
- **F-3** (step-4 flip, tiny commit back on loa-freeside): once PR-B merges + parity green, add `loa model … --brief` to the CLAUDE.md pointer + `/recall` orientation (the phantom resolves). Partial-rollout invariant: only after the command exists.

## Post-cycle
- **G-1 kill-test** (PRD pre-registered): after PR-A land — fresh agent + the ~50-token pointer + one grep-forcing cross-building question; measure unprompted reach (≥2/3 trials) + steering-token delta vs grep baseline. Operator-run, recorded.

## Goal traceability
| Goal | Delivered by |
|------|--------------|
| G-1 | S1-T5 pointer + post-cycle kill-test |
| G-2 | S1-T4 (inspect consumes the live beacon) |
| G-3 | Follow-on F-1 (loa model exists) + F-3 (pointer flip) |
| G-4 | S1-T1 null-field policy + S1-T3/T4 honest classification |
| G-5 | S1-T4 verdict==doctor + S1-T2 conformance suite |
