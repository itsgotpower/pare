# Pare Design System

Brutalist bento aesthetic for a local-first personal finance app. The structure is
monochrome and hard-edged; **colour is reserved for data, never chrome**.

Source of truth:
- Tokens / theme — [`app/globals.css`](app/globals.css)
- Data palette — [`lib/colors.ts`](lib/colors.ts)
- Components — [`components/ui/`](components/ui/)
- shadcn config — [`components.json`](components.json)

---

## Principles

1. **Zero radius.** Every corner is square. This is enforced at the *token* level
   (see [Radius](#radius)), not by editing component class names.
2. **Monochrome chrome.** Backgrounds, cards, borders, and type are pure greyscale.
   1px borders are near-black on light / near-white on dark so structure reads hard.
3. **Colour = data only.** The earth-tone palette appears on category fills, chart
   dots, progress/goal bars, and transaction badges — never on borders, type, or layout.
4. **Mono, ALL-CAPS headings.** JetBrains Mono for headings; Geist for body.
5. **Bento layout.** Content sits in bordered `Card` tiles (`ring-1`), composed into grids.

---

## Radius

All radius tokens are hard-set to `0` in the `@theme inline` block of
[`app/globals.css`](app/globals.css):

```css
--radius: 0;
--radius-sm: 0;  --radius-md: 0;  --radius-lg: 0;
--radius-xl: 0;  --radius-2xl: 0; --radius-3xl: 0; --radius-4xl: 0;
```

> **Gotcha:** the shadcn components still carry `rounded-lg` / `rounded-xl` /
> `rounded-4xl` class names. They render square *only because the radius tokens
> resolve to 0*. Never hardcode a literal radius (e.g. `rounded-[8px]`) — it bypasses
> the token and visibly breaks the brutalist look. Add corner radius, if ever needed,
> by changing the token.

---

## Colour

### Theme (chrome) — monochrome OKLCH

Defined as CSS variables in `:root` and `.dark` ([`app/globals.css`](app/globals.css)).
Every value is `oklch(L 0 0)` — **zero chroma** — except `--destructive`, which is the
only chromatic theme colour.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` / `--foreground` | white / near-black | near-black / near-white | page |
| `--card` / `--card-foreground` | `0.985` / near-black | `0.15` / near-white | bento tiles |
| `--border` | near-black (`0.145`) | near-white (`0.93`) | 1px borders / rings |
| `--muted` / `--muted-foreground` | `0.96` / `0.45` | `0.2` / `0.6` | subdued surfaces & text |
| `--primary` | near-black | near-white | solid buttons/badges |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | errors only |
| `--link` | `#4d7691` (PALETTE.slate) | `#a6c0cd` (PALETTE.dustyblue) | inline text links only |
| `--chart-1…5` | grey ramp `0.145 → 0.85` | grey ramp `0.93 → 0.25` | monochrome chart fallback |

Sidebar tokens mirror the same greyscale.

**Inline links** are the second sanctioned chromatic exception (after `--destructive`):
underlined body-text links use the `.link` class (`app/globals.css`), coloured by
`--link` so they read as links instead of blending into copy. `.prose-pare a` gets the
same treatment automatically. Nav/menu links and button-shaped links stay monochrome —
the colour is for links *inside prose*, not chrome.

### Data palette — earth tones ([`lib/colors.ts`](lib/colors.ts))

The **only** place colour appears. A 12-colour muted palette:

`sage #8a9b66` · `greige #d6d3ca` · `mustard #e0a73a` · `lightgrey #cdccc7` ·
`wheat #e7d68c` · `dustyblue #a6c0cd` · `rose #cd9b8d` · `cream #ebe7da` ·
`espresso #473c37` · `celadon #c7d0a4` · `slate #4d7691` · `terracotta #b3654a`

- `CATEGORY_COLORS` — fixed map of category name → palette colour, tuned so the
  highest-volume categories stay visually distinct in the donut / breakdown.
- `categoryColor(name)` — use this for **any** per-category fill/dot/bar. Returns the
  mapped colour, or a deterministic hash into the palette for unmapped categories, so
  colours stay consistent across donut, by-category bars, transaction badges, goal
  bars, and category-page dots.

**Goal-bar convention:** category colour normally → `PALETTE.mustard` at 80–100% →
`PALETTE.terracotta` over budget.

---

## Typography

| Token | Family | Use |
|---|---|---|
| `--font-heading` (= `--font-mono`) | JetBrains Mono | headings, rendered **ALL-CAPS** via `font-heading` |
| `--font-sans` | Geist | body |
| `--font-mono` | JetBrains Mono | headings, code, numeric labels |

`html` defaults to `font-sans` ([`app/globals.css`](app/globals.css) base layer).

---

## Components

shadcn `base-nova` style — but built on **`@base-ui/react`, NOT `@radix-ui`**. This
changes the API in ways worth remembering:

- **No `asChild`.** Polymorphism is done with `useRender` + `mergeProps`
  (see [`badge.tsx`](components/ui/badge.tsx)), or by rendering the trigger as its own
  styled element. `DialogTrigger` has no `asChild`.
- **`data-slot` / `data-*` styling.** Components expose `data-slot`, `data-variant`,
  `data-active`, `data-size`, etc., and style off those attributes rather than threading
  conditional classes through props.
- **`cva` variants** define the visual options.

### Catalogue

| Component | Notable variants / props |
|---|---|
| `Button` | `default · outline · secondary · ghost · destructive · link` × sizes `xs · sm · default · lg · icon · icon-xs · icon-sm · icon-lg` |
| `Badge` | `default · secondary · destructive · outline · ghost · link` (polymorphic via `render`) |
| `Card` | sub-parts: `CardHeader/Title/Description/Action/Content/Footer`; `size="default" \| "sm"`; tile = `ring-1 ring-foreground/10` |
| `Tabs` | list `variant="default" \| "line"` (underline via `after:` pseudo); supports vertical `orientation` |
| `Table`, `Dialog`, `Select`, `Input`, `InputGroup`, `Progress`, `Separator`, `Skeleton`, `Sonner` | standard |

`InputGroup` and the Tabs `line` variant were adapted from
`chroma-core/chroma` `sample_apps/movies`.

### Adding components

- Aliases ([`components.json`](components.json)): `@/components`, `@/components/ui`,
  `@/lib`, `@/lib/utils`, icons via **lucide**.
- Match existing patterns: `cva` for variants, `data-slot` for identity, `useRender`
  for polymorphism, `cn()` for class merging.
- Keep chrome monochrome; pull any data colour from `categoryColor()` / `PALETTE`.

---

## Motion

Marketing surfaces only ([`app/globals.css`](app/globals.css)), all GPU-friendly
`transform` animations and all disabled under `prefers-reduced-motion: reduce`:

- `pare-rise` / `pare-grow` — one-shot bento reveal on mount (`scaleY` / `scaleX`,
  staggered via inline `animation-delay`).
- `pare-marquee` — 32s infinite horizontal footer ticker; pauses on hover.

---

## Quick reference

```tsx
import { categoryColor, PALETTE } from "@/lib/colors"

// data colour — always via the helper, never a hardcoded hex
<Dot fill={categoryColor(category)} />

// goal bar
const barColor =
  pct > 100 ? PALETTE.terracotta : pct >= 80 ? PALETTE.mustard : categoryColor(category)
```

- Chrome → theme tokens (`bg-card`, `border-border`, `text-muted-foreground`).
- Headings → `font-heading` + uppercase.
- Corners → leave the `rounded-*` classes alone; the tokens make them square.
