# Color System

Hex values are **canonical** (the 2026-07 palette handoff). OKLCH is the recommended *working* space — generate tints, shades, and state variants in OKLCH at build time for perceptual uniformity, then emit hex/sRGB + optional P3. Do not hand-author derived shades in hex.

**Plain-name → role map** (the handoff used generic names; the system keeps the brand names):

| Handoff | Hex | Freeside role |
|---|---|---|
| black | `#081F28` | Deep Space Ink |
| cream | `#F7F1E5` | Lado Sunlight |
| gray | `#C1BCB3` | Lunar Concrete |
| blue | `#66ADC6` | Cannes Sky |
| green | `#6E7A56` | Babylon Foliage |
| sand | `#CEBA99` | Organic Chic Sand |
| silver | `#D1D9DB` | Cold Mist |
| brick | `#936064` | Rose Brick |
| magenta | `#E1588E` | Casino Magenta |
| teal | `#58988B` | Clinic Teal — systems |
| sunset | `#C8705B` | Bermuda Sunset — authority + programmed sunset |
| yellow | `#F7D481` | Maintenance Hazard |

---

## 1. Main palette — Layer 1 primitives

The five brand mains. Everything structural rests on these.

| Token | Name | Hex | Meaning / role |
|---|---|---|---|
| `--fs-deep-space-ink` | Deep Space Ink | `#081F28` | The void; authority. Primary ink on light; base of the deep register. |
| `--fs-lado-sunlight` | Lado Sunlight | `#F7F1E5` | Brilliant artificial sun. **The base.** Warm mineral off-white. |
| `--fs-lunar-concrete` | Lunar Concrete | `#C1BCB3` | Pale terraces, structural stone. Warm structural neutral. |
| `--fs-cannes-sky` | Cannes Sky | `#66ADC6` | Recorded Mediterranean sky. Endless, calm. Environmental. |
| `--fs-babylon-foliage` | Babylon Foliage | `#6E7A56` | Engineered gardens, cultivated nature. |

### Usage hierarchy (enforce as a design rule, not just guidance)
| Share | Band | Colors |
|---|---|---|
| **60%** | Light mineral base | Lado Sunlight, Cold Mist, Lunar Concrete |
| **20%** | Environmental | Cannes Sky, Babylon Foliage |
| **10%** | Ink / structure | Deep Space Ink, Lunar Concrete |
| **~5%** | Everyday accent | Bermuda Sunset |
| **~5%** | Contextual | Casino Magenta, Clinic Teal, Maintenance Hazard |

---

## 2. Secondary, tertiary & accents — Layer 1

**Secondary (3) — neutrals & materials.** Everyday support alongside the mains.
| Token | Name | Hex | Use |
|---|---|---|---|
| `--fs-organic-sand` | Organic Chic Sand | `#CEBA99` | Wicker, fabrics, handmade luxury |
| `--fs-cold-mist` | Cold Mist (silver) | `#D1D9DB` | Mists, glass, water, atmosphere |
| `--fs-brick` | Rose Brick | `#936064` | Natural woods, old-world luxury |

**Tertiary — context-locked** _(vice + clinical control — never together loosely)_
| Token | Name | Hex | Use |
|---|---|---|---|
| `--fs-casino-magenta` | Casino Magenta | `#E1588E` | Vice, nightlife, SimStim allure |
| `--fs-teal` | Clinic Teal | `#58988B` | Customs, systems, clinical corridors |

**Accents**
| Token | Name | Hex | Use |
|---|---|---|---|
| `--fs-bermuda-sunset` | Bermuda Sunset | `#C8705B` | **The signature everyday accent** — dynastic authority; also the programmed-sunset warm |
| `--fs-hazard` | Maintenance Hazard | `#F7D481` | Machinery, robots, service & safety (fill only) |

> `--fs-cold-mist-light` `#E7ECEE` is a derived lightening of Cold Mist for raised surfaces — not a named brand color.
> **Bermuda Sunset** is categorized as an accent but is the one used everyday (authority, hairlines, the axial device); the tertiaries and Hazard are strictly contextual.

---

## 3. Ink — Layer 1, functional

**There is one ink.** Of the five mains only two hold contrast as letterforms, so the ink table has exactly two entries — one per register.

| Token | Name | Hex | Use |
|---|---|---|---|
| `--fs-deep-space-ink` | Deep Space Ink | `#081F28` | **The ink on light.** Also the deep register's base surface. |
| `--fs-lado-sunlight` | Lado Sunlight | `#F7F1E5` | **The ink on Deep Space.** Also the light register's base surface. |

Neutral support — achromatic descendants of the two above, not new hues:

| Token | Hex | Use |
|---|---|---|
| `--fs-ink-2` | `#2C3E47` | Secondary text on light (Cold Mist on deep) |
| `--fs-ink-3` | `#6B6862` | Muted text on light (Lunar Concrete on deep) |
| `--fs-critical` | `#B23A2E` | Deep red — a **fill**, never text |

---

## 4. The one-ink rule (critical)

**Colour is a fill, never a letterform.**

The mid-tones are materials and large-area accents. They appear as bars, dots, rules, tints, and icon strokes — never as text. Anything that must be read is the one ink.

| Carries meaning as a FILL | Reads as TEXT |
|---|---|
| Bermuda Sunset · Babylon Foliage · Clinic Teal · Cannes Sky · Maintenance Hazard | Deep Space Ink (light) · Lado Sunlight (deep) |

