---
status: candidate
created: 2026-07-02
author: microlight-swarm recon (11 agents) + operator direction pick
mode: arch
plannable: true
source_construct_affinity: [freeside-cli, loa-cli, beacon-schema, freeside-registry]
---

# Next-cycle direction — Ship the first live beacon consumer (keyed building→orientation READ)

> Operator-selected 2026-07-02 from a microlight-swarm recon across all Freeside estates
> (leverage-ranked #1 of 5, score 88). This brief is the crystallized grounding for `/plan-and-analyze`.

## The thesis (one sentence)
Un-stub `freeside-cli inspect` to **fetch + render + validate** a cell's declared BeaconV3 beacon, and
add a keyed `loa model <building> --brief` orientation command — graduating the **8 already-deployed but
never-read** BeaconV3 beacons from documentation-grade to agent-drivable in one 1-cycle, reversible cut.

## Why this is the highest-leverage move (grounded)
- **It is the purest cure for the cluster's signature failure** (deployed-but-unconsumed, operator-validated
  rank-156 memory): consume the MOST already-deployed keystones (8 beacons) for the LEAST new surface. Build
  nothing new; read what's already declared.
- **Cut-vertex**: the entire "can an agent read/drive a building's operational surface natively" capability
  blocks on this ONE reader existing. #253 (the callable Hyper-style building API — the *drive* half) layers
  on top only AFTER this *read* surface exists.
- **Closes the recall→orientation gap the operator asked for by name**: the governed `/recall` orientation
  emits `→ loa model freeside --brief` as the keyed packet — but that command DOES NOT EXIST (verified: `loa`
  launcher surface is caps/where/run/pipe/policy/doctor/census + operator-only signoff/council; no `model`).
  So recall tells the agent to run a phantom command that returns empty. This recurs across memory
  ([[project_recall-is-similarity-not-orientation]]: recall is fuzzy similarity; orientation needs a KEYED lookup).

## Verified ground truth (2026-07-02)
- `packages/freeside-cli/src/verbs/inspect.ts:10,35` — explicit STUB: "beacon fetch + BeaconV3 validation
  deferred to follow-up cycle (per ADR-007 §Implementation step 7)". Returns `{beacon_url, note:STUB}`, never
  fetches or renders.
- `loa model` — no such command (external launcher `~/Documents/GitHub/loa-cli/bin/loa.mjs`; SDK surface in
  `lib/{census,graph,probe,dispatch,recall-adapter,...}.mjs`). A keyed `model` read would slot beside `census`.
- `packages/freeside-registry/registry.yaml` — 11 module entries, ~8 with real `beacon_url` (score/sonar/
  storage/mint/activities/inventory/identity/mediums per loa-freeside #236).
- `packages/freeside-cli/src/verbs/doctor.ts` — REAL (889 lines): already fetches (`--remote`), host-pins, and
  BeaconV3-validates beacons. **The fetch+validate machinery inspect needs largely EXISTS in doctor** — inspect
  can reuse `probeBeacon`/`loadBeaconFromText` rather than reinvent (surgical, DRY).
- Swarm caveat: beacon SUBDOMAINS (`<cell>.0xhoneyjar.xyz/.well-known/beacon.json`) still 404/503 for most
  cells (DNS + beacon-serving routes not wired). So "fetch the beacon" today means fetch from the registered
  `beacon_url` where it resolves, and degrade honestly where it 404s (doctor already does this — `beacon_dark`).

## Scope shape (cross-repo — name it explicitly)
Two surfaces, one capability:
1. **`freeside-cli inspect` un-stub** — in-repo (`packages/freeside-cli`, **network domain**, ADR-007).
   Reuse doctor's fetch+validate; render the beacon (is/is_not/capabilities/composes_with) + validity verdict.
2. **`loa model <building> --brief`** — EXTERNAL repo `loa-cli` (~/Documents/GitHub/loa-cli). Keyed
   building→orientation packet reading the same beacons. Coordinate; do not admin-merge loa-cli past operator
   ([[feedback_loa-dispatch-changes-operator-gated]]).

## Non-goals (defer with triggers)
- The callable Hyper-style building API (#253, the *drive* half) — layers on AFTER this read surface. Trigger: read surface proven.
- Wiring beacon-serving routes / DNS on the cells (the subdomain 404s) — a per-cell deploy concern, separate track.
- BeaconV3 CI validators (#232/#233) and composes_with hash recompute (#231 OD-2) — network hygiene, adjacent not blocking.

## User-truth hypothesis (settle against revealed behavior)
Agents demonstrably bypass `loa` and grep `registry.yaml` because `inspect` gives a stub and `loa model` is
empty. If the keyed read exists, an agent given only the ~50-token pointer reaches for it UNPROMPTED and reads
a building's surface in one call instead of grepping. That's the check (goal-4 de-risk kill-test shape).

## Related issues
#253 (Hyper API — the drive half, anchor), #231/#232/#233/#236 (BeaconV3 sweep), score-api beacon 503 +
gateway /healthz-path probe mismatch (a numb-sensor the reader would surface), [[project_recall-is-similarity-not-orientation]].
