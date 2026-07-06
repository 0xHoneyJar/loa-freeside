# @freeside/dune-meter

> The EXP-002 scar, made into a guard.

A cost-aware Dune adapter. Every on-chain Dune query goes **through** this, never
around it: estimated, cost-capped, metered, and budget-checked — or it does not
run. Zero-dependency core, Asson-graduatable CLI (`.mjs`, Node ESM, `node:test`).

## Why this exists

EXP-002 burned its datapoint budget on **two unbounded `evt_transfer` scans** that
timed out — because **nothing estimated cost before executing.** dune-meter is the
foundation the Score forensic-integrity vertical sits on: the metered pipe that
makes on-chain provenance data cost-safe. Build the guard first.

## The honest constraint

Dune has **no native dry-run / EXPLAIN.** Billing is dynamic (compute time + data
scanned) and is not previewable. So cost-awareness here is **DEFENSIVE, not
predictive**:

- `estimate` is a **probe-based heuristic** — labeled `heuristic: true`, **not** a
  true cost preview, and it never executes the target:
  - **SQL** → a cheap `COUNT(*)` / `LIMIT 1` probe on the SMALL engine to gauge
    rows × cols (design-sanctioned).
  - **query_id** → a **non-executing** read of the query's latest **cached** result
    metadata (the results endpoint, zero rows fetched). A saved query is **never
    executed just to estimate it** — that would reintroduce the exact EXP-002
    failure (an unbounded scan run with nothing metering it). If the query has no
    completed cached result, `estimate` errors (exit 2) and tells you to pass SQL
    or `run` it once (cost-capped) first — it will not execute to fill the gap.
- The **real teeth** are (1) Dune's per-query **Query Cost Cap** (a hard-abort that
  kills a runaway scan at the source) and (2) the **budget-refuse** gate (this tool
  refuses to launch a run whose estimate exceeds the remaining budget). Those two
  paths are the EXP-002 fix and are the ones that are airtight + tested.

Billing unit: **1 credit = 1,000 datapoints (rows × cols).** Free tier = 2,500
credits (the default ceiling).

## Commands

```
dune-meter estimate <sql|query_id>
  → probe-based verdict, NEVER a full execution. SQL → cheap COUNT(*)/LIMIT-1 probe
    on the small engine; query_id → non-executing read of the latest cached result
    metadata (exit 2 if none cached — pass SQL or run it once first).
    Computes estimated_datapoints (rows×cols) and estimated_credits
    (ceil(datapoints/1000)), reads the budget ledger, prints:
    { estimated_datapoints, estimated_credits, remaining_budget, verdict, heuristic, note }
    verdict: OK | WARN (est > 25% of remaining) | REFUSE (est > remaining → exit 3)

dune-meter run <sql|query_id> --cap <credits> [--force] [--engine small|medium|large]
  → execute with post-spend audit via --cap (small engine by default). Runs the
    pre-run estimate first (non-executing for a query_id) and REFUSES (exit 3) if
    it exceeds the remaining budget, unless --force. An un-estimatable target (e.g.
    a never-run query_id with no cached metadata) needs --force to proceed without
    an estimate (exit 2 otherwise) — it is never executed just to estimate.
    --force requires --cap ≤ DUNE_BUDGET_CEILING (exit 2 if exceeded) to bound
    per-query spend when skipping the estimate gate.
    Polls to completion, reads credits/datapoints consumed from result metadata,
    EMITS a CostAtom (hash-chained JSONL), and decrements the budget ledger.
    Exit 4 if Dune aborts on the cost cap (or reported spend > --cap).

dune-meter budget
  → reads the ledger, prints { spent_credits, remaining_credits, ceiling,
    atoms_count, chain_ok, recent_atoms: last 5 }.
```

### Exit codes

| code | meaning |
|------|---------|
| `0`  | ok |
| `2`  | caller error (bad args, missing `DUNE_API_KEY`, malformed target) |
| `3`  | budget refuse (estimate exceeds remaining budget) |
| `4`  | cap aborted (Dune cost-cap hard-abort, or reported spend over `--cap`) |

### Environment

| var | default | purpose |
|-----|---------|---------|
| `DUNE_API_KEY` | — | Dune Analytics API key (required for live calls) |
| `DUNE_BUDGET_LEDGER` | `<pkg>/.run/dune-budget.json` | budget ledger path |
| `DUNE_COST_ATOMS` | `<pkg>/.run/dune-cost-atoms.jsonl` | CostAtom ledger path |
| `DUNE_BUDGET_CEILING` | `2500` | credit ceiling (free-tier default) |

