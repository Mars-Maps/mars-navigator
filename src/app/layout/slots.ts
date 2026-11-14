import type { ViewMode } from '../../state'

/**
 * Every panel position in the interface, and which view modes show it.
 * This file only decides where a panel sits and when it is visible; the
 * panel itself is built elsewhere and passed in by the shell.
 */
export interface SlotSpec {
  label: string
  modes: readonly ViewMode[]
  /**
   * Tailwind positioning within the full-screen layout. For a slot in a
   * column: its size only, never an edge offset — the column places it.
   */
  position: string
  /**
   * Slots in the same column stack top to bottom in SLOT_ORDER, with a gap,
   * so panels whose height depends on content cannot overlap. A
   * member that may outgrow the column takes `min-h-0 overflow-y-auto` and
   * scrolls; the others keep their size.
   */
  column?: ColumnId
  /**
   * Column members of one scroll group, next to each other in SLOT_ORDER,
   * draw inside one box that scrolls when the column runs out of room:
   * each keeps its own height, and the last ones go below the box's
   * bottom edge until scrolled to. A member of a group never scrolls itself.
   */
  scrollGroup?: ScrollGroupId
}

/**
 * The boxes a scroll group draws in. It shrinks first when the column
 * is short (min-h-0), so the caption and scale bar below stay on screen.
 * pb-2 with -mb-2 leaves room for the last panel's shadow, which reaches
 * 8 px below it (--shadow-panel), at no cost to the column's spacing. Without
 * that room a scroll box would clip the shadow.
 */
export const SCROLL_GROUPS = {
  navigation: 'flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain -mb-2 pb-2',
} as const

export type ScrollGroupId = keyof typeof SCROLL_GROUPS

/**
 * Where each column sits. A column is sized to its members, not the region,
 * so pointer events reach the globe between and below them.
 */
export const COLUMNS = {
  /**
   * The left edge, top to bottom: the route bar, the mode's detail panels
   * (navigation stacks four), then (pushed to the bottom) the surface
   * caption and the scale bar. The detail panels shrink and scroll, so the
   * caption is never covered: close-up's point menu by itself, navigation's
   * four as one scrolling stack at their own heights. gap-2 so
   * navigation's eight members fit 720 px.
   */
  left: 'left-4 top-4 bottom-4 items-start gap-2',
} as const

export type ColumnId = keyof typeof COLUMNS

const ALL: readonly ViewMode[] = ['welcome', 'close-up', 'navigation', 'surface']
/** Every mode with the globe on screen: all but surface, where the ground replaces it. */
const GLOBE: readonly ViewMode[] = ['welcome', 'close-up', 'navigation']

/**
 * Render order, which is also stacking order: later slots draw on top. A
 * column stacks where its first member falls (see arrange). The scene must
 * stay first so every panel sits above it.
 */
export const SLOT_ORDER = [
  'scene',
  'search',
  'intro',
  'destination',
  // Before the time menu, so the menu opens over the card rather than under it.
  'hud',
  'stopCard',
  'time',
  'iconPanel',
  'compass',
  'pointMenu',
  'toolDock',
  'terrainPlot',
  'hazards',
  'elevationProfile',
  'progress',
  // Last, so they come after the mode's detail panel within the left column.
  'coordinateTable',
  'caption',
  'scaleBar',
] as const

/** Derived from SLOT_ORDER, so a slot cannot exist without a place in it. */
export type SlotId = (typeof SLOT_ORDER)[number]

