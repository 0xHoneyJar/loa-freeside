---
name: grounding-announcements
description: Convert product changes into grounded community announcements
user-invocable: true
aliases:
  - announce
  - community-update
allowed-tools: Read, Glob, Grep, Bash, Task, Edit
---

# Grounding Announcements

Convert product changes, feature removals, and releases into community-facing announcements grounded in code reality. Every claim is verifiable. Every date comes from git. Nothing is promised that hasn't shipped.

## Trigger

```
/announce [what changed]
```

## Prerequisites

Before writing, load two artifacts:

### 1. Voice Profile

Read `contexts/voice/voice.md` for register, vocabulary, tone, rhythm, and audience settings.

**If voice.md doesn't exist**, use these defaults:
- Register: lowercase, casual-direct, first-person-plural
- Vocabulary: no hype words, no corporate hedging, crypto-native
- Tone: neutral, matter-of-fact, dry humor when appropriate
- Rhythm: short sentences, action-first, brief paragraphs
- Audience: pragmatists who care about outcomes

### 2. Communication Principles

Read `contexts/voice/principles.md` for non-negotiable constraints.

**If principles.md doesn't exist**, enforce these defaults:

**We Say:**
- What shipped, grounded in code with dates from git
- Concrete external reasons for changes
- What was never built, labeled honestly
- Practical action items with deadlines

**We Never Say:**
- Forward-looking promises about unshipped work
- Internal feature names or screenshots
- Hype language to manage sentiment
- Apologies or hedges that frame curation as failure
- Timelines for things that haven't shipped

## Workflow

### Phase 1: Load Voice + Principles

```
Read contexts/voice/voice.md
Read contexts/voice/principles.md
```

Parse into working constraints for Phase 3.

### Phase 2: Research Code Reality

Check if a chronicle exists for the scope:

```
Read grimoires/herald/chronicles/{scope}-chronicle.md
```

If no chronicle exists, research directly:

**For removals/sunsets:**
```bash
# When did the feature first ship?
git log --all --oneline --grep="<feature>" --reverse | head -5

# What does the code actually do?
# Read the main component, page, route

# What contracts/integrations does it touch?
# Check constants, hooks, API routes

# Is there a sunset/deprecation marker?
# Look for SunsetBanner, isLocked, etc.

# What's the external reason?
# Check recent PRs, sprint docs
```

**For new features/releases:**
```bash
# What PR/commits introduced this?
git log --oneline --since="2 weeks ago" --grep="<feature>"

# What does the code do right now?
# Read the implementation files

# What's accessible to users?
# Check routes, navigation, locked states
```

**For structural changes:**
```bash
# What moved where?
git diff main -- <relevant files>

# What's the before and after?
# Read constants/navigation/routing
```

Collect for each item:
- **Date** (from git log)
- **Description** (from reading code)
- **Reason** (from external factors, PRs)
- **User action required** (withdraw, migrate, nothing)
- **Status** (shipped, never shipped, sunset, moved)

### Phase 3: Draft

Apply voice profile to structure. Choose template based on change type:

**Removal/Sunset:**
```
1. The action (what's being removed)
2. Grounded history (what these were, when, from code)
3. Concrete reason (why now — named external event)
4. Deadline + user action
5. What survives or changes
6. Closer (from voice.md rhythm.closer)
7. Itemized list (one-line descriptions from code)
```

**New Feature/Release:**
```
1. What shipped (present tense)
2. What it does (from code, not roadmap)
3. How to access it
4. Known limitations (if any, honestly)
```

**Structural Change:**
```
1. What moved/changed
2. What it means for users
3. What stays the same
```

### Phase 4: Validate Against Principles

Run every sentence through principles.md constraints:

```
VALIDATION PASS:

[ ] Every feature description matches what the code does
[ ] Every date comes from git history
[ ] Zero forward-looking statements
[ ] Zero mentions of unshipped features
[ ] Zero banned vocabulary (from voice.md)
[ ] Zero apologies or hedging
[ ] Practical action items are clear and deadlined
[ ] Things that never shipped are labeled as such
[ ] Concrete external reasons are named
[ ] Tone matches voice.md register
```