**Why this and not a per-colour ink table.** The alternative — giving every mid-tone a dark ink *and* a light ink, eight derived hexes in total — was tried and rejected. It introduced colours that are not in the brand palette, and it made the deep register correct only so long as every author remembered to remap every `*-ink`; three separate contrast bugs came from exactly that lapse. Collapsing the table to one ink removes the class of bug: there is nothing chromatic to remap, so nothing can leak between registers.

**Pattern to use instead of coloured text** — state-code the element, not the letters:

- a 3px rule under a figure
- a dot before a label
- a tint behind mono text
- a solid fill with `--fs-on-accent` text

> The `*-ink` semantic tokens still exist (`--fs-state-positive-ink`, `--fs-accent-sky-ink`, …) and all resolve to `--fs-ink-primary`. They are kept so component code reads intentionally, and so a future register can redefine them in one place.

**A custom-property alias resolves where it is DECLARED, not where it is used.** `--fs-state-positive-ink: var(--fs-ink-primary)` written in `:root` computes to the *light* literal and inherits that frozen value into the deep register. So every `*-ink` alias must still be **repeated verbatim inside each `[data-register]` block** — identical expression, different resolution. The one-ink rule removes the need for distinct chromatic *values* per register; it does **not** remove the need to redeclare. A register block that redeclares only surfaces and `--fs-ink-primary` will silently paint dark-on-dark.

> Note the TS mirror (`starter/tokens.ts`) hardcodes literals per register, so it cannot exhibit this bug — a discrepancy that can hide the CSS defect if you check only the TS side.

---

## 5. Semantic layer (Layer 2) — register-aware

Components consume these, never the primitives. Values shown per register.

| Semantic token | Light (Paradise) | Deep Space (Authority) |
|---|---|---|
| `--fs-surface-base` | Lado Sunlight `#F7F1E5` | Deep Space Ink `#081F28` |
| `--fs-surface-raised` | Cold Mist Light `#E7ECEE` | `#0E2A34` (ink +L) |
| `--fs-surface-sunk` | Cold Mist `#D1D9DB` | `#04141B` (ink −L) |
| `--fs-surface-deep` | Deep Space Ink (constant band) | Deep Space Ink |
| `--fs-ink-primary` | Deep Space Ink | Lado Sunlight |
| `--fs-ink-secondary` | `#2C3E47` (ink +mid) | Cold Mist `#D1D9DB` |
| `--fs-ink-muted` | `#6B6862` (Ink 3) | Lunar Concrete `#C1BCB3` |
| `--fs-state-positive-ink` | Deep Space Ink | Lado Sunlight |
| `--fs-state-info-ink` | Deep Space Ink | Lado Sunlight |
| `--fs-state-caution-ink` | Deep Space Ink | Lado Sunlight |
| `--fs-line-hairline` | Bermuda Sunset @ ~28% | Bermuda Sunset @ ~42% |
| `--fs-line-structural` | Lunar Concrete `#C1BCB3` | `#22323A` |
| `--fs-accent-authority` | Bermuda Sunset (fill only) | Bermuda Sunset |
| `--fs-accent-sky` | Cannes Sky `#66ADC6` | Cannes Sky |
| `--fs-accent-sky-ink` | Deep Space Ink | Lado Sunlight |
| `--fs-accent-foliage` | Babylon Foliage (fill only) | Babylon Foliage |

### State tokens (semantic reuse of the palette)
Each state's colour is the **fill or dot**; its `*-ink` is the one ink.

| Token | Color | Note |
|---|---|---|
| `--fs-state-positive` | Babylon Foliage | foliage = healthy/live |
| `--fs-state-info` | Clinic Teal | systems context |
| `--fs-state-caution` | Maintenance Hazard `#F7D481` | machinery/safety — a fill or stripe; label it with the one ink |
| `--fs-state-critical` | **`#B23A2E`** (derived deep red) | **⚖ FORK** — brand has no true red; **Bermuda Sunset `#C8705B`** is the in-palette alternative. Confirm. |

### Context overlays (Layer 2, additive within a subtree)
| Context | Unlocks |
|---|---|
| `data-context="nightlife"` | `--fs-accent-vice: Casino Magenta`; permits neon/glow *inside this subtree only* |
| `data-context="systems"` | `--fs-accent-system: Clinic Teal/Ink`; OCR-B type tier |
| `data-context="environment"` | Bermuda Sunset (programmed sunset), foliage; atmospheric imagery |

---

## 6. Build notes
- Generate `hover`/`active`/`disabled` and 50–900 ramps in **OKLCH** (hold hue + chroma, step lightness) so Bermuda Sunset and foliage stay recognizable across states. Emit sRGB hex + `@supports` P3 for the saturated accents (magenta, sky).
- Verify contrast at the semantic layer: the one ink on every `surface-*` must clear WCAG AA (body 4.5:1, large 3:1) — which it does by construction, since the ink and the surface are opposite ends of the palette. Because no chromatic value is ever text, the mid-tones need no contrast audit at all; check only that fills read as distinct shapes.
- The Lado-Acheson sky gradient (the *only* gradient) is a named primitive, not ad-hoc: `--fs-lado-sky` runs Cannes Sky → light sky → Lado Sunlight → brilliant white axial slash.
