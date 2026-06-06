---
title: "Orchestration & Model-Routing Rail — pave the cheval path so the slip isn't the default"
status: proposal
authored: 2026-06-05
domain: shared
trigger: a real slip — a 17-agent all-inherited-Opus adversarial-review Workflow that should have been
  /compose (intelligence_tier, SHIPPED) or the flatline / adversarial-review.sh cheval rail (metered, in CENTS)
gate: DOCTRINE CHANGE — operator-promoted only. Not shipped unilaterally (that would repeat the slip
  at the doctrine altitude). The instrument (gradient-conscience.sh) ships; this rail awaits your word.
relates:
  - reference_cc-usage-sensor-and-cost-model   # 96% Opus subagent lane = the real overuse
  - project_compose-onramp-teardown            # #7 READY-but-unsurfaced — the recurring invisible on-ramp
  - project_estate-immune-system-pattern       # doctor (loud) -> aligner -> teeth
---

# Orchestration & Model-Routing Rail

## The slip (grounded, 2026-06-05)

The raw `Workflow`/`Task` tool fan-out **inherits the parent model (Opus) for every subagent** and runs
**outside cheval** entirely (no MODELINV entry, no budget gate, no multi-provider routing). Measured this
session: `opus-4.8 $368 vs sonnet-4.6 $12.89` (**97% Opus**); the fan-out lane is **$143 / 37%** and is
almost all **cache-read** (164M tokens re-read across 1,304 agent turns — each agent re-reads the big prefix).

A 17-agent adversarial review cost tens of dollars to do **worse-governed** work than the rail it bypassed:
`adversarial-review.sh` is budget-gated at **150 cents**, routes GPT/headless dissent through cheval, and
lands in the MODELINV ledger. The rail existed. It was invisible at the decision point. So the agent
defaulted to the visible expensive path. This is `compose-onramp #7` ("READY-but-unsurfaced") recurring at
the **model-routing** altitude.

**Why cheval beats tiering the Claude subagents:** offloading a review to cheval moves it off the
Anthropic/Opus lane AND off the cache-read prefix tax entirely (different runtime, metered, multi-provider).
Tiering `opts.model` (haiku/sonnet) only fixes the model price, not the per-agent prefix re-read. Cheval fixes both.

## The rail (corrected per operator, 2026-06-05)

> **For any fan-out — REVIEW / DISSENT / multi-agent work — use the `/compose` runtime. NEVER the raw
> `Workflow`/`Task` tool.** `/compose` was designed with intention: tiered Claude subagents (live
> filesystem context preserved) + the seam protocol + `intelligence_tier` routing
> (explore→haiku, work→sonnet, gate/verify→opus). "cheval" names the intelligence-ROUTER **shape**, not
> always the literal substrate — `/compose` IS that shape. Pick by intent:
> - code-diff review/dissent → `/flatline-review` OR `adversarial-review.sh` (cheval-shape dissent, budget in CENTS)
> - PRD/SDD/sprint → `/flatline-review`
> - any multi-agent fan-out → `/compose` (tiered subagents + intelligence_tier + seam protocol)
> - the raw `Workflow`/`Task` tool → **do not use it for this.** It inherits Opus per subagent and bypasses
>   the governed seam — that is the slip itself.
> The doctor is `~/.claude/scripts/gradient-conscience.sh` (global; wired to SessionStart + Stop, 2026-06-05).

## Implemented 2026-06-05 (operator-directed)

- ✅ **Rail ENABLED** — `.loa.config.yaml` `flatline_protocol.{code_review,security_audit}.enabled: true`
  (codex-headless, 150¢). `adversarial-review.sh` now runs instead of exiting "disabled".
- ✅ **Sensor GLOBALIZED** — `~/.claude/scripts/gradient-conscience.sh` (canonical; repo copy removed).
- ✅ **Hooks WIRED (global, propagates to all sessions)** — SessionStart (`--brief --quiet-if-ok`, sync banner)
  + Stop (`--quiet-if-ok --throttle 900`, async, non-blocking). settings.json backed up + JSON-validated.
