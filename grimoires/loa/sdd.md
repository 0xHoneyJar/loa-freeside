# Software Design Document — First Live Beacon Consumer (keyed building→orientation READ)

> `/simstim` Phase 3. Implements `grimoires/loa/prd.md` (beacon-consumer cycle, flatline-reviewed: 11 integrated, 3 blockers resolved). Branch `cycle/beacon-consumer` (off origin/main).

## 1. Architecture Overview

No new services, no new building. One typed packet, two read surfaces, one honest fetcher — composing machinery that already exists.

```mermaid
flowchart LR
  A[agent / operator] -->|"freeside-cli inspect <slug>"| I[inspect.ts un-stub]
  A -->|"loa model <slug> --brief"| M[loa-cli lib/model.mjs]
  I --> P[OrientationPacket builder]
  M --> P2[OrientationPacket builder (mjs mirror)]
  P --> S[(OrientationPacket type<br/>@freeside/beacon-schema — single owner)]
  P2 -.parity differential.-> S
  P --> F[hardenedBeaconFetcher<br/>reuse doctor: redirect-manual + host-pin + timeout<br/>+ NEW: https-only, private-IP block, size cap]
  F --> R[registry beacon_url]
  P --> V[verdict: probeBeacon→classifyProbe + validateBeaconV3]
```

The packet is a value; both surfaces build the same value; a parity differential pins them. The reader consumes the ~8 already-declared beacons; it builds no capability.

## 2. Design Decisions

### D1 — `OrientationPacket`: single-owned type in `@freeside/beacon-schema`
The packet shape lands ONCE in `packages/beacon-schema/src/orientation-packet.ts`, exported from the index [CODE:packages/beacon-schema/src/index.ts]. freeside-cli imports it directly (it already depends on beacon-schema). Shape:

```ts
interface OrientationPacket {
  slug: string;
  // beacon-derived (null when dark):
  publisher: string | null;
  is: string | null;
  is_not: string[] | null;         // anti-scope (≥2 when present)
  capabilities: string[] | null;
  composes_with: Record<string, string> | null;  // sibling → Tag@ver+hash (belts)
  cycle_state: string | null;      // maturity
  transport: { mcp: boolean; cli: boolean } | null;
  // registry-derived (ALWAYS present — FR-2a):
  deployment_url: string | null;   // from registry
  runtime_state: string;           // deployed/scaffolded/not-built
  // verdict (ALWAYS present):
  verdict: {
    reachable: boolean;
    beacon_valid: boolean;
    classification: 'beacon_valid'|'beacon_dark'|'beacon_void'|'beacon_invalid'|'beacon_unreachable';
    detail: string;                // human/agent-readable, no raw body/headers (NFR-6e)
    target: string;                // the declared beacon_url probed
  };
}
```
Beacon-only fields are `null` when dark — never stale-filled (FR-2a). A dark packet is valid + useful.

### D2 — `freeside-cli inspect` un-stub: compose doctor's exported machinery
Rewrite `packages/freeside-cli/src/verbs/inspect.ts` (currently a 37-line stub [CODE:inspect.ts:35]):
1. `loadRegistry()` → resolve the module entry; unknown slug → exit 1 + available-slug list (FR-11).
2. `probeBeacon(beacon_url, slug, hardenedFetcher)` [CODE:doctor.ts:249] → `BeaconProbe` (host-pinned, redirect-safe).
3. `classifyProbe(probe)` [CODE:doctor.ts:184] → `RemoteVerdict` → map to `classification` (D5).
4. If reachable+valid: `loadBeaconFromText`/`validateBeaconV3` [CODE:doctor.ts:27,31] → populate beacon fields.
5. Build `OrientationPacket` (registry fields always; beacon fields or null; verdict).
6. Emit single-line JSON (`--pretty` human-formats; `--raw` returns raw beacon JSON + verdict).

NO new fetch/validate code — reuse the EXPORTED helpers only (no coupling to doctor internals, NFR).

