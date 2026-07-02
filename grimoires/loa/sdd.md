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

### D0 — `buildOrientationPacket` contract (flatline-SDD IMP-002/IMP-006)
The pure builder `buildOrientationPacket(registryEntry, probe, beacon?)` has a defined input+output contract, since both repos depend on it:
- **Input**: `registryEntry` (always — slug/deployment_url/runtime_state); `probe: BeaconProbe` (always — the classification + target); `beacon?: BeaconV3` (present ONLY when `probe.classification === 'beacon_valid'`).
- **Missing-field policy** (IMP-006): if `beacon` is absent OR any BeaconV3 optional field is absent, the corresponding packet field is `null` — NEVER partial-filled from an invalid/partial beacon (an invalid beacon → `beacon_invalid` classification, ALL beacon fields null, packet still returned). A packet never presents unvalidated beacon data as authoritative.
- **Output**: a total `OrientationPacket` (D1) — the function is total (never throws; a bad input → a packet with the right verdict).

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
6. Emit single-line JSON (`--pretty` human-formats).

**`--raw` semantics** (flatline-SDD IMP-004): on `beacon_valid`, `--raw` returns the raw fetched BeaconV3 JSON + the verdict block. On any non-valid classification, `--raw` returns `{raw: null, verdict}` — it NEVER emits an unvalidated/oversize/off-host body (the body was never read for void; is capped for oversize; NFR-6e no-leak holds for `--raw` too). Exit code is the classification's (D5) regardless of `--raw`.

NO new fetch/validate code — reuse the EXPORTED helpers only (no coupling to doctor internals, NFR).

**`verdict.detail` enumerated strings** (flatline-SDD IMP-005): a fixed set — `ok`, `scheme_rejected`, `host_not_allowlisted`, `resolved_private`, `off_host_redirect`, `not_found`, `not_a_beacon`, `invalid_beacon`, `oversize`, `timeout`, `transport_error`, `unknown_slug`. Agent-parseable; never contains a response body/header substring. One-to-one-ish with classification (a classification may carry a more specific detail, e.g. `beacon_unreachable` + `timeout` vs `+ scheme_rejected`).

### D3 — SSRF hardening in the shared fetcher (BLOCKER SKP-004 + flatline-SDD SKP-001 → NFR-6)
`defaultBeaconFetcher` [CODE:doctor.ts:203] already does redirect:manual + host-pin + off-host→void + 12s timeout. ADD, INTO it (benefits `doctor --remote` too):
- (a) **https-only**: reject non-https `beacon_url` before fetch → status-0 `scheme_rejected`.
- (b) **Registry-host allowlist** [flatline SKP-001 — the primary control]: a beacon_url host MUST match the allowlist of cluster-controlled domain suffixes (`*.0xhoneyjar.xyz`, `*.up.railway.app`, `*.vercel.app` — sourced from a single `ALLOWED_BEACON_HOST_SUFFIXES` const, not scattered). `beacon_url` is registry-controlled, so an allowlist means even a compromised registry entry cannot point the fetcher at `169.254.169.254`/internal — it must be a known cluster host. Non-allowlisted host → status-0 `host_not_allowlisted`. This is the load-bearing SSRF control; the literal-IP + DNS checks below are defense-in-depth.
- (c) **DNS pre-resolution private-range reject** [flatline SKP-001]: `dns.lookup(host, {all:true})` BEFORE fetch; if ANY resolved A/AAAA record is private/loopback/link-local/metadata (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 incl. 169.254.169.254, ::1, fc00::/7), refuse → status-0 `resolved_private`. Closes the public-hostname→private-IP hole that literal-IP-only checks miss. Residual TOCTOU between lookup and fetch is bounded by (b)'s allowlist (a cluster host won't flip to internal) — documented, not hand-waved.
- (d) **size cap**: read the body with a byte cap (256KB) → oversize → `beacon_invalid`.
Existing redirect:manual + host-pin + timeout kept. Errors never echo body/headers (NFR-6e). Fetcher stays injectable (NFR-5). **These guards ship as one `hardenBeaconFetch(url)` pre-check helper** so freeside-cli and the loa-cli mjs mirror apply IDENTICAL rules from ONE spec (the conformance suite D6 enforces parity of the guards, not just the packet).

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

### D6 — shared conformance vector suite (FR-8 + flatline-SDD SKP-002 + IMP-003)
Two implementations are unavoidable (loa-cli is zero-dep pure-`.mjs`, Finn-safe standalone — it CANNOT import the TS beacon-schema; this is a deliberate architecture constraint, not laziness). Full code-dedup is precluded, so drift is bound LOUDLY by a **canonical machine-readable conformance-vector suite** — not one happy-path fixture:

- `packages/beacon-schema/test-vectors/orientation-conformance.json` — versioned WITH beacon-schema. Each vector: `{name, input: {registry_entry, fetch_result (status/finalUrl/body) OR fetch_error}, expect: {packet, classification, exit_code}}`. Covers **every** classification + hardening case: valid, dark(404/non-beacon), void(off-host), invalid(bad-V3/oversize), unreachable(timeout), scheme_rejected, host_not_allowlisted, resolved_private, unknown-slug.
- **Both repos are required consumers**: freeside-cli's test drives its builder+fetcher-guards through every vector; loa-cli's mjs test drives its mirror through the SAME committed vectors (copied in, with a checksum-pinned drift check: the loa-cli copy's sha256 must match beacon-schema's — a stale copy fails). A security-guard fix that lands in one repo but not the other fails the other's vector run.

This makes the mirror's security guards (D3) conformance-tested, not just the packet shape.

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

### 3.4 pointer (network domain — landed in PR-A referencing `inspect` only; `loa model` added at step 4)
To eliminate the release-sequencing contradiction (flatline-SDD IMP-001): PR-A's CLAUDE.md pointer references **only `freeside-cli inspect`** (which exists on PR-A land). The `loa model` reference is added by the **step-4 flip commit**, AFTER PR-B merges + parity is green. At no point does the pointer name a command that doesn't yet exist (partial-rollout invariant). §4 is the single source of truth for ordering; there is no "honesty note" interim state.

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
| https-only beacon fetch | `hardenBeaconFetch` (D3a) | conformance vector: http:// → `scheme_rejected`, no fetch |
| **registry-host allowlist** (primary SSRF control) | `hardenBeaconFetch` (D3b) | vector: non-cluster host → `host_not_allowlisted`, no fetch — BOTH repos |
| **DNS resolves-to-private reject** | `hardenBeaconFetch` (D3c) | vector: host resolving to 169.254.169.254 / 10.x → `resolved_private`, no fetch |
| host-pin + off-host→void | doctor (existing, reused) | vector: off-host redirect → `beacon_void` exit 5 |
| size cap + timeout | `hardenBeaconFetch` (D3d) | vector: oversize → `beacon_invalid`; hung → timeout → `beacon_unreachable` |
| no body/header in errors | packet.verdict.detail (enumerated) | vector: detail ∈ fixed set, never a body substring |
| guard parity across repos | conformance vector suite (D6) | both freeside-cli + loa-cli run the SAME vectors; checksum-pinned copy |
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