export const SLOTS: Record<SlotId, SlotSpec> = {
  scene: {
    label: 'Mars 3D view',
    modes: ALL,
    position: 'inset-0',
  },
  intro: {
    label: 'Intro panel',
    modes: ['welcome'],
    // Under the search bar, as in the intro design. Shrinks and
    // scrolls like the point menu, so the title's close button and the
    // caption and scale bar below stay on screen at 720 px.
    position: 'w-96 min-h-0 overflow-y-auto',
    column: 'left',
  },
  search: {
    label: 'Search bar',
    // In navigation it is the planned route's read-only summary line, above
    // the destination bar (as in the navigation design).
    modes: GLOBE,
    // peer/search: the point menu below it in the column follows the search
    // bar's toggle (aria-expanded) and is hidden while it is open.
    // Open (its toggle is the slot's only aria-expanded), min-h-0 lets the
    // column shrink the search bar, whose body scrolls, so the caption and
    // scale bar below stay on screen. Closed it is shrink-0: one summary
    // line, never squeezed with the point menu when the column runs out of room.
    position:
      'peer/search flex w-96 shrink-0 flex-col has-[[aria-expanded=true]]:shrink has-[[aria-expanded=true]]:min-h-0',
    column: 'left',
  },
  destination: {
    label: 'Destination bar',
    modes: ['navigation'],
    // At its own height, the first of navigation's scrolling stack:
    // the stack scrolls, not the bar, so the caption and scale bar at the
    // column's bottom stay on screen at 720 px.
    position: 'w-96 shrink-0',
    column: 'left',
    scrollGroup: 'navigation',
  },
  time: {
    label: 'Time menu',
    modes: ALL,
    // peer/time: the icon panel, a later sibling in SLOT_ORDER, follows the
    // menu's open state through its toggle's aria-expanded, which stays
    // local to TimeMenu.
    position: 'peer/time right-4 top-4 w-64',
  },
  iconPanel: {
    label: 'Icon panel',
    // Not on the surface: grid, zoom and layers act on the globe, and
    // the compass dial is always on there, so the panel has no buttons left.
    // An empty slot would still catch the pointer at the right edge.
    modes: GLOBE,
    // A column on the right edge, centred. While the time menu is open — at
    // 720 px tall it reaches past the screen's middle and would cover the
    // buttons — the column moves up beside it, on its left: right-72
    // is the menu's right-4 and w-64 plus a 1 rem gap. It used to become a
    // bar above the data-source label, over the walker widget, with the
    // layer menu squeezed into one row.
    // --icons-menu-top/-max: where IconPanel hangs the layer menu and how
    // tall it may grow, measured from the column's top. Time menu closed: 7
    // rem from the screen's top, below the collapsed menu (the column's top
    // is 50vh − 8 rem, half of h-64, so 15 rem − 50vh), ending 11 rem above
    // the bottom, over the walker widget and the compass. Open: level with
    // the column beside the menu, 14 rem short of the screen's height, so at
    // 720 px it ends at 512, above a tool panel at the bottom centre (its
    // top at about 520); taller, the menu scrolls. Each class is written out in full so Tailwind finds it.
    // z-20 while a sub-panel is open (its toggle is aria-expanded): the
    // layer menu draws over later slots.
    position: [
      'right-4 top-1/2 h-64 w-12 -translate-y-1/2 has-[[aria-expanded=true]]:z-20',
      '[--icons-menu-top:calc(15rem_-_50vh)] [--icons-menu-max:calc(100vh_-_18rem)]',
      'peer-has-[[aria-expanded=true]]/time:top-4 peer-has-[[aria-expanded=true]]/time:right-72',
      'peer-has-[[aria-expanded=true]]/time:translate-y-0',
      'peer-has-[[aria-expanded=true]]/time:[--icons-menu-top:0px] peer-has-[[aria-expanded=true]]/time:[--icons-menu-max:calc(100vh_-_14rem)]',
    ].join(' '),
  },
  hud: {
    label: 'HUD',
    modes: ['surface'],
    // Clear of the surface panel on the left and the time menu on the right.
    position: 'left-1/2 top-4 -translate-x-1/2',
  },
  stopCard: {
    label: 'Stop card',
    modes: ['surface'],
    // Under the closed time menu, above the compass dial.
    position: 'right-4 top-28 max-h-[calc(100vh-15rem)] overflow-y-auto',
  },
  compass: {
    label: 'Compass',
    modes: ALL,
    // The dial alone, while the icon panel's compass button is on.
    // Bottom right, on the walker widget's baseline and left of it (right-4,
    // 14 rem wide, so right-64 leaves a 1 rem gap), right of the tool dock:
    // it covers neither the time menu nor the layer menu nor the walker.
    position: 'bottom-14 right-64',
  },
  pointMenu: {
    label: 'Point menu',
    modes: ['close-up'],
    // Below the search bar, however many stops it has open; scrolls when the
    // column runs out of room. The search bar's width, w-96, so it lines up
    // with the route panel above it. At 1280 px, the smallest width the
    // layout targets, it ends at 400 px (the column starts at 1 rem), 48 px
    // before the tool dock's panel (24 rem centred, left edge at 448 px).
    // Hidden while the search bar is open: planning a
    // route needs the column's height, and the two crowded each other even
    // with the point menu paged down to one field. The menu stays
    // mounted, so closing the search bar (its toggle or Escape) shows the
    // selected point again as it was; `hidden` also takes it out of the tab
    // order and the accessibility tree meanwhile.
    position:
      'w-96 min-h-0 overflow-y-auto peer-has-[[aria-expanded=true]]/search:hidden',
    column: 'left',
  },
  coordinateTable: {
    label: 'Coordinate table',
    modes: ['close-up', 'navigation'],
    // Just above the caption. Its panel renders nothing while the
    // table is closed, so empty:hidden drops the slot and its column gap.
    // Open, it takes the caption's mt-auto: one auto margin, not two that
    // would split the free space and float the table mid-column. w-80
    // matches the caption's bound, clear of the tool dock.
    // peer/coords: the caption below follows whether it is open.
    position: 'peer/coords mt-auto w-80 empty:hidden',
    column: 'left',
  },
  caption: {
    label: 'Surface caption',
    modes: GLOBE,
    // mt-auto pushes it (and the scale bar after it) to the column's bottom,
    // unless the open coordinate table above it already does.
    // max-w-xs (20 rem) stays left of the tool dock (24 rem centred) down to
    // 1280 px wide.
    position: 'mt-auto max-w-xs peer-[:not(:empty)]/coords:mt-0',
    column: 'left',
  },
  scaleBar: {
    label: 'Scale bar',
    modes: GLOBE,
    position: 'w-40',
    column: 'left',
  },
  toolDock: {
    label: 'Tool dock',
    // On screen in every globe mode, alone at the bottom centre (as in
    // the design). Not in surface: the tools act on the globe, which is
    // not drawn there.
    modes: GLOBE,
    // `caption` and `pointMenu` are sized against this 24 rem width; change
    // them with it.
    position: 'bottom-4 left-1/2 w-96 -translate-x-1/2',
  },
  terrainPlot: {
    label: 'Terrain Profile 3D plot',
    // The tool's surface plot, in a box the user moves. The slot is only
    // the screen's top-left corner, a zero-size origin: the box inside
    // (`MovablePlot`) places itself from there in pixels, by default under
    // the time menu, left of the icon column and above the walker widget
    // (`defaultPlace` in terrainPlot/plotPlacement.ts), and steps aside
    // while the layer menu or the time menu is open over it.
    modes: GLOBE,
    position: 'left-0 top-0',
  },
  hazards: {
    label: 'Hazards',
    modes: ['navigation'],
    // Navigation's left stack, as designed: destination,
    // hazards, elevation profile, progress, then the caption and scale bar.
    // When the column runs out of room the four scroll together, each at its
    // own height: a panel with its own scrollbar reads as cut off,
    // and the stack's box keeps room for the shadows.
    position: 'w-96 shrink-0',
    column: 'left',
    scrollGroup: 'navigation',
  },
  elevationProfile: {
    label: 'Elevation profile',
    modes: ['navigation'],
    // In the left stack, so the bottom centre is the toolbar's alone.
    // Keeps its height and scrolls with the stack.
    position: 'w-96 shrink-0',
    column: 'left',
    scrollGroup: 'navigation',
  },
  progress: {
    label: 'Progress tracker',
    // Hidden for the final version: Travelled and Remaining are not
    // measured yet, so the panel only ever read "unavailable". Bring it back
    // as ['navigation'] once they are; the place below is kept for that.
    modes: [],
    // In the left stack, the last of the scrolling stack, at its own
    // height. Away from the right edge, the open time menu and the
    // icon panel's sub-panels no longer cover it.
    position: 'w-96 shrink-0',
    column: 'left',
    scrollGroup: 'navigation',
  },
}