### D3 — SSRF hardening in the shared fetcher (BLOCKER SKP-004 → NFR-6)
`defaultBeaconFetcher` [CODE:doctor.ts:203] already does redirect:manual + host-pin + off-host→void + 12s timeout. ADD three guards INTO it (benefits `doctor --remote` too — a deliberate, tested improvement):
- (a) **https-only**: reject non-https `beacon_url` before fetch → status-0 result with detail `scheme_rejected`.
- (c) **private/loopback/link-local block**: resolve the target host; if it's a literal private IP (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1) or `localhost`, refuse → status-0 `private_target_blocked`. (Literal-IP + hostname-literal check; full DNS-rebind defense noted as a `loa:shortcut` ceiling — the host-pin already blocks the classic rebind-after-redirect vector.)
- (d) **size cap**: read the body with a byte cap (e.g. 256KB) → oversize truncates to `beacon_invalid` rather than buffering unbounded.
Existing redirect:manual + host-pin + timeout (b/d-timeout) are kept as-is. Errors never echo body/headers (NFR-6e). The fetcher stays injectable (tests pass a fake — never live network by default, NFR-5).

### D4 — `loa model <building> --brief`: mirror in external loa-cli (pure mjs)
New `lib/model.mjs` + a `model` case in `bin/loa.mjs` [external: `~/Documents/GitHub/loa-cli`]. loa-cli is zero-dep pure-`.mjs` and CANNOT import the TS beacon-schema, so it re-implements the read in mjs: read the registry entry, fetch the beacon with the SAME hardening rules (https-only, host-pin, redirect-manual, private-IP block, timeout, size cap — ported, not imported), lighter BeaconV3 validation (JSON parse + required-field presence: slug/publisher/is/is_not/cycle_state), and build the SAME `OrientationPacket` shape. It is a **discovery/read verb** — no `run`/`pipe`/dispatch, no proof-of-run (loa-cli anti-corruption rule, NFR-4). `--brief` is the packet; without it, a fuller render is allowed later (out of scope).

### D5 — classification → exit-code map (FR-4a/FR-5a)
| doctor RemoteVerdict / state | packet.classification | exit |
|---|---|---|
| valid beacon, slug match | `beacon_valid` | 0 |
| (unknown slug) | — | 1 |
| transport fail / timeout / scheme_rejected / private_target_blocked | `beacon_unreachable` | 2 |
| fetched, V3 decode/validate fails / oversize | `beacon_invalid` | 3 |
| correct host, 404 / non-BeaconV3 body | `beacon_dark` | 4 |
| off-host redirect | `beacon_void` | 5 |
One table, both surfaces (D6 pins it).

### D6 — parity differential (FR-8)
`packages/freeside-cli/src/verbs/__tests__/orientation-parity.test.ts`: render a FIXTURE cell's beacon through the freeside-cli packet builder; assert it deep-equals the `OrientationPacket` schema shape (strict). The loa-cli side ships its own parity test in the loa-cli repo asserting its mjs builder produces the byte-identical packet for the same fixture beacon. The fixture beacon + expected packet live in a shared test fixture (committed in freeside-cli; copied into loa-cli's test dir). Drift on either side fails its repo's test.

### D7 — the ~50-token reach pointer (FR-10/10a)
Text: *"Freeside building? `loa model <slug> --brief` (or `freeside-cli inspect <slug>`) reads its beacon — what it is, does, composes with, and whether it's usable — in one call. Prefer it over grepping registry.yaml."* Home: `loa-freeside/CLAUDE.md` §"Ecosystem Navigation" block. Landed in release step 4 (the pointer-flip), never before `loa model` exists.

## 3. Component Design

### 3.1 beacon-schema (network domain, PR-A)
`orientation-packet.ts` — the `OrientationPacket` type + a builder helper `buildOrientationPacket(registryEntry, probe, beacon?)` that both freeside-cli imports and loa-cli mirrors. Pure, no I/O.

### 3.2 freeside-cli (network domain, PR-A)
- `inspect.ts` — un-stubbed (D2), imports `buildOrientationPacket` + doctor's `probeBeacon`/`classifyProbe`/`loadBeaconFromText`/`validateBeaconV3`.
- `doctor.ts` — `defaultBeaconFetcher` gains the D3 SSRF guards (shared improvement).
- exit-code table constant (D5) in a small `src/lib/exit-codes.ts` shared by inspect (+ future verbs).
- `bin/freeside-cli.ts` usage text updated for the enriched `inspect`.

### 3.3 loa-cli (EXTERNAL repo, PR-B, operator-gated)
- `lib/model.mjs` (D4) + `bin/loa.mjs` `model` case + usage. Parity test + fixture.

