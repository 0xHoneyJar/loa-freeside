# Sprint Plan — First Live Beacon Consumer

> Cycle: beacon-consumer. Implements `sdd.md` §4 delivery plan (flatline-reviewed PRD+SDD). Branch: `cycle/beacon-consumer` worktree (off origin/main).
> **Sprint 1 = PR-A (in-repo, `network/` domain) — the `/run` target.** The loa-cli work (PR-B) is a **cross-repo follow-on** run in the external `~/Documents/GitHub/loa-cli` repo, operator-gated (NFR-2); it is NOT a `/run`-here sprint (this worktree can't build/test loa-cli). Release order: PR-A → PR-B → parity → pointer flip (SDD §4).

## Sprint 1 — PR-A: beacon-schema packet + freeside-cli inspect un-stub + SSRF hardening (network domain)

**Goal**: `freeside-cli inspect <slug>` fetches, distills, and honestly verdicts a cell's beacon — reusing doctor's machinery, SSRF-safe, conformance-tested. (G-2, G-4, G-5; enables G-1)

### S1-T1 — `OrientationPacket` type + `buildOrientationPacket` (beacon-schema)
`packages/beacon-schema/src/orientation-packet.ts`: the `OrientationPacket` type (SDD D1) + the total pure builder `buildOrientationPacket(registryEntry, probe, beacon?)` (SDD D0 — missing-field policy: beacon fields null unless `beacon_valid`; never partial-fill; never throws). Export from index.
**Accept**: unit — valid input → full packet; `beacon_valid=false` inputs (dark/void/invalid/unreachable) → all beacon fields null + correct verdict; registry fields always present; builder is total (bad input → packet, no throw).

### S1-T2 — Shared conformance-vector suite (beacon-schema)
`packages/beacon-schema/test-vectors/orientation-conformance.json` (SDD D6): one vector per classification + hardening case (valid, dark, void, invalid, unreachable, scheme_rejected, host_not_allowlisted, resolved_private, oversize, timeout, unknown-slug), each `{name, input, expect:{packet, classification, exit_code}}`. Versioned with beacon-schema.
**Accept**: the JSON parses + is schema-checked; a beacon-schema test drives `buildOrientationPacket` (+ the D3 guard classifier) through EVERY vector and asserts `expect`. This suite is the drift alarm both repos consume.

### S1-T3 — SSRF hardening `hardenBeaconFetch` (freeside-cli, shared with doctor)
Add the D3 guards as one pre-check helper applied inside `defaultBeaconFetcher` [CODE:packages/freeside-cli/src/verbs/doctor.ts:203] (benefits `doctor --remote` too): (a) https-only, (b) **registry-host allowlist** `ALLOWED_BEACON_HOST_SUFFIXES` (primary SSRF control), (c) DNS pre-resolution private/metadata-range reject, (d) size cap. Keep existing redirect-manual/host-pin/timeout. Errors carry no body/headers.
**Accept**: unit + the T2 vectors — http→scheme_rejected (no fetch); non-cluster host→host_not_allowlisted (no fetch); host resolving to 169.254.169.254/10.x→resolved_private (no fetch, DNS mocked); oversize→beacon_invalid; off-host redirect still→void; no error-detail contains a body substring. Existing doctor tests stay green.

### S1-T4 — `freeside-cli inspect` un-stub (freeside-cli)
Rewrite `packages/freeside-cli/src/verbs/inspect.ts` (SDD D2): resolve slug (unknown→exit 1 + available list, FR-11), `probeBeacon`+`classifyProbe` with `hardenBeaconFetch`, `loadBeaconFromText`/`validateBeaconV3` when valid, `buildOrientationPacket`, emit single-line JSON. Flags: `--pretty`, `--raw` (SDD IMP-004 no-leak: raw null on non-valid). Exit-code table `src/lib/exit-codes.ts` (SDD D5). Update `bin/freeside-cli.ts` usage + dispatch.
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