**If any check fails**, rewrite the offending sentence before proceeding.

### Phase 5: Cross the Markov Blanket (deterministic verify, then heal)

Phase 4 is HERALD's own subjective judgment. This phase is the deterministic floor it
cannot self-grade past (Honored Verification: the construct reasons, the tool verifies,
HERALD honors the exit code). The verifier is declared in `construct.yaml` (`verifiers[]`,
id `ai-stench`); GECKO owns its evolving lexicon.

1. Write the draft to a temp file (or pipe it via stdin).
2. Run the declared gate:
   ```bash
   node scripts/ai-stench-check.mjs --json <draft>   # or:  printf '%s' "$draft" | node scripts/ai-stench-check.mjs -
   ```
3. **If exit 1** (any HIGH marker, for example an em dash or the "it's not X, it's Y" cadence
   or the LLM lexicon): read `hits[]`, rewrite ONLY the flagged spans in human voice, then
   re-run. Loop until exit 0. Do NOT rationalize a near miss; the exit code is the gate, not
   your opinion of it.
4. **Only on exit 0** does the announcement cross into Phase 6. Emit `forge.herald.stench_gated`
   with `{scope, high: 0, verdict: "honored"}`.

### Phase 6: Deliver

1. Copy final announcement to clipboard (`pbcopy`)
2. Present in conversation for review
3. Archive to `grimoires/herald/announcements/{date}-{scope}.md` with metadata:

```markdown
---
date: {ISO date}
scope: {what changed}
type: {removal|release|structural}
voice: {voice.md hash or "defaults"}
principles: {principles.md hash or "defaults"}
evidence:
  commits: [{hashes}]
  files_read: [{paths}]
  dates_verified: true
---

{announcement text}
```

## Counterfactuals

### The Target (Grounded, Verifiable)

```
we have initiated the self-destruction of the following apps from the henlo arcade.

these shipped with the arcade in september. vault and lock earned BGT and oBERO
through AquaBera and Beradrome. wall turned liquidity deposits into a community
brick feed. incineraffle and casting never left the lobby.

berachain's POL update removed the reward flows these depended on. rather than
patch around it, we're removing them.
```

Every claim is verifiable. Dates from git. Descriptions from code. Reason is a named external event. Unshipped features called out honestly.

### The Near Miss (Sounds Right, But Wrong)

```
after careful consideration, we've decided to sunset several arcade features
as we streamline the henlo experience for the next chapter.
```

"Careful consideration" is vague. "Streamline" is corporate. "Next chapter" is forward-looking. None of it is grounded. It reads like every other project sunset announcement because it's not built from evidence.

### The Category Error (Catastrophic)

```
we're removing some features now but trust us, what's coming next is going to
blow your minds. we've been cooking something huge. stay tuned.
```

This converts a neutral announcement into a forward-looking promise. Six months later, if "what's coming" hasn't shipped, this screenshot becomes evidence of another broken promise. This is the exact pattern that destroys team credibility over time.

## Quick Reference

```
LOAD:
  voice.md           <- tone, vocabulary, register, rhythm
  principles.md      <- "we say" / "we never say" constraints

RESEARCH:
  git log dates      <- never guess dates
  read components    <- describe what code does
  check contracts    <- name integrations accurately
  find the "why"     <- external reasons > internal feelings

DRAFT:
  lead with action   <- what happened, first sentence
  ground in history  <- when it shipped, what it did
  name the reason    <- concrete, external, verifiable
  practical actions  <- what users need to do now
  itemize changes    <- one line per item, past tense for removed

VALIDATE:
  principles check   <- every sentence against constraints
  voice check        <- tone, vocabulary, banned words
  evidence check     <- every claim traceable to git/code

NEVER:
  forward-look       <- the future announces itself when it ships
  hype               <- no "stay tuned," no "something big"
  apologize          <- curation is not failure
  hedge              <- "unfortunately" is banned
  promise            <- words don't ship, code does
```
