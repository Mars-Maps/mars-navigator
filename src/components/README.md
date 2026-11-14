# Design system: usage note

Dark, quiet, data-first. A scientific instrument, not a game. Every token is
defined once in `src/index.css` (`@theme`). Use the utilities it generates.
**Do not use raw palette classes** (`text-neutral-400`, `bg-amber-500`), hex
values, or arbitrary sizes (`text-[10px]`) in components.

## Colour

| Role | Utilities |
|---|---|
| Page background | `bg-canvas` |
| Panel / raised surface | `bg-surface`, `bg-surface-raised` |
| Borders, dividers | `border-line`, `border-line-strong` |
| Primary text, values | `text-ink` |
| Secondary text, table data | `text-ink-muted` |
| Labels, provenance, hints | `text-ink-subtle` |
| Interactive / selected | `text-accent`, `bg-accent/15` |
| Errors and failures | `text-danger`, `bg-danger/10`, `border-danger/40` |

**Classification colours** (`official`, `derived`, `simulated`, `unavailable`)
are used only to show where data came from. Do not use them for decoration or
status. Use `<ClassificationBadge>` or `ClassifiedValue` rather than styling
classification by hand. Simulated data must stay visibly labeled, and
`UNAVAILABLE` must render as unavailable, never as `0` or a blank.

The badge is a small translucent "i" mark. The class
name and the `detail` you pass — a source, method, reason, or the sentence
that explains the value — are always in the DOM for assistive tech and show
in a tooltip on hover and keyboard focus, never on click. So: keep the line
beside the mark to the value or a few words, and put the rest in `detail`.

```tsx
<ClassificationBadge classification="DERIVED" detail={method} />
<ClassificationBadge classification="UNAVAILABLE" detail={reason} />   // next to the word "unavailable"
<ClassificationBadge classification="DERIVED" passive />              // no tooltip, no tab stop: for a label the pointer cannot reach
```

## Type

Choose a size by its role:

| Utility | Size | Use |
|---|---|---|
| `text-micro` | 11px | badges, table headers (uppercase) |
| `text-caption` | 12px | provenance, secondary notes |
| `text-body` | 14px | default UI text and data |
| `text-heading` | 18px | panel titles |
| `text-display` | 30px | the app title only |

Use `tabular-nums` on every number that can change or sits in a column.

## Spacing

The base is Tailwind's 4px grid. Stick to these steps: `1` (4px), `2` (8px),
`3` (12px), `4` (16px), `6` (24px), `8` (32px). Panels use `p-6`. Use `gap-2`
inside a row and `mb-6` between sections.

## Surfaces

```tsx
import { Panel } from '../../components/Panel'

<Panel>…</Panel>                  // solid: default, for dense data
<Panel surface="glass">…</Panel>  // translucent: only over the 3D view
```

Corners: `rounded-panel` for panels, `rounded-control` for buttons, inputs and
badges.

**Title bar.** A window that can fold to one line wraps its heading in
`PanelHeader`, with the state from `useMinimized`, and hides its own body:

```tsx
const { minimized, toggle, bodyId } = useMinimized()

<Panel surface="glass" compact={minimized}>
  <PanelHeader title="Hazards" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId} spacing="mb-3">
    <h2>Hazards</h2>
  </PanelHeader>
  {!minimized && <div id={bodyId}>…</div>}
</Panel>
```

Pass `onClose` only when the bar is the window's way to close. A window
opened by a button elsewhere (the layer menu, tool panels) takes no ×. Keep
anything the user must always reach on the bar, as the destination bar does
with End navigation.

## Interaction

- **Focus:** a global `:focus-visible` ring is applied to everything. Do not
  remove it with `outline-none` unless you replace it with something equally
  visible.
- **Hover:** a quiet change only, e.g. `hover:bg-surface-raised` or
  `hover:text-ink`. No scaling, glows or colour flashes.
- **Every control** must be reachable and usable with the keyboard alone.

## Motion

Motion is short, functional, and never decorative.

- `transition-colors` uses 150 ms `ease-standard` by default.
- `duration-(--duration-fast)` (120 ms) is for hover, focus and press;
  `duration-(--duration-base)` (200 ms) is for panels and content changes.
- No bounce, spring, or looping animation in the UI.
- `prefers-reduced-motion` is respected globally, so you do not need to handle
  it per component.
