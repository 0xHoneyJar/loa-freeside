---
aliases: [words-with-teeth, rules-enforcement-level, controlled-vocabulary-doctrine, the-register-is-the-rail, provenance-tiers]
tags: [doctrine, onomatology, epistemology, legal-register, legba, accounting, load-bearing, REL]
sources:
  - operator 2026-06-11 — "in a case where... word usage is very precise, I think this is why the legba name is pretty helpful"
  - ES (validator wind-down chat) — "we cannot use that word at any given point... we're not regulated to use that word" (the live specimen: one wrong word = standing liability)
  - ES — "we have no accounting at all... different deals being done in different ways... how do u even do this" (tier-four-on-everything, felt from inside)
  - Fable/Opus measurement-register analysis (screenshot 2026-06-11) — "Opus says 'faster'; Fable states '20,120 XP/min, Strength 10→42'"
  - identity/GYGAX.md — "My name is a reference... I am named in that spirit" (naming-as-contract, already house practice)
  - MTG comprehensive rules + Rules Enforcement Levels — same game, declared enforcement posture
created: 2026-06-11
updated: 2026-06-11
confidence: 0.85
---

# Words With Teeth

> *You don't control outputs. You control the vocabulary and the crossings,
> and you declare which rooms the teeth are in.*

## 1 · REL — every context declares its enforcement level, up front

Borrowed whole from tournament Magic: the same game runs at **Casual REL** (take-backs,
intent honored, loose rulings) and **Competitive REL** (precise language binding, missed
trigger = penalty). The game never changes; the *enforcement posture* does — and it is
declared before play. Apply directly:

| REL | contexts | vocabulary | recorder | gates |
|---|---|---|---|---|
| **casual** | lore, creative, frontend, exploration, brainstorm | free — entropy is the point | optional | none |
| **competitive** | treasury, legal, comms about funds/custody, wind-downs, anything a regulator/auditor/counterparty may read | controlled (see §2) | mandatory | armed, fail-closed on mechanics |

The declaration is itself the consumption-gradient move: precision-tax is paid only where
precision has teeth, and precision-slack is impossible where it has consequences. A room,
a doc, a channel, a workflow — each carries its REL. Undeclared = competitive (fail-closed).

## 2 · The controlled vocabulary (starter lexicon)

At competitive REL these are not style preferences; they are rules text. A vocabulary
linter at the outbound-comms gate is the cheapest gate in the entire stack.

**Banned, with mandatory replacements:**
- **"offchain"** (for funds/records) — implies absence-of-ledger-record and custody; a
  legal claim we are not licensed to make. → *"unrecorded internal entry"*, *"not yet
  identified in the ledger"*, *"pending provenance"*. (Source: the live specimen. One
  word, standing liability, every future reader re-injected.)
- **"migration" / "transfer" of things whose ownership is unestablished** → *"proposed
  transition, ownership under provenance review"*.
- **"our funds" / "their funds" before tier-1 or tier-2 provenance exists** → name the
  wallet, the amount, the deal-id: *"the 256k seeded from wallet X under deal Y"*.

**Required taggings:**
- **Testimony tag** — any claim resting on memory carries `[testimony: <person>, conf=<L/M/H>]`.
  "The principal probably belongs to us" → "Principal believed THJ-owned [testimony: ES,
  conf=M; corroboration pending: Jani]". *Probably* is legal at competitive REL only
  inside a testimony tag. Untagged repetition launders testimony into fact; the tag is
  the anti-laundering seal.
- **Measurement register mandate** — claims that can carry numbers must: amounts, dates,
  parties, tx refs. Only concrete claims are gateable; a gate cannot validate "faster"
  and neither can an auditor. (Empirical note: register is model-visible — Fable
  defaults concrete at 1.5–5× Opus's rate; at competitive REL, mandate it regardless
  of model.)

## 3 · Provenance tiers — the epistemics column

Every claim in a competitive-REL ledger or document carries exactly one tier:

1. **attested** — on-chain ref / signed move record / gate token (the chain is already a
   CAS; transfers are content-addressed testimony you do not need to reconstruct)
2. **documented** — signed doc, contract, archived agreement
3. **testimony** — someone remembers; tagged per §2
4. **unknown** — named as unknown, owned by someone, with a next step

"We have no accounting" decompiles to: *operating at tier 4 on everything, untagged.*
The wind-down becomes tractable the moment every claim is tiered — "what do we actually
know" stops being a feeling and becomes a column. Forward rule: **no funds cross a seam
without a tier-1 record** — the multisig is a gate; the payload execution emits the token.

## 4 · Onomatology rule — names are deployed code

A name is a pointer into the prior (for models) and into the culture (for humans): the
cheapest API call that exists, invoked free forever after. Therefore names are reviewed
like deployed code at competitive REL: a good name carries its spec (Legba: salute-first,
nothing passes), and a wrong name is a **standing prompt injection** — it re-injects its
false claim into every future reader, including the ones with subpoena power. MTG's
templating discipline is the bar: *destroy / sacrifice / exile / dies* are four words
because they are four operations. One concept, one word; one word, one concept; defined
once, in the codex, linked everywhere.

## 5 · The practice

Declare REL at the door. Lint the vocabulary at the outbound gate. Tag testimony or
don't utter it. Put numbers where numbers can go. Tier every claim. Name things like
the name will outlive you — because at competitive REL, it will.

> Casual tables get rulings. Competitive tables get rules.
> Know which table you're sitting at before you speak.
