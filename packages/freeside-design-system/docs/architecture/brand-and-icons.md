# Brand Marks, Iconography, Imagery & Voice

---

## 1. Marks

| Mark | Description | Rules |
|---|---|---|
| **FREESIDE wordmark** | Display-face caps, wide-tracked | See `type.md §4`. The primary asset. |
| **Axial device** | Two thin sunset rules + centered four-point star | Part of the logo, not ornament. The Lado-Acheson sun. |
| **T·A monogram** | `T·A` in a thin sunset circle ("the size of a small coin") | Corporate/authority mark. Appears on collateral, signage corners, credit chips. |
| **Motto lockup** | `WHY WAIT?` beneath the axial device | Always uppercase, Bermuda Sunset, wide-tracked. |
| **Tagline strip** | `ORBITAL RESORT · FREE PORT · EVERYTHING FOR SALE` | Middle-dot separated, uppercase label tracking. |
| **Coordinates** | `35.6895°N 139.6917°E` | Mono (tier 07), sits in authority footer. |
| **JP lockup** | `フリーサイド` / `自由港` / `なぜ待つのか？` | Tier 09, alongside Latin. |
| **Domain strip** | `BANKS · BROTHELS · CASINOS · HOTELS · SPAS · LAKES · DREAMS` | The resort's offer, footer band. |

**Alternate mottos / voice lines:** "FREESIDE IS A PRIVILEGE. CREDIT IS THE KEY." · "Artificial sun. Endless sky." · "Paradise, but engineered."

### The three brand promises (icon triad)
`FREE PORT` — move freely · `PROVE CREDIT` — access is earned · `EVERYTHING` — for sale.

---

## 2. Iconography

Fine-line **circular badge** icons, as on the boards (palm, compass, cocktail, torii, gear, key, lotus, globe).

| Property | Spec |
|---|---|
| Base set | Phosphor **Thin/Light** as the glyph source; wrap in the circular frame |
| Frame | 1px sunset circle (the "coin" motif), glyph centered, generous inner padding |
| Stroke | Uniform hairline; matches `--fs-hairline` weight optically |
| Grid | 24px glyph on 48px circle (2× frame); scale in whole steps |
| Color | Bermuda Sunset on light; Bermuda Sunset/Sand on deep. Never filled/solid in the base system. |
| Motion | Static; may ignite (stroke draw) on the same signature reveal as the axial device |

Duotone/solid icons are **out** of the base system — line only. (Nightlife context may use filled neon glyphs within its subtree.)

---

## 3. Imagery direction

The boards establish a clear photographic world; codify it so consuming projects don't drift.

- **The day-to-night spectrum:** Impossible Daylight → Luxury by Design → Rue Jules Verne → Nightlife & Vice → Beyond the Surface → Old World Luxury → Programmed Beauty → Maintenance & Labor. Imagery should place itself somewhere on this arc and carry that arc's palette.
- **Signature treatment:** images **feather into the mineral base** at their inner seam (soft horizontal gradient mask to `--fs-surface-base`) — the recurring board move. No hard photo edges against content.
- **Register match:** daylight/hospitality imagery in the light register; nightlife/systems/void imagery only in deep-space or nightlife contexts.
- **Content:** engineered paradise — Mediterranean skies, hanging gardens, water, terraces of lunar concrete, the Lado-Acheson slash of white light overhead, drone microlights, yellow-black maintenance robots. Luxury surface, machine underneath.
- **The Lado-Acheson wireframe** (the axial sun structure) is a recurring technical illustration motif — thin sunset line-art on deep space.
- Use real/placeholder imagery; **do not** synthesize scene imagery in SVG.

---

## 3b. Station facts that constrain design

Four properties of the habitat. Each one is a hard design constraint, not flavor — they explain *why* the rules elsewhere in this spec are what they are.

**A · There are no windows to space.** The Lado-Acheson light-band manufactures dawn, day, and night; the "sky" is a projection carrying rendered constellations.
→ The single-gradient rule (`--fs-lado-sky`) isn't restraint for its own sake — that gradient **is** the sky, and a second gradient would imply a second sun. Night is the same band dimmed, so the deep register is a *dimming* of the light one, never a different world.
→ **Digital constellation motif** (deep register only): a sparse, evenly-spaced field of hairline four-point stars — the same star as the axial device, at 2–4px, on a strict grid, ≤4% coverage. Regularity is the point: real starfields are random, this one is *rendered*. Available as a background for authority bands and hero deep panels. Never in the light register.

**B · The biotech is one notch too perfect.** The meadows and trees are engineered to be "definitively treelike" — realer than real, which reads as slightly uncanny.
→ Foliage imagery and illustration should look **cultivated, not wild**: uniform canopies, visible planting rhythm, no dead leaves, no asymmetry. Where the system draws nature, draw it *on the grid*.
→ This is the license for Babylon Foliage to sit in a hard-edged square panel without irony. Nature here is a manufactured product, styled like one.

**C · Gravity is a gradient along one axis.** Centrifugal spin gives full g at the center, tapering to zero-g at both tips (where tourists hang-glide).
→ **Wayfinding is one-dimensional.** Order every directory, level list, and map legend along the axis — never alphabetically. Encode the g-value in mono beside level names (`LV 12 · 0.4g`). Full spec in `space-and-form.md §5`.
→ Density follows gravity as a layout metaphor: the center is dense, public, full-g (tight grid, full component set); the tips thin out (sparse layouts, more negative space).

**D · Villa Straylight is the authority pole.** At the spindle tip: cloning labs, cryonic chambers, and the mainframes housing the AIs.
→ It is the **fixed anchor of the deep-space register** — always Deep Space Ink, tier-08 elite type, T·A monogram, never public/wayfinding voice. If a surface is Straylight, it is dark, formal, and old-world by definition.
→ It is also where the system's warmth stops. No hospitality softness, no rounded corners, no sky. The paradise does not extend to the tip.

---

## 4. Voice & tone

- **Seductive, confident, slightly cold.** Freeside is selling you paradise and counting your money at the same time. Warm surface, transactional core.
- Short imperatives and offers: "Why wait?", "Prove credit.", "Everything for sale."
- Wayfinding voice (tier 05): plain, friendly, unambiguous. Operations voice (tier 06): terse, technical. Credit/access voice (tier 07): machine-precise. Dynastic voice (tier 08): formal, old-world, exclusive.
- Bilingual by default in signage and headers (Latin + JP companion).
