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

- `estimate` is a **probe-based heuristic** — a cheap `COUNT(*)` / `LIMIT 1` probe
  on the SMALL engine to gauge rows × cols. It is labeled `heuristic: true`. It is
  **not** a true cost preview, and never claims to be.
- The **real teeth** are (1) Dune's per-query **Query Cost Cap** (a hard-abort that
  kills a runaway scan at the source) and (2) the **budget-refuse** gate (this tool
  refuses to launch a run whose estimate exceeds the remaining budget). Those two
  paths are the EXP-002 fix and are the ones that are airtight + tested.

Billing unit: **1 credit = 1,000 datapoints (rows × cols).** Free tier = 2,500
credits (the default ceiling).

## Commands

```
dune-meter estimate <sql|query_id>
  → probe-based verdict. Runs a cheap COUNT(*)/LIMIT-1 probe on the small engine,
    computes estimated_datapoints (rows×cols) and estimated_credits
    (ceil(datapoints/1000)), reads the budget ledger, prints:
    { estimated_datapoints, estimated_credits, remaining_budget, verdict, heuristic, note }
    verdict: OK | WARN (est > 25% of remaining) | REFUSE (est > remaining → exit 3)
    NEVER does a full execution.

dune-meter run <sql|query_id> --cap <credits> [--force] [--engine small|medium|large]
  → executes WITH a Dune cost-cap (small engine by default). Runs the pre-run
    estimate first and REFUSES (exit 3) if it exceeds the remaining budget, unless
    --force. Polls to completion, reads credits/datapoints consumed from the result
    metadata, EMITS a CostAtom (hash-chained JSONL), and decrements the budget
    ledger. Exit 4 if Dune aborts on the cap (or reported spend > --cap).

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

> **Set the account-level Query Cost Cap.** The `--cap` flag is the per-query
> intent, and the API `performance` tier picks the engine — but the structural
> hard-abort lives in the Dune dashboard's **Query Cost Cap** setting. Set it.
> The 30-minute engine execution cap is a documented hard limit: queries are
> expected to be **era-bound** (a block/time range), never an unbounded scan.
> The unbounded scan is exactly the EXP-002 failure mode, closed by construction.

## The CostAtom bridge

dune-meter emits a `dune` call-class CostAtom per execution, **compatible with
loa-finn `src/cost/cost-atom.ts`**: the same 3-ledger record
(inference/infra/orchestration), integer units, canonical-JSON sha256 checksum,
append-only JSONL. Two honest deltas:

1. **`dune` call class** — the finn original has `A_relay | B_enrich`; a dune atom
   zeroes the model ledgers (no token spend) and books the credit cost on
   dune-native fields (`query_id`, `datapoints_scanned`, `credits_consumed`,
   `engine`) plus the orchestration gate record.
2. **A hash-chain** — the finn envelope self-checksums each atom; dune-meter adds a
   `prev_hash` link (the previous envelope's checksum), so the ledger is a
   tamper-evident chain. The genesis atom links to `GENESIS_PREV_HASH`.

One meter, two sources: harness tokens (finn) + Dune credits (here). The
experiment-economics learning-yield denominator becomes real.

## How it composes

- **Cost meter** (loa-finn) — the CostAtom shape is shared; both ledgers can feed
  one readout.
- **Asson liveness watchdog** — the veve's `liveness.timeout_s` (300s) feeds finn's
  sandbox CommandPolicy as the enrage timer; the watchdog governs runtime pace.
- **GECKO `sense-runtime-fit`** — senses declared-vs-actual cost drift (the veve
  declares the cost contract; GECKO senses when reality diverges).

## Testing

```
node --test packages/dune-meter/test/
```

**No live Dune call ever runs in tests or build** — the whole point is cost-safety;
don't spend credits to test the cost guard. The Dune client is mocked; tests run
offline and deterministic. Coverage: estimate verdict thresholds (OK/WARN/REFUSE),
budget-ledger atomic read/write, CostAtom hash-chain continuity + tamper detection,
exit-code mapping.
