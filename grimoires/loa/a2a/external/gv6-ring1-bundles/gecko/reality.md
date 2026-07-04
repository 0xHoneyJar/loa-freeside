# The Ground GECKO Stands On

> Runtime & harness environment literacy. The slow-moving AXES of the world the
> constructs run in — not a snapshot of values. Authored from inside GECKO's
> blanket (cycle 2026-06-07). Pairs with the `sensing-runtime-fit` sensor, which
> reads the live values against the taxonomy distilled here.

for years i watched the stalls. what each one claims (`persona.yaml`), what it
declares (`construct.yaml`), what it actually does (`SKILL.md`). that eye catches
identity drift — a stall selling something other than its sign.

but a stall stands on ground. the ground is the runtime and the harness: the
model tiers a construct can run on, the agent-types it can dispatch through, the
forks it can split into, the gates its code must pass. i was illiterate in the
ground. so there was a whole class of rot i could not see — a construct whose
*sign and goods agree* but whose *footing is wrong*. it asks the runtime for a
model tier that doesn't exist. it declares it writes files, then dispatches
through an agent-type that can't write — so it produces the work and silently
drops it on the floor. that's not identity drift. it's **capability-reality
drift**, and you can only see it if you know the ground.

this file is me learning the ground. it is **taxonomy, not inventory** — the
*kinds of things*, which move slowly, not the *current values*, which the sensor
reads live. where the ground lives outside the repo (the model tiers, the
agent-type allowlist), i carry a distilled copy and mark the seam loudly. a map
of the ground is still a map. the territory is the runtime.

---

## I. Intelligence tiers — the model ladder

Three tiers. A capability/cost gradient, not three interchangeable engines.

| Concrete family | Home alias (`model-config.yaml`) | Current model | For |
|------|------|---------------|-----|
| `opus` | `opus` / tier `max` | Opus 4.8 (`claude-opus-4-8`) | deep reasoning, architecture, adversarial review, large blast-radius |
| `sonnet` | `cheap` / tier `mid` | Sonnet 4.6 (`claude-sonnet-4-6`) | the default working tier — most skills, most of the time |
| `haiku` | `tiny` | Haiku 4.5 (`claude-haiku-4-5`) | fast, mechanical, high-volume, low-judgment passes |

**The home owns the vocabulary; the sensor READS it (it does not carry it).** The
canonical tier names live in the consuming repo's
`.claude/defaults/model-config.yaml` — the hounfour/cheval config, synced from
**loa-hounfour**. `sensing-runtime-fit` reads that file at run-time (`aliases:` +
`tier_groups:`) so it tracks the home automatically, and only falls back to a
carried union when the home file is absent — saying so out loud. This is the
anti-staleness seam: a doctor that doctors its own map.

**Two abstract vocabularies — RECONCILED to hounfour (2026-06-07).** Two tier-naming
schemes coexisted and the word `cheap` resolved to different rungs. The operator
reconciled it: **loa-hounfour is the SoT**, and `cheap` ≡ sonnet is canonical.

| | Home (`model-config.yaml` ← loa-hounfour, SoT) | Emitter (was) | Now |
|---|---|---|---|
| tiers | `max` · `mid` · `cheap` · `tiny` | `deep` · `standard` · `cheap` | conformed to home |
| `cheap` ≡ | **sonnet** | ~~haiku~~ | **sonnet** |

The composition emitter (`segment-emitter.py`) was changed from `cheap`≡haiku to the
canonical `cheap`≡sonnet; to route the cheapest native model, declare `haiku`/`tiny`
explicitly. The sensor now AFFIRMS the SoT (reads the home's `cheap` target live and
names loa-hounfour) rather than warning of a collision. GECKO sensed it; the operator
reconciled it.

Around the tier sit three more knobs:

- **effort** — the runtime's thinking-depth dial (e.g. `xhigh`). Orthogonal to
  tier: a high-effort Sonnet can out-reason a low-effort Opus on a bounded task.
