# Pass 4 of 5 — Shell/bash harness hotspots + Rust tooling (parity report)

> **Lever family (single):** portable + fork-reducing rewrites of hot repo-level
> shell scripts. Golden-output isomorphism proven byte-identically for every
> change. No `.claude/` / `.beads/` / `.run/` / `*.pyc` touched; no git ops.
>
> Date: 2026-07-06 · Host: darwin arm64. NOTE: this machine aliases `grep` →
> `ugrep 7.5.0` (which *does* support `-P`), so the `grep -oP` "before" was
> runnable here for a true golden comparison — the portability win lands on
> stock BSD/macOS grep (no `-P`) and is behavior-preserving on GNU grep (Linux CI).

---

## Changes applied (2 files)

### O4.1 — `scripts/rebuild-hounfour-dist.sh:72,229` (matrix score 20.0, top target)

**Lever:** `grep -oP … | grep -oP … | tr` (Perl-regex, GNU-only) → single portable
`sed -nE` capture. On stock macOS/BSD grep the old `-P` errors → `DIST_VERSION=""`
→ the up-to-date short-circuit at `:91` never fires → a **full clone + `npm ci` +
tsc + npm-pack rebuild runs on every install** (postinstall). The `sed` form works
on BSD *and* GNU, so the short-circuit can actually engage.

| Line | Before | After |
|---|---|---|
| 72 | `DIST_VERSION=$(grep -oP "CONTRACT_VERSION\s*=\s*'[^']+'" "$…/version.js" 2>/dev/null \| grep -oP "'[^']+'" \| tr -d "'" \|\| echo "")` | `DIST_VERSION=$(sed -nE "s/.*CONTRACT_VERSION[[:space:]]*=[[:space:]]*'([^']+)'.*/\1/p" "$…/version.js" 2>/dev/null)` |
| 229 | `NEW_VERSION=$(grep -oP … \| grep -oP … \| tr -d "'" \|\| echo "unknown")` | `NEW_VERSION=$(sed -nE "s/…/\1/p" "dist/version.js" 2>/dev/null)` + `NEW_VERSION=${NEW_VERSION:-unknown}` |

**Isomorphism proof** — ran old vs new extraction under the real `set -o pipefail`
environment across the real dist + 4 edge fixtures:

```
real version.js (CONTRACT_VERSION='8.3.0')   orig=[8.3.0]          new=[8.3.0]          OK
no CONTRACT_VERSION line                     orig=[]/[unknown]     new=[]/[unknown]     OK
tight spacing  ='9.9.9'                       orig=[9.9.9]          new=[9.9.9]          OK
spaced+prerelease = '10.0.0-beta.1'          orig=[10.0.0-beta.1]  new=[10.0.0-beta.1]  OK
missing file                                 orig=[]/[unknown]     new=[]/[unknown]     OK
```

- Ordering/tie-breaking: N/A (single scalar extraction).
- Fallback parity: line 72 empty-on-miss preserved (`sed` exits 0 → `""`); line 229
  `"unknown"`-on-miss preserved via `${…:-unknown}`. Under `pipefail` the old chain
  produced `"unknown"` on any grep miss — the new form matches.
- `2>/dev/null` stderr suppression preserved. `bash -n` OK. In-place run yields
  `DIST_VERSION=[8.3.0]`.
- `# loa:shortcut:` N/A — no ceiling; the generated `version.js` has exactly one
  `CONTRACT_VERSION` declaration (grep `head`-less all-match == `sed -n …/p` here).

### O4.2 — `scripts/extract-routes.sh:41–84` (matrix score 2.0)

**Lever:** the inner `while read line` loop spawned ~8 subprocesses **per matched
route line** (`echo|cut` ×2, `echo|grep -qE`, `echo|grep -oE|head|tr|tr` ×2,
`echo|grep -qiE`) — ~550 forks over 69 lines / 47 files. Replaced with **one
`awk` pass** over the same `find | LC_ALL=C sort` file list, emitting the identical
JSON array (all consumer modes normalize through `jq`, so the array contents are
the golden surface).

Semantics preserved exactly: same outer line filter (`router|app.METHOD(`),
first-match method (uppercased), first quoted path (all quotes stripped),
case-insensitive auth heuristic, `find|sort` file order, `FNR` line number, empty-set
→ `[\n]`.

**Isomorphism proof** — byte-identical across all output modes:

```
scripts/extract-routes.sh --json   diff before/after → IDENTICAL (sha256 4dd38fa2…)
scripts/extract-routes.sh --count  diff before/after → IDENTICAL (46)
scripts/extract-routes.sh --table  diff before/after → IDENTICAL
stderr: empty · exit codes: 0/0/0 preserved · bash -n OK
```

`--snapshot`/`--diff` operate on the same `routes_json` (proven identical) → covered
transitively (`length` = 46 both).

**Timing (genuinely measurable, ~15×):**

| Mode | Before | After |
|---|---|---|
| `--json` wall | ~0.997 s (user 0.47 s) | **0.065 s** (user 0.05 s) |

---

## Candidates found but NOT changed

| Location | Why left alone |
|---|---|
| `scripts/check-redis-imports.sh:37,42,54` (`grep -qP`/`-P`/`-vP`/`-nP`) | Pattern uses PCRE-only constructs — non-capturing groups `(?:redis\|ioredis)` and `\s` — that POSIX ERE (`grep -E`/`sed -E`) cannot express without a risky hand-rewrite. Runs only in `ci.yml` unit-tests on **Linux** (where `-P` works). Matrix rated "minor". Isomorphism risk outweighs a cold non-macOS gain. |
| `.github/workflows/ci.yml:105,109,128`, `protocol-freshness.yml:19`, `post-merge.yml:46` (`grep -oP`) | These are inline **workflow** `run:` blocks → **Pass 5 (CI)** scope per the opportunity matrix (O5.3), not Pass-4 repo-shell. Run on Linux where `-P` is present. Deferred to the CI pass to keep this pass to one lever family. |
| `scripts/pin-citations.sh:150–153` (per-entry `jq -r` + `date -d`) | Matrix O4.3, score **1.5 (below the 2.0 cutline)**. Cold docs/citation path, low aggregate frequency. Not a hotspot. |
| `tools/modelinv-rollup.sh:150–166` | Already optimized in a prior cycle (109/T5.3): 2N-subprocess pipeline → single-pass `awk\|jq` (its own comment: 11 s → <200 ms). No residual. |
| Deploy/ops scripts (`staging-smoke.sh`, `advisor-benchmark.sh`, `validate-deployment.sh`, `staging-deploy-all.sh`) | Largest scripts but **cold/manual deploy paths**; their per-iteration `curl`/`node` spawns are intentional load generation, not incidental fork waste. Large ≠ hot. |

## Integrity note

- Files changed: `scripts/rebuild-hounfour-dist.sh`, `scripts/extract-routes.sh` (only).
  `git status` confirms no other tracked file modified by this pass.
- No new dependency introduced — `sed`/`awk` are POSIX (present on BSD *and* GNU);
  `jq`/`find` already required by the scripts. No reliance on any absent binary.
- No `git add`/`commit`/`push`/`stash`. Frozen paths untouched.