> **`--cap N` is a post-spend audit signal.** If reported credits exceed N after
> execution completes, the CLI exits 4 and the overage is recorded — but it does
> **not** prevent Dune from executing or charging credits. The account-level
> **Dune Query Cost Cap** (configured in the Dune dashboard) is the only pre-spend
> hard abort at the Dune layer. Set it there to get the true structural backstop.
> The 30-minute engine execution cap is a documented hard limit: queries are
> expected to be **era-bound** (a block/time range), never an unbounded scan.
> The unbounded scan is exactly the EXP-002 failure mode, closed by construction.

## The CostAtom bridge

dune-meter emits a `dune` call-class CostAtom per execution, **shape-compatible
with loa-finn `src/cost/cost-atom.ts`** (same 3-ledger record —
inference/infra/orchestration — integer units, canonical-JSON sha256, append-only
JSONL). It is **shape-compatible, not wire-compatible**: the two ledgers are
independently verifiable but NOT cross-validatable by finn's reader. Three honest
deltas:

1. **`dune` call class** — the finn original has `A_relay | B_enrich`; a dune atom
   zeroes the model ledgers (no token spend) and books the credit cost on
   dune-native fields (`query_id`, `datapoints_scanned`, `credits_consumed`,
   `engine`) plus the orchestration gate record.
2. **Numbers, not decimal-strings** — finn serializes its `*_micro` fields
   (`cost_micro`/`total_micro`/`x402_quote_micro`) as **bigint → decimal STRINGS**;
   dune-meter stores them as plain integer **numbers** (free-tier credit
   magnitudes are safe integers, no bigint branch). The encodings differ.
3. **A hash-chain over a wider envelope** — finn's envelope self-checksums the
   **atom only**; dune-meter's envelope adds a `prev_hash` link and checksums over
   `{schema_version, prev_hash, atom}`, so the ledger is a tamper-evident chain.
   The genesis atom links to `GENESIS_PREV_HASH`. Consequence: finn's
   `parseEnvelopeLine` would throw `checksum mismatch` on a dune envelope (and vice
   versa) — the shapes match, the wire bytes do not.

One meter, two sources: harness tokens (finn) + Dune credits (here) — readable by
one readout that understands both encodings; not byte-cross-validated by either
reader alone.

## How it composes

- **Cost meter** (loa-finn) — the CostAtom shape is shared; both ledgers can feed
  one readout.
- **Asson liveness watchdog** — the veve's `liveness.timeout_s` (300s) feeds finn's
  sandbox CommandPolicy as the enrage timer; the watchdog governs runtime pace.
- **GECKO `sense-runtime-fit`** — senses declared-vs-actual cost drift (the veve
  declares the cost contract; GECKO senses when reality diverges).

## Testing

```
npm test          # → node --test test/*.test.mjs  (run from packages/dune-meter/)
```

> The directory form `node --test packages/dune-meter/test/` is avoided: on the
> Node 23 test-runner a trailing-slash path is treated as a single (failing) module
> target. The `test/*.test.mjs` glob (what `npm test` wires) runs the whole suite.

**No live Dune call ever runs in tests or build** — the whole point is cost-safety;
don't spend credits to test the cost guard. The Dune client (and, for the probe
tests, `fetch`) is mocked; tests run offline and deterministic. Coverage: estimate
verdict thresholds (OK/WARN/REFUSE), the **non-executing** query_id probe (asserts
no `/execute` call), budget-ledger atomic read/write, CostAtom hash-chain continuity
+ tamper detection, exit-code mapping (including `--force` past an un-estimatable
target).

## Asson ladder status (honest)

This CLI claims **L2** in its veve (`ladder.level: 2`) — the level the
[`asson.doctor`](../asson/src/asson.mjs) **earns** it from evidence (veve + 2
evidence_runs + passing golden vectors + honest `attestable` determinism +
liveness). It is **Asson-graduatable to L3**, not yet L3: L3 requires a
**verifiable build attestation** (tree-hash + ed25519 signature whose key resolves
in the asson keyring), produced by the CI key ceremony — a step that lives outside
this package (`packages/asson/keyring/`). The doctor therefore still reports an
`AS-1` "attestation absent" finding; that is the honest unattested state, not a
misclassification. Claiming L3 before that ceremony would be exactly the
declaration lie this construct exists to prevent (`claimed > earned` DRIFT).
