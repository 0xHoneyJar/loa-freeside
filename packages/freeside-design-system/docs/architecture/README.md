> ## ⚠ SUPERSEDED — historical decision record
>
> This folder is the **pre-rebuild** architecture spec. It was written before the system was
> built and the build diverged from it deliberately. Read it for rationale, not for values —
> several of its core decisions were reversed:
>
> | This document says | The shipped system does |
> |---|---|
> | Nine type tiers, nine faces | **Two faces** — Michroma display, Archivo everything else (`architecture/type.md`) |
> | Light is the default; dark is authority | **Deep Space is the default**; light (Paradise) is the exception |
> | `[data-register="deep-space"]` | `[data-register="deep"]` — and registers nest in both directions |
> | `[data-context="nightlife\|systems\|environment"]` overlays | `[data-accent]` **pairs**: `resort` `garden` `systems` `vice` `dynasty`. Two accents on screen, never one loose hue |
> | One gradient (the Lado-Acheson sky) | **No gradients.** The device was retired with the axial line and the T·A coin |
> | Branch strategy, coexistence flags, build phases | Already executed — historical |
>
> **The authoritative sources are the live files:** `tokens/` for values,
> `guidelines/doctrine-exposure.card.html` for how registers and accent pairs are chosen,
> `guidelines/doctrine-conformance.card.html` for the executable checks, and
> `templates/` for copyable starting points. The former `architecture/starter/` scaffold has
> been deleted — it was a second, contradictory token implementation; `tokens/` is the real one.

# Freeside Design System — Architecture & Systems Specification

**Tessier-Ashpool Holdings · brand-to-code architecture**
_Reference for the local rebuild. Source of truth for decisions; the values live in the companion files._

> "Paradise, but engineered." Everything below descends from that one line.

---

## 0. What this is (and how to use it)

This is the **architecture decision record** for rebuilding Freeside as a real, code-backed design system. It is deliberately implementation-agnostic — it specifies the *system* (layers, naming, values, rules, component inventory), not a particular framework — so it maps cleanly onto whatever the local build uses (CSS custom properties, a TS token object, Fable component docs, etc.).

Read order:

| File | Owns |
|---|---|
| `README.md` (this) | Thesis, register model, token-layer architecture, branch strategy, build phases, open forks |
| `color.md` | Full palette, semantic mapping, register overrides, the accent-vs-ink rule |
| `type.md` | 9-tier type system, font sourcing + substitution map, scale, wordmark lockup |
| `space-and-form.md` | Spacing, radius/form philosophy, elevation, grid, motion |
| `brand-and-icons.md` | Logo/wordmark/marks, iconography, imagery direction, voice |
| `components.md` | Token layering recap + component & surface architecture inventory |

The values in the companion files are canonical. Where I made a call you might want to revisit, it's flagged **⚖ FORK** inline and collected in §6 below.

---

## 1. Design thesis

Freeside sells **perfection**: Mediterranean skies, hanging gardens, luxury materials — a curated paradise wrapped around an orbital machine built for profit. The whole system encodes that duality. It is not decoration; it is the organizing principle.

Three governing decisions fall out of it:

1. **Light is the default; dark is authority.** The guest-facing world is the mineral-and-sunlight paradise (light register). Darkness — Deep Space Ink — is reserved for the machine underneath: Tessier-Ashpool authority, credit/access systems, the footer band, the void outside. You *earn* your way into the dark; it is never the ambient state. (Consumers should reach for the deep register intentionally, never as a default "dark mode.")

2. **Engineered, not organic — with organic reserved.** The structural language is architectural: square corners, thin sunset rules, a strict grid, numbered sections, precise motion. Softness (curves, generous radii, atmospheric blur) is a *contextual* privilege granted only to hospitality/environmental surfaces (gardens, spas, water). The grid is the machine; softness is the paradise painted over it.

3. **Restraint is the luxury.** 60% of every surface is quiet mineral base. Bermuda Sunset is the only everyday accent. The loud colors (Casino Magenta, Maintenance Hazard, Clinic Teal, Rose Brick) are *controlled* — each licensed to exactly one context (vice, machinery, systems, atmosphere) and never used as generic UI accent.

### Anti-slop guardrails (enforce in review / lint)
- **One gradient only:** the Lado-Acheson sky. No decorative gradients anywhere else.
- **No neon in the base system.** Neon/glow belongs exclusively to the Nightlife & Vice accent context.
- No rounded card + left-border-accent tropes, no emoji, no drop-shadow soup. Elevation is mineral tint + hairline first, shadow second.
- Bermuda Sunset is a *material*, not a highlighter — see the accent-vs-ink rule in `color.md`.

---

## 2. Token architecture (naming + layering)

Three layers. Components only ever consume layer 3 (or layer 2). Nothing consumes raw primitives directly.

```
Layer 1 — PRIMITIVES     raw, register-agnostic facts
  --fs-lado-sunlight, --fs-bermuda-sunset, --fs-space-4, --fs-size-3xl …
        │  (referenced only by layer 2)
        ▼
Layer 2 — SEMANTIC       role-based, register-aware (light | deep-space)
  --fs-surface-base, --fs-ink-primary, --fs-accent-authority, --fs-line-hairline …
        │  (the only layer components should normally touch)
        ▼
Layer 3 — COMPONENT      component-scoped, resolve to layer 2
  --fs-button-bg, --fs-card-line, --fs-terminal-ink …
```