### 3.4 pointer (network domain, PR-A — but flipped LAST per release order)
`CLAUDE.md` navigation-block edit (D7). Committed in PR-A but the PR is sequenced so the pointer text lands only after loa-cli deploys — OR (simpler) the pointer references `freeside-cli inspect` on land and adds `loa model` in a tiny follow-up commit once PR-B merges. **Chosen**: pointer lands referencing BOTH but with a one-line "loa model available once loa-cli#<n> merges" honesty note removed in the flip. (Release ordering §4.)

## 4. Delivery Plan (PRD §7.0 — strict order, ADR-007)

| Step | PR | Domain | Contents |
|------|----|--------|----------|
| 1 | **PR-A** | `network/` (beacon-schema + freeside-cli + CLAUDE.md) | OrientationPacket type + builder, inspect un-stub, SSRF hardening, exit-code table, parity test + fixture, pointer (referencing inspect; loa model noted as pending) |
| 2 | **PR-B** | external loa-cli | `loa model` verb, mjs mirror, parity test against the same fixture |
| 3 | — | — | verify parity green both sides (same fixture → same packet) |
| 4 | tiny follow-up on PR-A's branch or a doc commit | `network/` | flip the CLAUDE.md pointer + `/recall` orientation to reference `loa model … --brief` as live |

Rollback: PR-A stands alone (inspect useful without loa-cli); PR-B independently revertable; the pointer only ever names a command that exists in the deployed state (partial-rollout invariant, PRD §7.0).

## 5. Security
| Control | Where | Test |
|---------|-------|------|
| https-only beacon fetch | `defaultBeaconFetcher` (D3) | unit: http:// url → `beacon_unreachable`/scheme_rejected, no fetch |
| host-pin + off-host→void | doctor (existing, reused) | unit: off-host redirect → `beacon_void` exit 5 (existing doctor test covers; add inspect-level) |
| private/loopback block | `defaultBeaconFetcher` (D3) | unit: 127.0.0.1 / localhost / 10.x beacon_url → blocked, no fetch |
| size cap + timeout | `defaultBeaconFetcher` (D3) | unit: oversize body → `beacon_invalid`; hung fetch → timeout → `beacon_unreachable` |
| no body/header in errors | packet.verdict.detail | unit: error detail never contains response body substrings |
| read-only (no dispatch) | inspect + loa model | design review: no run/pipe/mutate path |

## 6. Testing (network-free by default)
- **PR-A**: unit — inspect happy (valid beacon fixture → full packet exit 0), each classification/exit-code row (dark/void/invalid/unreachable), unknown-slug exit 1 + list, dark-packet field semantics (beacon fields null, registry fields present), SSRF guards (§5), parity differential (D6), `--raw`/`--pretty`. All via injected fetcher — no live network.
- **PR-B** (loa-cli): mjs unit — same classification rows + the parity test against the shared fixture.
- **G-1 kill-test** (PRD pre-registered): post-merge, operator-run — fresh agent + pointer + one grep-forcing cross-building question; measure unprompted reach (≥2/3) + steering-token delta vs grep. Recorded, not a code test.

## 7. Traceability
| PRD | Design | Test |
|-----|--------|------|
| FR-1/2/2a/3/4/4a | D1, D2, D5 | classification rows + dark-field semantics |
| FR-5/5a | D5 exit table, exit-codes.ts | per-row exit assertions |
| FR-6/7/8 | D4, D6 | parity differential (both repos) |
| FR-9/10/10a/11 | D7, §4 step 4, D2 slug | pointer land; unknown-slug test |
| NFR-1/2 | §4 two-PR split | domain check; operator-gated PR-B |
| NFR-6 (+SKP-004, IMP-011) | D3 | SSRF guard suite |
| G-1..G-5 | D2 (consume), D5 (honest verdict), D6 (verdict==doctor) | classification suite + kill-test |

## 8. Open Items (SDD-resolved; none block sprint)
- ~~Packet ownership across repos~~ → D1 (beacon-schema owns; loa-cli mirrors + parity). ~~SSRF policy~~ → D3. ~~Release ordering~~ → §4.
- `loa:shortcut` ceiling: full DNS-rebind defense deferred (host-pin covers the classic vector); upgrade if a cell's beacon_url ever resolves attacker-controlled.
- Deferred (PRD §7): #253 Hyper drive-API, beacon DNS/routes, BeaconV3 CI validators.
