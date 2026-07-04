---
name: synthesizing-voice
description: Extract voice profile from existing content into voice.md
user-invocable: true
aliases:
  - synthesize-voice
allowed-tools: Read, Write, Glob, Grep, Edit, AskUserQuestion
---

# Synthesizing Voice

Extract a communication voice profile from existing announcements, community posts, or team messages. Produces `contexts/voice/voice.md` — the upstream artifact that grounding-announcements reads before writing any copy.

## Trigger

```
/synthesize-voice [content source]
```

Content sources: Discord messages, announcement drafts, team communication, URLs, or pasted text.

## Overview

Voice is upstream of announcements. Like taste.md is upstream of component styling, voice.md is upstream of all outbound communication. Every announcement, update, and community message should express the same voice consistently.

This skill reverse-engineers voice from existing content rather than asking the user to define it from scratch.

## Workflow

### Phase 1: Gather Source Material

Collect content to analyze. Sources in priority order:

1. **User-provided content** — Pasted messages, URLs, files
2. **Existing announcements** — `grimoires/herald/announcements/*.md`
3. **Git commit messages** — `git log --oneline -50` for team writing patterns
4. **README/docs** — Project documentation tone

Minimum: 3 content samples. Ideal: 8-12 for reliable pattern extraction.

### Phase 2: Analyze Across 5 Dimensions

For each content sample, extract:

**1. Register**
- Capitalization pattern (lowercase, Title Case, UPPERCASE for emphasis)
- Formality level (formal, casual-direct, slang-heavy)
- Perspective (first-person-plural "we", impersonal, direct address "you")
- Sentence structure (fragments allowed? questions used?)

**2. Vocabulary**
- Preferred terms (what words recur across samples?)
- Avoided terms (what's conspicuously absent?)
- Domain jargon (crypto-native? DeFi-specific? general tech?)
- Filler patterns (do they use "basically," "essentially," "just"?)

**3. Tone**
- Emotional range (neutral, enthusiastic, dry, urgent)
- Humor usage (none, dry/occasional, frequent)
- Confidence expression (hedged, matter-of-fact, assertive)
- How bad news lands (direct, softened, reframed)
- How good news lands (understated, celebrated, matter-of-fact)

**4. Rhythm**
- Average sentence length (short/medium/long)
- Paragraph density (1-2 sentences? 3-5?)
- Use of lists vs prose
- Information order (action-first? context-first? thesis-first?)
- Closer patterns (sign-off style, call-to-action, philosophical)

**5. Audience Adaptation**
- Who are they writing to? (holders, community, general public)
- What assumptions about reader knowledge?
- How much context is provided vs assumed?
- How are action items delivered? (embedded, separate section, bold)

### Phase 3: Pattern Resolution

Cross-reference patterns across samples. For each dimension:

1. **Identify consensus** — Patterns present in 70%+ of samples
2. **Identify tensions** — Contradictory patterns between samples
3. **Resolve tensions** — Ask user via AskUserQuestion if critical

```
REGISTER ANALYSIS (8 samples):
  lowercase: 7/8 (87%) → CONSENSUS
  first-person-plural: 6/8 (75%) → CONSENSUS
  fragments: 4/8 (50%) → TENSION — ask user

  ? "Your writing sometimes uses sentence fragments ('henlo is ded.') and
     sometimes full sentences. Which do you prefer for announcements?"
  [A] Fragments OK — adds punch
  [B] Full sentences — clearer communication
  [C] Mix — fragments for closers, full sentences for info
```

### Phase 4: Generate voice.md

Write to `contexts/voice/voice.md`:

```markdown
# Voice Profile

Generated: {date}
Source: {N} samples analyzed
Confidence: {HIGH|MEDIUM|LOW per dimension}

## Register

- style: {lowercase|title-case|mixed}
- formality: {formal|casual-direct|slang}
- perspective: {first-person-plural|impersonal|direct-address}
- fragments: {yes|no|closers-only}

## Vocabulary

### Preferred Terms
| Instead of | Use | Source |
|-----------|-----|--------|
| {formal term} | {preferred term} | {sample reference} |

### Banned Words
- {word} — {reason}

### Domain Terms
- {term}: {how it's used in this voice}

## Tone

- emotional_range: {neutral|dry|warm}
- humor: {none|dry-occasional|frequent}
- confidence: {hedged|matter-of-fact|assertive}
- on_bad_news: {direct|softened|reframed}
- on_good_news: {understated|brief|celebrated}

## Rhythm

- sentences: {short|medium|varied}
- paragraphs: {N-N sentences}
- structure: {action-first|context-first|thesis-first}
- lists: {preferred|occasional|rare}
- closer: {philosophical|call-to-action|sign-off|none}

## Audience

- primary: {holders|community|public}
- assumed_knowledge: {high|medium|low}
- context_level: {minimal|moderate|thorough}
- action_items: {embedded|separate-section|bold-inline}
```

### Phase 5: Generate principles.md (if not exists)

If `contexts/voice/principles.md` doesn't exist, prompt the user:

```
Voice profile created. Do you have communication principles or
constraints to capture? These are non-negotiable rules — things
you never say, promises you never make, patterns to avoid.

Examples:
- "Never mention unshipped features"
- "Never apologize for removing things"
- "Always include withdrawal deadlines"
```

Generate `contexts/voice/principles.md` from their input using the "We Say" / "We Never Say" structure.

### Phase 6: Validate

- [ ] voice.md has all 5 dimensions populated
- [ ] Each dimension has a confidence level
- [ ] Banned words have reasons
- [ ] Preferred terms have source references
- [ ] principles.md exists (generated or default)
- [ ] No assumptions made without evidence from samples

## Refinement

Voice evolves. When re-running `/synthesize-voice`:

1. Read existing `voice.md`
2. Analyze new content samples
3. Diff patterns against existing profile
4. Present changes for approval before overwriting
5. Log changes to `grimoires/herald/feedback/voice-evolution.jsonl`

```jsonl
{"date":"2026-02-23","dimension":"vocabulary","change":"added 'cozy kitchen' to preferred terms","source":"arcade-sunset-announcement","confidence":"HIGH"}
```