/**
 * The slots a mode shows. "Hide all tools" (the context menu) leaves the
 * scene and the surface caption: provenance and the SIMULATED spin label
 * stay on screen whatever else is hidden.
 */
export function visibleSlots(viewMode: ViewMode, toolsHidden: boolean): SlotId[] {
  return SLOT_ORDER.filter(
    (id) => SLOTS[id].modes.includes(viewMode) && (!toolsHidden || id === 'scene' || id === 'caption'),
  )
}

/** What the layout draws, in stacking order: a lone slot, or a column of them. */
export type Placement =
  | { kind: 'slot'; id: SlotId }
  | { kind: 'column'; column: ColumnId; ids: readonly SlotId[] }

/**
 * Groups the visible slots for rendering. A column is drawn where its first
 * visible member falls in the order, so stacking against other slots does
 * not change; its members keep their order within it.
 */
export function arrange(visible: readonly SlotId[]): Placement[] {
  const out: Placement[] = []
  const placed = new Set<ColumnId>()
  for (const id of visible) {
    const column = SLOTS[id].column
    if (column === undefined) {
      out.push({ kind: 'slot', id })
    } else if (!placed.has(column)) {
      placed.add(column)
      out.push({ kind: 'column', column, ids: visible.filter((v) => SLOTS[v].column === column) })
    }
  }
  return out
}

/** A column's member as drawn: alone, or a run of one scroll group's members in their box. */
export type ColumnPart =
  | { kind: 'slot'; id: SlotId }
  | { kind: 'scroll'; group: ScrollGroupId; ids: readonly SlotId[] }

/**
 * A column's members in order, with each run of neighbours that share a
 * scroll group gathered into one part. Members keep their order.
 */
export function columnParts(ids: readonly SlotId[]): ColumnPart[] {
  const out: ColumnPart[] = []
  for (const id of ids) {
    const group = SLOTS[id].scrollGroup
    const last = out.at(-1)
    if (group === undefined) out.push({ kind: 'slot', id })
    else if (last?.kind === 'scroll' && last.group === group) out[out.length - 1] = { ...last, ids: [...last.ids, id] }
    else out.push({ kind: 'scroll', group, ids: [id] })
  }
  return out
}

/**
 * One sky in every mode: the starfield stays, so the shell's colour
 * behind it does too. Kept per mode so a later change is one line.
 */
export const BACKGROUND: Record<ViewMode, string> = {
  welcome: 'bg-canvas',
  'close-up': 'bg-canvas',
  navigation: 'bg-canvas',
  surface: 'bg-canvas',
}