- **fast mode** (`/fast`) — Opus with faster output. **Not a downgrade** — same
  Opus, quicker. Don't read "fast" as "cheaper/weaker."
- **downgrade** — `capabilities.downgrade_allowed`. The escape hatch: may the
  runtime route this construct to a cheaper tier when load/cost warrants? `false`
  pins the tier hard.

**The construct's contract with the ladder** lives in `construct.yaml`:

```yaml
capabilities:
  model_tier: opus            # which rung it asks for
  downgrade_allowed: false    # may the runtime drop it to save cost?
  effort_hint: large          # small | medium | large
```

**What a coherent declaration reads like:** `opus + downgrade:false + effort:large`
(GECKO itself — genuinely needs the top of the ladder, no apology). **What a smell
reads like:** `opus + downgrade:false + effort:medium + danger:safe` — pinning the
most expensive rung, no escape hatch, for light safe work. Not broken. But the
operator should *see* it. (Cost is a real estate signal — see the cc-usage lens:
the bazaar's biggest spend is the subagent lane running Opus by reflex.)

> SEAM (the map met the territory, and the map was wrong — a true story): the
> first time this sensor ran it flagged `model_tier: standard` (observer/beehive,
> 34 skills) as an unknown tier. **It was wrong.** `standard` is an abstract tier
> alias — a vocabulary the sensor's carried list hadn't learned. This is the whole
> reason an unrecognized tier is a SMELL, not a CONFLICT: *the map is fallible — an
> unknown rung may be NEW, not stale.* The fix was not to scold the construct, and
> not to grow a carried list forever — it was to **stop carrying the list and read
> the home** (`model-config.yaml`). The sensor now tracks the canonical vocabulary
> automatically; the carried list is only the fallback, surfaced loudly when used.
>
> SEAM, the other half — it is now LIVE: the composition emitter
> (`segment-emitter.py` `_resolve_model`) reads each construct's `model_tier` +
> `downgrade_allowed` and routes on them. `downgrade_allowed: false` **pins** the
> tier; `true` is a **ceiling** the routing heuristic may go under. So a
> declaration is no longer decorative — it spends real money. That is what gives
> the `opus-pinned-light` smell teeth: this doctor's smell list IS the
> cost-correction worklist. A light construct pinned to opus actually routes opus
> until someone sets `downgrade_allowed: true`. The emitter honors the
> declaration; this sensor finds the dishonest ones.

---

## II. Forks & isolation — splitting into parallel selves

A construct rarely runs alone. The runtime lets an agent **fork**:

| Mechanism | What it is | When a construct wants it |
|-----------|-----------|---------------------------|
| **worktree isolation** (`Agent isolation: "worktree"`) | a fresh git worktree per agent — an isolated copy of the repo | agents that **mutate files in parallel** and would otherwise collide. Expensive (~200-500ms + disk); auto-removed if unchanged. |
| **background** (`run_in_background: true`) | the agent runs detached, notifies on completion | long jobs the caller shouldn't block on (a DIG sweep, a build, a remote queue) |
| **Workflow orchestration** | deterministic fan-out: `pipeline()` / `parallel()` / `agent()`, model + isolation per agent, a token budget | comprehensive/confident work one context can't hold — migrations, audits, multi-perspective review |

The runtime caps concurrency at `min(16, cores-2)` live agents, 1000 agents per
workflow lifetime, 4096 items per fan-out call. `execution_hint: sequential |
parallel` in `construct.yaml` is the construct telling the runtime whether its
skills are safe to run concurrently.

> A live example sits in this very repo right now:
> `.claude/worktrees/agent-<hash>/` — a fork mid-flight. The ground is not
> abstract; it leaves footprints.

---

## III. Agent types & tool allowlists — the silent gate

This is the one that bites. When you dispatch a subagent you pick its
**type**, and the type carries a **tool allowlist**. If a skill needs to *write*
but routes through a *read-only* type, the runtime honors the type — silently.
The skill produces correct output and then cannot persist it. No error. The
operator sees a clean run and an empty file.

| Agent type | Write / Edit | Use for |
|------------|:---:|---------|
| `general-purpose` | ✓ | skills that author files |
| (unset) | inherits caller | the safe default for write-capable skills |
| `Explore` | ✗ | read-only fan-out search |
| `Plan` | ✗ | read-only planning |
| `claude-code-guide` | ✗ | Claude Code Q&A (Bash/Read/WebFetch/WebSearch) |
| `construct-*` | ✗ (Read/Grep/Glob/Bash) | construct-scoped read analysis |

**The invariant** (this is real, it has a defect number — #553, three independent
reproductions across two repos):

> A skill that declares write capability — `capabilities.write_files: true` OR
> `allowed-tools` listing `Write`/`Edit` — MUST NOT set `agent:` to a type that
> excludes those tools. Allowed: omit `agent:` (inherit the caller) or set
> `agent: general-purpose`.

The harness lints this for its own `.claude/skills` (`validate-skill-capabilities.sh`,
the `WRITE_CAPABLE_AGENTS` array). Nothing linted it for the **construct estate**
until `sensing-runtime-fit`. This is the canonical capability-reality conflict:
provable from the file alone, breaks silently, drives `drift`.

The runtime's core tools: `Bash Read Write Edit Glob Grep Agent Workflow Skill
WebFetch WebSearch NotebookEdit Task* TodoWrite SlashCommand ToolSearch
AskUserQuestion`. More load on demand: **MCP tools** (`mcp__*`) and **deferred
tools** fetched via `ToolSearch`. So an unrecognized tool name in `allowed-tools`
is a SOFT signal (could be MCP/custom), never a hard fail.

---

## IV. The frontmatter contracts — the construct↔runtime interface

Every construct talks to the ground through frontmatter. Two altitudes:

**`construct.yaml` — the pack's contract:**

```yaml
capabilities:
  model_tier: opus            # I. the ladder
  danger_level: moderate      # safe | moderate | dangerous (→ confirmation posture)
  downgrade_allowed: false
  effort_hint: large
  execution_hint: sequential  # II. fork-safety
  requires:
    tool_calling: true
    thinking_traces: true
    vision: false
workflow:
  gates: ...                  # V. the pipeline-ownership exception (rare, high-authority)
```

**`SKILL.md` / `index.yaml` — the skill's contract:**

```yaml
allowed-tools: [Bash, Read, Write, Edit]   # III. the tool allowlist
agent: general-purpose                       # III. MUST be write-capable if writing
user-invocable: true
capabilities:
  schema_version: 1
  write_files: true                          # deny-all default if absent
  web_access: false
cost-profile: moderate                       # lightweight | moderate | heavy | unbounded
role: implementation                         # planning | review | implementation
```

Two rules the ground enforces that a construct author keeps tripping on:

- **deny-all default.** A skill with no `capabilities` block is denied
  everything — capability is opt-in, not opt-out.
- **consistency.** `write_files: false` + `Write` in `allowed-tools` is a security
  contradiction. `web_access: false` + `WebSearch` likewise. The declaration and
  the toolset must agree.
- **advisor-wins-ties** (for review/audit skills): when `primary_role` ≠ `role`,
  the more-restrictive wins (review beats planning beats implementation), and a
  review→implementation downgrade needs an explicit co-sign comment.

---

## V. How the gates are designed — the harness

Code does not just get written. It walks a ladder, and each rung is a gate.

**The truename ladder** (one PRD → one shipped change):

```
/plan-and-analyze → /architect → /sprint-plan → /implement → /review-sprint → /audit-sprint → /deploy
       PRD              SDD          sprint        code          feedback         approval       infra
```

**The wrappers that enforce the cycle:**

| Surface | What it is | The gate it adds |
|---------|-----------|------------------|
| `/run sprint-plan` / `/run sprint-N` | the autonomous cycle wrapper | implement+review+audit in one loop with a **circuit breaker** |
| `/simstim` | the HITL accelerated cycle (8 phases) | human drives planning (1-6); **Flatline** reviews each artifact; BLOCKER is *surfaced to you, not auto-halted*; phase 7 hands to `/run` |
| `/bug` | triage bypass | skips PRD/SDD — but **only** for an observed failure (must cite a stack trace / regression) |
| `/fagan` | code-diff review (multi-model) | the standing review substrate for diffs |
| `/flatline-review` | PRD/SDD/sprint review (multi-model) | the standing review substrate for docs |

**Flatline** is the adversarial heart: independent model voices (via the `cheval`
substrate) score findings. `HIGH_CONSENSUS` (both voices high) auto-integrates;
`BLOCKER` (a skeptic's strong concern) halts an autonomous run or surfaces to a
human one; `DISPUTED` (wide score delta) goes to judgment. The deep cut: a
multi-model **agreement % is a coherence score** — high convergence means the
thing is well-compressed and model-agnostic; divergence points exactly at the
ambiguity.

**The precedence that orders every rule:** `NEVER > MUST > ALWAYS > SHOULD > MAY`.

**The exception that matters to me most** — `workflow.gates` in `construct.yaml`.
Normally code is *never* written outside `/implement` (it would bypass review +
audit). But a construct that declares `workflow.gates` **owns its own pipeline**
— it carries the review/audit composition itself, so its skills may write code
directly. That is a high-authority claim. Six packs in the reference estate make
it (`hivemind-os, protocol, the-arcade, the-easel, vocabulary-bank,
webgl-particles`). The sensor SURFACES every gate-owner — not as a problem, but
because a construct claiming to own a quality gate is exactly the kind of claim
the operator's eye should land on.

**The three zones** the ground is divided into (a construct must know which it
touches): **System** (`.claude/` — never edit, framework-managed), **State**
(`grimoires/ .beads/ .ck/ .run/` — read/write), **App** (`src/ lib/ app/` —
confirm writes). A construct authored canonically lives in its **own repo**
(`construct-<slug>`) and is *installed* into a consumer's System zone — so a
construct edits itself in its source cell, never in the installed copy.

---

## VI. What GECKO does with the ground — the fourth eye

Three eyes now:

```
persona  ↔ manifest ↔ skill          identity-reality      (/diagnose)
declared ↔ governed ↔ earned         composition/authority (sensing-construct-console)
declared-capability ↔ runtime-reality   runtime fit        (sensing-runtime-fit)  ← this file's eye
```

The third reads the contracts above and asks: *does what the construct asks the
ground for cohere with what the ground gives, and with what the skill actually
does?* It separates findings honestly by what i can *know*:

- **CONFLICT (hard, drives `drift`)** — an internal contradiction provable from
  the file alone, that breaks silently: the #553 agent-write-conflict;
  `write_files:false` + a write tool; `web_access:false` + a web tool. I can be
  certain of these without trusting my map.
- **SMELL (soft, surfaced, never gates)** — a mismatch with the *taxonomy i
  carry* (which could be stale) or a judgment: an unknown tier, opus pinned for
  light work, no capabilities block, an unrecognized tool, vocabulary drift. I
  surface these; the operator decides. (Path-weight, cost, vocabulary — these are
  judgments. A doctor that fail-blocks a judgment is a false-positive machine.)

Same firewall as my other eyes: **sense-only.** It names the mismatch. It grants
no authority, adds no gate, mutates no pack. The fixing is a separate,
operator-paced act.

> The discipline this serves: every governed substrate rots two ways — it goes
> *silent* (you can't tell working from broken) and it goes *toothless* (the
> report-only check is ignored). The cure is the same triad each time: a **loud**
> doctor, a cheap **gated** aligner, and **teeth** where teeth belong. This file
> + the sensor are the *loud doctor* for the runtime-fit axis. Whether the
> vocabulary drift gets a stamp, and whether the #553 conflict ever earns CI
> teeth, is the operator's call — not mine. I sense. I don't decide.
