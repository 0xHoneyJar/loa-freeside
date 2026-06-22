# AFK Triage → Review → Land — Cloud Routine spec

The unattended Cloud Routine that runs the loop. Goal + decisions:
`grimoires/loa/context/2026-06-22-afk-triage-loop-goal.md`. Created by the operator via
`/schedule` (it runs on Anthropic cloud — laptop-closed, fresh clone, no `~/.claude`, no
mid-run prompts, on the Claude subscription, 1-hour-min cadence).

## The routine prompt (paste into `/schedule`)

> You are the AFK triage agent for `0xHoneyJar/loa-freeside`. You run unattended; no human
> is watching, so never ask permission — proceed on reversible actions and stage anything
> irreversible for the operator.
>
> 1. Run `tools/hivemind/triage-sweep.sh --apply` — labels every open issue with canonical
>    hivemind colon-labels and writes the routing manifest to `.run/hivemind/triage-manifest.json`.
> 2. For each manifest entry with `route: operator`: re-read the issue. The regex
>    under-detects bugs — if it's actually a reproducible bug (stack trace, error, broken
>    behavior), re-route to `bug`; otherwise leave it labeled in the operator queue. **Never
>    silently default an ambiguous issue — when unsure, leave it for the operator.**
> 3. For each `route: bug` issue: run `/bug` → prepare a fix on a branch → open a PR →
>    run a Bridgebuilder review (Opus) and a Fagan diff review (Codex + Cursor).
> 4. Decide land-vs-stage against `tools/hivemind/auto-merge-allowlist.yml`: if the PR matches
>    an ENABLED allow rule AND satisfies every `require` (CI green, reviews resolved, gates
>    pass, no excluded paths) → merge it. Otherwise → leave it open (staged) with the review
>    posted, for the operator's one-click.
> 5. Before reporting progress, audit each claim against a tool result (a PR URL, a CI
>    status, a merge SHA). Report only verified outcomes; if a step failed, say so.
>
> Brakes: never touch an `exclude_paths` entry in an auto-merge; never auto-merge a PR with
> an unresolved CRITICAL/HIGH finding; cap at 5 bug-fix PRs per run; on any ambiguity, leave
> it for the operator and move on.

## Model routing (cost-tiered)

| Stage | Model |
|---|---|
| labeling | free — `triage-sweep.sh` regex, zero tokens |
| `/bug` triage + bug re-classification backstop | sonnet |
| Bridgebuilder review | Opus → Fable when it lands |
| Fagan diff | Codex + Cursor (parallel) |

## Setup checklist (do once before the first run)

- [ ] `gh` auth available in the routine env (GitHub connector / token).
- [x] Vendored scripts committed under `tools/hivemind/` (fresh clone sees them).
- [x] Canonical 20 hivemind labels present on the repo (verified — already 20/20 synced).
- [ ] Create the two routing labels:
      `gh label create "triage:operator-review" -R 0xHoneyJar/loa-freeside --color fbca04 --description "needs human triage"`
      `gh label create "triage:bug-queued" -R 0xHoneyJar/loa-freeside --color d73a4a --description "auto-routed to /bug"`
- [ ] **Eyeball `auto-merge-allowlist.yml`** — the entire blast radius of unattended merges. Decide the framework-churn class.
- [ ] Confirm the Claude plan tier allows Cloud Routines + the usage budget.
- [ ] (optional, destructive, operator-gated) collapse the 7 stale bracket labels:
      `node tools/hivemind/label-sync.mjs loa-freeside --apply --migrate`

## Brakes (baked in — the routine has no mid-run human)

- `auto-merge-allowlist.yml` is the whole auto-merge blast radius; everything else stages.
- triage-sweep labels are regex + additive (reversible).
- the reasoning-extraction CI gate (`.github/workflows/fable-readiness.yml`) keeps the
  review step Fable-safe (no silent fallback to Opus).
- per-run PR cap (5); 1-hour-min cadence bounds spend.
- "never silently default" — ambiguous issues route to the operator queue.

## What's built vs operator-gated

- **Built + verified:** vendored `autolabel.mjs` / `label-sync.mjs` / `hivemind-validate.sh`
  (fresh-clone-safe; `--stdin` bug fixed) + `triage-sweep.sh` (classify → route → manifest,
  verified on real issues) + this spec + the allowlist.
- **Operator-gated tail:** create the Cloud Routine (`/schedule`), eyeball the allowlist,
  create the two routing labels, confirm plan tier. Then it runs AFK.
