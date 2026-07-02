# Product Requirements Document — First Live Beacon Consumer (keyed building→orientation READ)

> Cycle: beacon-consumer. Produced by `/plan-and-analyze` 2026-07-02 from the microlight-swarm recon (11 estates surveyed) + operator direction pick + 3 load-bearing interview forks.
> Grounding brief: `grimoires/loa/context/2026-07-02-beacon-consumer-direction.md`. Working branch: `cycle/beacon-consumer` (off origin/main).
> Codebase grounding: `/ride` skipped — the reality/ files are governance-quarantined corpses (`do_not_use_for_action`, monolith capture); the specific cell-level code facts were grounded directly and are cited inline [CODE:...].

## 1. Problem Statement

Freeside declares building capabilities via **BeaconV3 beacons** — but nothing live reads them. An agent (or the operator) who wants to know *what a building is and whether it can be used* has no keyed read path:

- `freeside-cli inspect <slug>` is an explicit **STUB** — "beacon fetch + BeaconV3 validation deferred to follow-up cycle" — it returns `{beacon_url, note:STUB}` and never fetches or renders [CODE:packages/freeside-cli/src/verbs/inspect.ts:10,35].
- **`loa model` does not exist** — the launcher surface is `caps/where/run/pipe/policy/doctor/census` (+ operator-only `signoff/council`); there is no `model` command. Yet the governed `/recall` orientation *tells the agent to run* `→ loa model freeside --brief` as "the full keyed packet." It returns empty. The recall points at a phantom.

This is the cluster's **signature failure — deployed-but-unconsumed** (operator-validated, `recall` rank-156): **~8 cells DECLARED BeaconV3 beacons** (score/sonar/storage/mint/activities/inventory/identity/mediums, per loa-freeside #236) but **no live agent-facing reader consumes them** [CODE:packages/freeside-registry/registry.yaml — 11 module entries, ~8 with real `beacon_url`]. The declaration was built; the consumption path was not. The same gap recurs at the orientation layer (`loa model --brief` empty) and is documented across memory as *recall is fuzzy similarity; orientation needs a KEYED lookup* (`project_recall-is-similarity-not-orientation`).

Consequence: agents demonstrably bypass `loa` and grep `registry.yaml`, getting stale hand-authored fields instead of a building's live operational surface — the ADR-011 §D-5 consumption-gradient violation, inside the binding doc itself.

> Sources: swarm recon 2026-07-02 (agent-awareness tile); brief §Verified ground truth; inspect.ts:10,35; registry.yaml; `/recall` orientation output.

## 2. Vision

Consume the built thing with one live reader. A **keyed building→orientation READ** that fetches a cell's declared BeaconV3 beacon, distills it into an agent-drivable orientation packet, and reports an honest reachability+validity verdict — graduating all ~8 already-deployed beacons from documentation-grade to agent-drivable **in one 1-cycle, reversible cut, building no new surface**.

This is the **read half** of the agent-native cluster-drive capability. The callable Hyper-style building API (#253 — the *drive* half) layers on top **after** this read surface exists (§7 non-goals). It is the cut-vertex: "can an agent read/drive a building natively" blocks on this reader.

Doctrine alignment (recalled, `background_only` orientation): the false-trichotomy layering — CLI/MCP/Code-Mode are presentation/composition/execution layers, not competitors (`goal-4-freeside-code-mode`); this cycle is the **execution-substrate read primitive** the typed-SDK layer later compiles down to. Reuse over rebuild: `doctor.ts` already fetches, host-pins, and BeaconV3-validates (`probeBeacon`/`classifyProbe`/`loadBeaconFromText`/`validateBeaconV3` [CODE:packages/freeside-cli/src/verbs/doctor.ts:249,184,27,31]) — the reader composes these, it does not reinvent them.

> Sources: brief §Thesis/§Why; goal-4-freeside-code-mode; doctor.ts exports; Phase-fork 1–3.

## 3. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | **Unprompted keyed reach** (the kill-test) | An agent given only the ~50-token orientation pointer reads a building's surface via the new verb **unprompted** (not grep), in **fewer steering tokens** than the grep-`registry.yaml` baseline. Goal-4 de-risk kill-test shape. |
| G-2 | **Live beacon consumed** | `freeside-cli inspect <slug>` fetches the declared beacon, renders the distilled packet, and reports a validity+reachability verdict — no longer a stub, for every beacon-declaring cell. |
| G-3 | **Keyed orientation command exists** | `loa model <building> --brief` returns the keyed orientation packet (the phantom the recall points at now resolves). |
| G-4 | **Honest degradation** | Where a cell's beacon subdomain 404s/503s (most do today), the reader reports `beacon dark/unreachable` with the declared target — never a false-green or a crash (reuses doctor's `beacon_dark` classification). |
| G-5 | **Packet verdict == doctor verdict** | The packet's validity verdict agrees with `doctor`'s for the same cell (one source of truth for "is this beacon valid"). |

