# The Ground HERALD Stands On

> Shared ground: https://github.com/0xHoneyJar/loa-constructs/blob/main/docs/the-ground.md
> — this file carries ONLY the herald-specific layer. Tiers, forks, agent
> types, frontmatter contracts, and gate design live THERE, not here.
> Probed from the live harness at construct-herald @ 3e8e4e8, 2026-07-03.

## 1. Runtime contract (probed)

| Axis | Value | Source |
|---|---|---|
| model_tier | sonnet | construct.yaml:59 |
| danger_level | moderate | construct.yaml:60 |
| effort_hint | medium | construct.yaml:61 |
| downgrade_allowed | **true** (ceiling, not pin — routing may go cheaper) | construct.yaml:62 |
| execution_hint | sequential | construct.yaml:63 |
| requires | tool_calling: true · vision: false | construct.yaml:65,67 |
| workflow.gates | **none** — herald owns no pipeline; its writes ride the caller's gates | construct.yaml (absent) |
| agent dispatch | no skill sets `agent:` — all inherit the caller (the safe default) | skills/*/SKILL.md frontmatter |
| chronicling-changes tools | Read, Glob, Grep, Bash, Task (read-only + fan-out) | skills/chronicling-changes/SKILL.md:7 |
| grounding-announcements tools | Read, Glob, Grep, Bash, Task, **Edit** (write-capable) | skills/grounding-announcements/SKILL.md:8 |
| synthesizing-voice tools | Read, **Write**, Glob, Grep, **Edit**, AskUserQuestion (write-capable) | skills/synthesizing-voice/SKILL.md:7 |

A coherent declaration: sonnet + downgrade:true + effort:medium is the honest
middle of the ladder for evidence-grounded writing work — no opus pin, no
apology needed.

## 2. Capability-reality edges

- **#553 class: CLEAN.** Two skills carry write tools (grounding-announcements,
  synthesizing-voice) and neither sets `agent:` — both inherit the caller, so
  the silent-output-drop conflict cannot occur here. (Probed: zero `agent:`
  keys across skills/*/SKILL.md.)
- **Deny-all edge (real, surfaced):** no skill declares a `capabilities:` block
  (`write_files` absent everywhere). Under the shared ground's §IV deny-all
  default, capability is carried by `allowed-tools` alone. A runtime that
  enforces `capabilities.write_files` strictly would silently deny
  synthesizing-voice's Write — the exact silent-drop shape, from the OTHER
  contract altitude. This is a SMELL, not a conflict: the two declaration
  layers don't contradict, one is simply absent.
- **Evidence discipline is the identity edge:** every herald skill grounds
  claims in git evidence (commits, PRs) — its writes are copy artifacts
  (announcements, voice profiles, timelines), never source code. The runtime
  contract matches: no gates owned, sequential, mid-tier.

## 3. What HERALD does with the ground

herald is the town crier who reads the ledger before ringing the bell: every
announcement traces to a real commit or PR. the ground it needs is thin —
mid-tier reasoning, read-heavy tools, a pen for the announcement itself. it
asks for exactly that and nothing more: no pinned opus, no owned gates, no
agent-type games. when the bell rings, the provenance is already in hand.