- 🚫 **Kernel prose — deliberately NOT added.** The red-team's "prose-repeats-#7" critique is right, and
  the operator's whole correction was "stop talking, use the rails." The PROACTIVE channel already exists:
  `feedback_route-fanout-through-cheval` in memory (surfaced via `/recall` when relevant). So the split is
  clean without bloating the 53–59%-cache-read kernel prefix: **memory = proactive instruction · hook =
  reactive surface · enabled rail = the cheaper path.** The exact kernel insertion stays here in §below as a
  one-line option if you ever want it always-loaded — but adding it now would be me reverting to the
  doctrine-instead-of-mechanism habit this whole exercise exists to break.

## Two things a Sonnet red-team of this proposal forced me to fix (2026-06-05)

A tiered 2-agent Sonnet red-team (119K tokens, 121s — a fraction of the slip it critiques) found two FATAL holes:

**1. The first-listed rail is dead-on-arrival.** `adversarial-review.sh` gates on
`flatline_protocol.code_review.enabled // false` (and `security_audit.enabled` for audits). Those sub-keys
do **not exist** in `.loa.config.yaml` (verified: both `None`; the master `flatline_protocol.enabled: true`
is irrelevant — the script reads the sub-key). So the rail exits "disabled" every time. Recommending it
without saying so is itself a READY-but-unsurfaced trap. **Fix — enable it (operator-gated; it spends):**
```yaml
flatline_protocol:
  code_review:    { enabled: true, model: codex-headless, budget_cents: 150 }
  security_audit: { enabled: true, model: codex-headless, budget_cents: 150 }
```
(`gradient-conscience.sh` now names this disabled key in its output so the doctor never points at a dead path silently.)

**2. The proposal repeats the exact failure it names (#7).** Adding prose to the always-loaded kernel is MORE
READY-but-unsurfaced doctrine — the agent facing a fan-out decision does not stop and re-read `CLAUDE.md`. And
it taxes the very prefix the cc-usage finding says is 53–59% of all cost. **So the kernel lines below are a
BACKSTOP, not the mechanism. The real pave is MECHANICAL:**

> **Wire `gradient-conscience.sh` to the Stop hook.** Then the fan-out cost surfaces AUTOMATICALLY at session
> end — visible at the moment it matters, zero prefix cost, no reliance on the agent remembering doctrine.
> That is the #7 cure (surface mechanically), where prose is not. The kernel line exists only to name the rail
> for an agent who is *already* reaching for orchestration; the hook is what catches the agent who isn't.

## Proposed insertions (surgical — respect the cache-tax prefix budget)

### A. Project kernel — `CLAUDE.md`, append one row to the coordination weight table (§Spawn-from-inside)

```
| /compose or cheval rail | L2.5 | a REVIEW/DISSENT or model-heavy fan-out | route model work through cheval (flatline · adversarial-review.sh · /compose intelligence_tier) — NEVER a blanket-Opus raw Workflow |
```
…plus one line under it:

```
**Model-routing is a gradient too.** A blanket-Opus fan-out when a cheval rail exists is a desire-path
forming — `gradient-conscience.sh` doctors it. The regenerative (cheval/tiered) path must be the path of
least resistance; if it isn't, that friction is the bug — pave it, don't pay the Opus tax.
```

### B. Global kernel — `~/.claude/CLAUDE.md`, ~3 lines (highest blast radius → your call)

Under **Construct Resolution** (near "Install on need"), add:

```
### Route model-heavy fan-out through cheval (don't default to raw Opus workflows)
REVIEW/DISSENT/orchestration that fans out MUST route model usage through cheval (flatline · adversarial-review
· /compose intelligence_tier), or — for a raw Workflow used as orchestration structure — set opts.model per
role. A blanket-Opus fan-out is the consumption-gradient slip at the model-routing altitude. Sense it with
gradient-conscience.sh; the cheval lane is metered + multi-provider + budget-gated, the raw lane is neither.
```

## Why propose-not-ship

Editing the kernel's model-routing doctrine without your promotion would be the identical defect this rail
exists to prevent: taking the easy edit past the review gate. The force chain has teeth. The **instrument**
(a tool) ships now; the **doctrine** (this rail) is yours to promote. Say the word and I apply A (reversible,
this-repo) and/or B (all-repos + adds to the always-loaded prefix — weigh the cache cost).