**Headline metric** (G-1, restated): reaching a building's operational surface drops from *grep registry.yaml + parse stale hand-authored fields* to **one keyed read**, and an agent reaches for it without being told.

> Sources: Phase-fork 3 (operator: unprompted-reach + fewer-tokens); goal-4 kill-test; swarm agent-awareness opportunity.

## 4. Users & Stakeholders

| Persona | Relationship | Needs |
|---------|--------------|-------|
| **Agents** (Claude Code / Codex sessions) | PRIMARY | One keyed call that answers "what is this building, what does it do, can I use it right now" — distilled, not a raw beacon to parse; honest when the beacon is dark. |
| **Operator** | orientation consumer | `loa model <building> --brief` as the keyed packet the recall already advertises; the recall→orientation gap closed. |
| **The `/recall` host** | downstream | Its orientation pointer (`→ loa model … --brief`) stops being a phantom — the governed route resolves. |
| **Future typed-SDK / Code-Mode layer** | derivative | The read primitive it compiles down to (`goal-4`). Not built here; the shape must not preclude it. |

> Sources: brief §User-truth hypothesis; Phase-fork 1; goal-4.

## 5. Functional Requirements

### 5.1 `freeside-cli inspect` un-stub (network domain, in-repo)

| FR | Requirement |
|----|-------------|
| FR-1 | `freeside-cli inspect <slug>` resolves the cell's `beacon_url` from the registry, **fetches** the beacon (reusing `doctor.ts`'s `probeBeacon` fetcher + host-pinning [CODE:doctor.ts:249]), and **BeaconV3-validates** it (`loadBeaconFromText`/`validateBeaconV3` [CODE:doctor.ts:27,31]). No new fetch/validate code — compose the existing machinery (surgical, DRY). |
| FR-2 | **Distilled orientation packet** (operator-chosen output, Phase-fork 2): render `{slug, publisher, is, is_not, capabilities, composes_with (belts), cycle_state (maturity), transport (mcp/cli)}` [CODE:packages/beacon-schema/src/beacon-v3.ts — these are the declared BeaconV3 fields] PLUS a `verdict` block: `{reachable, beacon_valid, validity_detail, deployed (registry runtime_state + deployment_url)}`. This answers "what is this + can I use it" in one read. |
| FR-3 | **`--raw` flag** returns the raw fetched BeaconV3 JSON (the agent parses it itself) — the escape hatch beneath the distillation. |
| FR-4 | **Honest degradation** (G-4): a beacon that 404s / redirects off-host / fails V3 decode renders `verdict.reachable:false` / `beacon_valid:false` with doctor's classification (`beacon_dark`/`beacon_void`/`beacon_invalid`), the declared target, and a non-zero exit code — never a false-green, never a crash. |
| FR-5 | Output is single-line JSON by default (loa-cli agent-friendly convention); a `--pretty` flag human-formats. Exit codes distinguish ok / not-found-slug / beacon-unreachable / beacon-invalid. |

### 5.2 `loa model <building> --brief` keyed command (external loa-cli repo)

| FR | Requirement |
|----|-------------|
| FR-6 | Add a `model` verb to the `loa` launcher [external: `~/Documents/GitHub/loa-cli/bin/loa.mjs` + `lib/`]. `loa model <building> --brief` returns the SAME distilled orientation packet (FR-2) for the named building, read from the same registry beacons. |
| FR-7 | The `model` read composes the registry + beacon read (slotting beside `census`/`doctor` in `lib/`); it is a **discovery/read verb** — it MUST NOT open a new mutate/dispatch path (loa-cli anti-corruption rule: the SDK exposes only discovery, never `run`/`pipe`). |
| FR-8 | **Packet parity**: the `loa model` packet and the `freeside-cli inspect` packet are the SAME shape for the same cell (one contract, two surfaces). A shared shape check pins this (differential, not two hand-authored renderers drifting). |
| FR-9 | Update the binding orientation pointer: the `/recall` orientation + CLAUDE.md reference to `loa model … --brief` now points at a real command (close the phantom). |

### 5.3 The ~50-token pointer (G-1 substrate)

