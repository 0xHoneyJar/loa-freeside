# Component & Surface Architecture

Component inventory organized by **surface domain**. Each maps to a register/context and consumes only Layer-2 semantic tokens (or its own Layer-3 component tokens that resolve to them).

> ⚖ FORK: this covers the **full multi-surface system**. Build only the domains in your confirmed scope; delete the rest.

---

## 1. Composition model

- **Primitives** (cross-domain): `Band`, `Split`, `Card`, `Hairline`, `AxialRule`, `SectionIndex`, `Tag`, `Button`, `IconBadge`, `Field`, `Table`, `WordmarkLockup`, `Monogram`, `FooterBand`.
- **Component tokens** (Layer 3) resolve to semantics, e.g. `--fs-button-bg: var(--fs-accent-authority)`, `--fs-card-line: var(--fs-line-hairline)`. Never skip to primitives.
- **Register/context** is set on a container; children adapt automatically. A component never hard-codes a palette color.
- **States** every interactive component declares: default, hover, active, focus-visible (2px sunset outline, offset 2px), disabled, loading.

---

## 2. Domain: Brand & Marketing _(light register; the paradise voice)_
| Component | Purpose | Key tokens / notes |
|---|---|---|
| `WordmarkLockup` | The FREESIDE + axial + motto asset | display font, `--fs-rule-axial`; size variants per `type.md §4` |
| `HeroBand` | Full-bleed brand hero | `--fs-elev-sky` permitted here; Split with feathered image |
| `MoodStrip` | The day→night image arc | strip of feathered images + caption labels |
| `PromiseTriad` | FREE PORT / PROVE CREDIT / EVERYTHING | IconBadge + heading + one line |
| `TaglineStrip` / `FooterBand` | Authority footer | **deep-space register**; tagline + JP + coordinates + monogram |
| `PullQuote` | Voice lines / lore quotes | tier 08 elite for dynastic, tier 04 for guest |

## 3. Domain: Hospitality _(light register; softness earned here)_
| Component | Purpose | Notes |
|---|---|---|
| `RateCard` | Room/suite + price | tier 03 heading; `--fs-radius-md` allowed; Bermuda Sunset price |
| `RoomTile` | Property/room in a grid | feathered image top, Split body |
| `BookingBar` | Dates / guests / search | Field primitives; sunset primary Button |
| `AmenityList` | Icon + label rows | IconBadge line icons |
| `ConciergePanel` | Guest services / requests | organic softness ok; Cannes-sky accents |
| `Menu/Collateral` | Dining menu, brochure | tier 03 + tier 08 for fine dining; Rose Brick / Organic Chic Sand materials |

## 4. Domain: Wayfinding & Public Information _(light register; tier 05)_
| Component | Purpose | Notes |
|---|---|---|
| `Directory` | Location list / index | tier 05; SectionIndex numerals; square |
| `SignPanel` | Street/level signage (Desiderata St, Rue Jules Verne) | bilingual; high-contrast; arrows |
| `MapLegend` | Station map key | line icons; Cannes Sky routes |
| `Kiosk` | Interactive public terminal | large hit targets (≥44px); tier 05 |
| `NoticeBar` | Public notice / status | state tokens; hazard for service alerts |

## 5. Domain: Credit & Access _(systems context; tier 07 OCR-B, teal ink)_
| Component | Purpose | Notes |
|---|---|---|
| `CreditChip` | Bank chip / balance | mono numerals, tabular; the one ink on card |
| `AccessPanel` | Door / gate number + state | OCR-B; state-positive/critical lock states |
| `CustomsForm` | "Prove credit" flow | teal systems context; verified checkmarks |
| `TransactionRow` | Ledger / transaction display | tabular mono; hairline grid |
| `TerminalReadout` | Machine-read status | deep-space register; monospace; scanline restraint |

## 6. Domain: Operations & Infrastructure _(tier 06 DIN; neutral)_
| Component | Purpose | Notes |
|---|---|---|
| `TechLabel` | Equipment/label tag | tier 06; hazard striping where safety-relevant |
| `DiagramFrame` | Schematic / system diagram | Lado-Acheson wireframe motif; sunset line-art |
| `MaintenanceTag` | Robot/service marker | yellow-black hazard; `--fs-hazard` |
| `StatusGrid` | Systems health | state tokens; dense tabular; hairlines |
| `Manual/DocBlock` | Technical documentation | tier 06 body; numbered sections |

---

## 7. Cross-cutting patterns
- **Section index (`01`–`09`)** threads long surfaces (boards, docs, directories) — a structural wayfinding constant.
- **The authority footer** recurs across every full page — the "inside the machine" signature.
- **Bilingual headers** (Latin + JP companion) are the default for signage and section headers.
- **Accent discipline** is enforced structurally: a component can only reach a controlled accent by being inside its `data-context` — there is no generic "primary color" beyond Bermuda Sunset.

---

## 8. Templates (post-component, copyable starting points)
Prioritize per scope: **Brand/marketing deck** · **Hotel collateral** (menu, key card, invitation) · **Wayfinding signage sheet** · **Credit & access terminal** · **Guest booking / rate screen**. Each is a composition of the primitives above at a fixed layout, in the correct register/context.