### Naming grammar
`--fs-<category>-<role>[-<variant>][-<state>]`

- Prefix **`fs`** everywhere (CSS var + JS object namespace `fs.*`) so old (`--void-*`, `--navy-*`, `--tier-*`) and new never collide during the transition.
- Categories: `color`(primitive) · `surface` · `ink` · `line` · `accent` · `state` · `space` · `size` · `leading` · `tracking` · `radius` · `elevation` · `z`.
- Registers switch at **layer 2 only**, via a data attribute on a container:
  `[data-register="deep-space"]` (and contextual `[data-context="nightlife|systems|environment"]`). Primitives never change; components never branch on register.

### Dual emission
Author tokens once, emit twice: **CSS custom properties** (runtime theming, the register switch) *and* a **TS/JS token object** (type-safe references in components, build-time tooling). Keep them generated from a single source (JSON/YAML → both) so they can't drift. OKLCH is the recommended working space for generating tints/states — see `color.md`.

---

## 3. Register model

| Register | Trigger | Base surface | Primary ink | Use |
|---|---|---|---|---|
| **Light (Paradise)** | default | Lado Sunlight | Deep Space Ink | Everything guest-facing: brand, hospitality, wayfinding, retail |
| **Deep Space (Authority)** | `data-register="deep-space"` | Deep Space Ink | Lado Sunlight | Footer/authority bands, T-A dynastic comms, the void, hero contrast |
| **Nightlife / Systems / Environment** | `data-context="…"` overlays | inherits register | inherits | Licenses a single controlled accent + its type tier into a bounded zone |

Contexts are *additive overlays* on a register, not separate themes — a nightlife card can exist inside the light register and only unlocks Casino Magenta + the vice type treatment within its own subtree.

---

## 4. Branch & coexistence strategy

You asked to keep the existing system intact and switchable.

- **Branch off, don't mutate.** Cut `redesign/tessier-ashpool` (or `freeside-brand`) from the current `main`. The old void/navy/Dune-tier system stays whole on `main`; the rebuild lives on the branch until you choose to promote it. This is the clean switch — no runtime flag needed, git *is* the switch.
- **Only add a runtime brand flag if both must render live in one build.** If you truly need side-by-side, gate at layer 2 with `data-brand="freeside|legacy"` and keep two semantic files — but treat this as a temporary migration aid, not a permanent fork. Primitives and components stay single-source.
- **Retire, don't reuse, the old primitives.** `--void-*`, `--navy-*`, `--tier-*`, the `sietch/stilgar/operator` naming — none survive into the new semantic layer. Map anything worth keeping into the new grammar explicitly; delete the rest so the new system reads clean.

---

## 5. Recommended build order (phased)

1. **Tokens** — primitives → semantic (both registers) → dual emission (CSS + TS). Ship `color`, `type`, `space-and-form` values. *Foundation is buildable and testable before any component exists.*
2. **Type + wordmark** — load the font stack (see `type.md` sourcing fork), lock the FREESIDE lockup (wordmark + axial line + star + motto), numerals, JP companion.
3. **Primitives of form** — grid/band layout, hairline rules, elevation, icon frame system.
4. **Brand specimens** — wordmark lockups, color/mood specimen, type specimen, in the editorial board style.
5. **Components by domain** — build in the order your surface scope demands (see `components.md`): Brand → Hospitality → Wayfinding → Credit/Access → Operations.
6. **Templates** — copyable starting points (deck, collateral, signage, terminal) once components are stable.

---

## 6. Open decisions / forks to confirm

These are the calls I defaulted so the spec is complete and buildable. Revisit any:

- **⚖ Fonts** — defaulted to the **free web-substitute stack** (immediately buildable; see `type.md` for the full map + licensed-upgrade path). If you have the licensed families (Handel Gothic, Microgramma, ITC Avant Garde, Avenir Next World, Neue Frutiger, DIN 2014, OCR-B, Optima Nova, Tazugane), swap them in at the single `@font-face` layer — nothing else changes.
- **⚖ Surface scope** — spec covers the **full multi-surface system** (brand + hospitality + wayfinding + credit/access + operations). Trim `components.md` to the domains you actually build.
- **⚖ state/critical color** — the brand has no true red. Defaulted to a derived deep red; Rose Brick `#936064` is the in-palette muted alternative. Confirm or substitute (`color.md §5`).
- **Wordmark face** — **recommended: the extended-geometric Eurostile/Microgramma lineage (free: Michroma)** as the primary wordmark — it matches the drawn boards and embodies the engineered-orbital spine. Handel Gothic is the warmer advertising alternate; Chakra Petch is nightlife-context only. Full lore rationale + the per-face facet mapping in `type.md §2`.
- **Dark theme depth** — Deep Space is specified as an *authority register*, not a full parallel dark mode. If you want a complete dark UI theme (every component dark-native), that's a larger surface than specified — flag it and I'll extend the semantic overrides.