| FR-10 | A fixed ~50-token always-loaded pointer that tells an agent the reach reflex: "Freeside building? `loa model <slug> --brief` (or `freeside-cli inspect <slug>`) reads its beacon — what it is, does, and whether it's usable — in one call." This is the *social half* of adoption (goal-4 weakest-link: ergonomic surface alone doesn't cure adoption; the agent must KNOW to reach). |

> Sources: Phase-fork 1 (both repos), fork 2 (distilled packet); doctor.ts reuse; beacon-v3.ts fields; goal-4 pointer + no-bypass rule; loa-cli anti-corruption rule (README).

## 6. Non-Functional Requirements

| NFR | Requirement | Grounding |
|-----|-------------|-----------|
| NFR-1 | **ADR-007 firewall**: freeside-cli work is `network/` domain — single-domain PR; loa-cli work is a separate external-repo PR (can't share a branch). Two PRs, coordinated. | CLAUDE.md Hard rules; Phase-fork 1 |
| NFR-2 | **loa-cli merge is operator-gated** — never admin-merge the loa-cli PR past operator review. | `feedback_loa-dispatch-changes-operator-gated` |
| NFR-3 | **Zero-dep discipline** on both surfaces: freeside-cli's switch-dispatch + hand-rolled guards; loa-cli's pure-`.mjs`, Finn-safe, no new deps. | freeside-cli + loa-cli house patterns |
| NFR-4 | **No-bypass / read-only**: the `model` verb and `inspect` are pure reads — no mutation, no dispatch, no proof-of-run act-verb. | loa-cli anti-corruption rule; goal-4 no-bypass |
| NFR-5 | **Deterministic + testable**: fetch is injectable (doctor already injects `BeaconFetcher` for network-free tests); tests never hit the live network by default. | doctor.ts:249 (injected fetcher) |

## 7. Scope & Prioritization

### In scope (this cycle)
1. FR-1..5 — `freeside-cli inspect` un-stub → distilled packet + honest degradation (network PR).
2. FR-6..9 — `loa model <building> --brief` keyed command + packet parity + pointer fix (loa-cli PR).
3. FR-10 — the ~50-token reach pointer.

### Deferred (fast-follow, with triggers)
| Item | Why deferred | Trigger |
|------|--------------|---------|
| Callable Hyper-style building API #253 (the *drive* half) | This cycle is the *read* surface; drive layers on top | Read surface proven (G-1 passes) |
| Beacon-serving routes + DNS on cells (subdomain 404s) | Per-cell deploy concern; the reader degrades honestly meanwhile (G-4) | A cell needs live-discoverable beacon |
| BeaconV3 CI validators #232/#233, composes_with hash recompute #231 (OD-2) | Network hygiene, adjacent not blocking | Separate network-hygiene track |
| Typed-SDK / Code-Mode veneer over the read primitive | Layers on the execution substrate later (goal-4) | Read primitive stable + adoption proven |

### Non-goals (explicit)
- Not building any new building capability — this consumes existing declarations only.
- Not fixing the score-api beacon 503 or the gateway `/healthz`-path probe mismatch (swarm surfaced these — the reader will *expose* them via honest verdicts, which is the point; fixing them is a separate cell-deploy fix).
- Not the mutate/dispatch path (`loa run/pipe`) — read-only.

> Sources: Phase-fork 1; brief §Non-goals; #253; swarm score-api tile.

## 8. Risks & Dependencies

| Risk | Impact | Mitigation |
|------|--------|------------|
| Beacon subdomains 404/503 for most cells today | The reader returns "dark" for most cells → looks like it doesn't work | G-4 honest degradation IS the correct behavior; the packet still renders registry-known fields (slug, capabilities from registry) + an honest reachability verdict. Frame "dark" as truth, not failure. |
| Packet shape drifts between the two repos | `inspect` and `loa model` diverge → two contracts | FR-8 shared-shape differential check; define the packet type once (in beacon-schema or a shared shape) and mirror. |
| loa-cli is an external repo not in this working tree | Can't build/test it here | Coordinate: freeside-cli PR is self-contained; loa-cli PR authored + tested in `~/Documents/GitHub/loa-cli`, operator-gated merge (NFR-2). |
| Reusing doctor.ts couples inspect to doctor internals | Refactor risk | Reuse only the EXPORTED helpers (`probeBeacon`/`classifyProbe`/`loadBeaconFromText`/`validateBeaconV3`) — already public; no new coupling to private internals. |
| G-1 (unprompted reach) is a behavioral metric, hard to certify | The kill-test may be soft | Run the goal-4 de-risk shape: give an agent ONLY the pointer + a real cross-building question, measure reach + steering tokens vs. grep baseline. Pre-register the pass bar. |

### Dependencies
- `packages/freeside-cli/src/verbs/doctor.ts` (exported fetch/validate helpers), `packages/beacon-schema` (BeaconV3 type), `packages/freeside-registry` (beacon_url resolution).
- External `~/Documents/GitHub/loa-cli` (`bin/loa.mjs` + `lib/`) for FR-6..9.
- The ~8 beacon-declaring cells' registry entries (the read targets).

---

> **Traceability**: every requirement cites a code location ([CODE:file:line], grounded 2026-07-02), the swarm recon (agent-awareness tile), the direction brief, or an interview fork (Phase-fork 1 scope, 2 output, 3 metric — all operator-answered). The `/ride` corpse was deliberately not used; cell-level facts grounded directly.
