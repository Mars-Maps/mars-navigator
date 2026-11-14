import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { SlotTree } from '../../src/app/layout/AppLayout'
import {
  COLUMNS,
  SCROLL_GROUPS,
  SLOT_ORDER,
  SLOTS,
  arrange,
  columnParts,
  visibleSlots,
  type ColumnId,
  type SlotId,
} from '../../src/app/layout/slots'
import { IconPanel } from '../../src/features/mission-ui/IconPanel'
import { LayerMenu } from '../../src/features/mission-ui/LayerMenu'
import { TimeMenu } from '../../src/features/mission-ui/TimeMenu'
import type { ViewMode } from '../../src/state'

const visibleIn = (mode: ViewMode): SlotId[] =>
  SLOT_ORDER.filter((id) => SLOTS[id].modes.includes(mode))

/** Tailwind edge offsets; a column member must not carry one. */
const EDGE = /(^|\s)-?(top|bottom|left|right|inset)-/
const MT_AUTO = /(^|\s)mt-auto(\s|$)/

/** Navigation's detail panels, which scroll as one stack; Progress is hidden for now. */
const NAVIGATION_STACK: SlotId[] = ['destination', 'hazards', 'elevationProfile']

const leftColumn = (mode: ViewMode): readonly SlotId[] | null => {
  const left = arrange(visibleIn(mode)).find((p) => p.kind === 'column' && p.column === 'left')
  return left?.kind === 'column' ? left.ids : null
}

describe('the walk on the surface', () => {
  it('shows the HUD and stop card only while standing on the surface, under the open time menu', () => {
    for (const id of ['hud', 'stopCard'] as const) {
      expect(SLOTS[id].modes).toEqual(['surface'])
      expect(SLOT_ORDER.indexOf(id)).toBeLessThan(SLOT_ORDER.indexOf('time'))
    }
    expect(visibleSlots('surface', true)).not.toContain('hud')
  })
})

describe('the Terrain Profile 3D plot slot', () => {
  it('is the screen origin its movable box places itself from, in the globe modes, on no column', () => {
    expect(SLOTS.terrainPlot.modes).toEqual(['welcome', 'close-up', 'navigation'])
    expect(SLOTS.terrainPlot.column).toBeUndefined()
    expect(SLOTS.terrainPlot.position.split(/\s+/)).toEqual(['left-0', 'top-0'])
    expect(visibleSlots('close-up', true)).not.toContain('terrainPlot')
  })

  it('a null panel draws nothing in its slot, where a missing one shows the placeholder', () => {
    const html = (panels: Record<string, null>) =>
      renderToStaticMarkup(createElement(SlotTree, { visible: ['terrainPlot'], panels }))
    expect(html({})).toContain('Terrain Profile 3D plot')
    expect(html({ terrainPlot: null })).not.toContain('Terrain Profile 3D plot')
  })
})

describe('slot columns', () => {
  it('keeps edge offsets out of column members, so the column alone places them', () => {
    for (const id of SLOT_ORDER) {
      const { column, position } = SLOTS[id]
      if (column !== undefined) expect(position, id).not.toMatch(EDGE)
      else expect(position, id).toMatch(EDGE)
    }
  })

  it('every column has a position', () => {
    for (const column of Object.keys(COLUMNS) as ColumnId[]) {
      expect(COLUMNS[column], column).toMatch(EDGE)
    }
  })

  it('stacks the read-only search line, destination, hazards, elevation profile, the coordinate table, then the caption and scale bar in navigation', () => {
    expect(leftColumn('navigation')).toEqual([
      'search',
      'destination',
      'hazards',
      'elevationProfile',
      'coordinateTable',
      'caption',
      'scaleBar',
    ])
    // One width, and each at its own height: the stack scrolls as one, none by itself.
    // Progress keeps its place in the stack, so it returns there when it is shown again.
    const classes = (id: SlotId) => SLOTS[id].position.split(/\s+/)
    for (const id of [...NAVIGATION_STACK, 'progress'] as const) {
      expect(classes(id), id).toEqual(expect.arrayContaining(['w-96', 'shrink-0']))
      expect(classes(id), id).not.toContain('min-h-0')
      expect(classes(id), id).not.toContain('overflow-y-auto')
      expect(SLOTS[id].scrollGroup, id).toBe('navigation')
    }
  })

  it('hides the Progress tracker in every mode for the final version', () => {
    expect(SLOTS.progress.modes).toEqual([])
    for (const mode of ['welcome', 'close-up', 'navigation', 'surface'] as const) {
      expect(visibleIn(mode), mode).not.toContain('progress')
    }
  })

  it('gathers navigation\'s detail panels into one scrolling part, between the search line and the coordinate table', () => {
    expect(columnParts(leftColumn('navigation')!)).toEqual([
      { kind: 'slot', id: 'search' },
      { kind: 'scroll', group: 'navigation', ids: NAVIGATION_STACK },
      { kind: 'slot', id: 'coordinateTable' },
      { kind: 'slot', id: 'caption' },
      { kind: 'slot', id: 'scaleBar' },
    ])
    // The box shrinks before the caption and scale bar, scrolls, and keeps room for the last panel's shadow.
    expect(SCROLL_GROUPS.navigation.split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'gap-2', 'min-h-0', 'overflow-y-auto', 'pb-2', '-mb-2']),
    )
    // Only navigation's stack scrolls as a group: close-up and welcome draw their members alone.
    for (const mode of ['welcome', 'close-up'] as const) {
      expect(columnParts(leftColumn(mode)!).every((p) => p.kind === 'slot'), mode).toBe(true)
    }
  })

  it('draws each scroll group as one box in every mode, never split by another column member', () => {
    // Progress stays a member while hidden, so it comes back inside the box.
    expect(SLOT_ORDER.filter((id) => SLOTS[id].scrollGroup === 'navigation')).toEqual([...NAVIGATION_STACK, 'progress'])
    for (const mode of ['welcome', 'close-up', 'navigation'] as const) {
      const groups = columnParts(leftColumn(mode)!).flatMap((p) => (p.kind === 'scroll' ? [p.group] : []))
      expect(new Set(groups).size, mode).toBe(groups.length)
    }
  })

  it('shows the toolbar in every globe mode, alone at the bottom centre', () => {
    for (const mode of ['welcome', 'close-up', 'navigation'] as const) {
      expect(visibleIn(mode), mode).toContain('toolDock')
      const atBottomCentre = visibleIn(mode).filter(
        (id) => SLOTS[id].column === undefined && /(^|\s)left-1\/2(\s|$)/.test(SLOTS[id].position),
      )
      expect(atBottomCentre, mode).toEqual(['toolDock'])
    }
    expect(visibleIn('surface')).not.toContain('toolDock')
  })

  it('stacks search, the point menu, then the caption and scale bar in close-up', () => {
    expect(leftColumn('close-up')).toEqual([
      'search',
      'pointMenu',
      'coordinateTable',
      'caption',
      'scaleBar',
    ])
  })

  it('makes the search bar the peer the point menu follows', () => {
    // A CSS peer reaches only later siblings: search must stay above the
    // point menu in the same column.
    expect(SLOTS.search.position).toMatch(/(^|\s)peer\/search(\s|$)/)
    expect(SLOTS.search.column).toBe(SLOTS.pointMenu.column)
    const ids = leftColumn('close-up')!
    expect(ids.indexOf('search')).toBeLessThan(ids.indexOf('pointMenu'))
  })

  it('never shrinks the closed search bar, so its summary line stays whole', () => {
    const search = SLOTS.search.position.split(/\s+/)
    const closed = search.filter((c) => !c.includes(':'))
    expect(closed).toContain('shrink-0')
    // Neither a bare shrink nor min-h-0 may apply while it is closed.
    expect(closed).not.toContain('shrink')
    expect(closed).not.toContain('min-h-0')
  })

  it('shrinks the open search bar when the column is short', () => {
    const search = SLOTS.search.position.split(/\s+/)
    expect(search).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-col',
        'has-[[aria-expanded=true]]:shrink',
        'has-[[aria-expanded=true]]:min-h-0',
      ]),
    )
  })

  it('hides the point menu while the search bar is open, and only then', () => {
    const point = SLOTS.pointMenu.position.split(/\s+/)
    expect(point).toContain('peer-has-[[aria-expanded=true]]/search:hidden')
    // Shown otherwise: nothing hides it unconditionally, and no other variant
    // touches its display, so closing the search bar brings it back.
    const display = point.filter((c) => /(^|:)(hidden|block|flex|grid|contents)$/.test(c))
    expect(display).toEqual(['peer-has-[[aria-expanded=true]]/search:hidden'])
    // The only member of close-up's column hidden with it: the caption and scale bar stay.
    for (const id of leftColumn('close-up')!.filter((m) => m !== 'pointMenu')) {
      expect(SLOTS[id].position, id).not.toContain('/search:hidden')
    }
  })

  it('draws the point menu as a later sibling of the search bar in one column, so the peer reaches it', () => {
    const html = renderToStaticMarkup(createElement(SlotTree, { visible: visibleIn('close-up'), panels: {} }))
    const column = html.slice(html.indexOf(`<div class="pointer-events-none absolute flex flex-col ${COLUMNS.left}">`))
    const search = column.indexOf(`<div class="pointer-events-auto ${SLOTS.search.position}" data-slot="search">`)
    const point = column.indexOf(`<div class="pointer-events-auto ${SLOTS.pointMenu.position}" data-slot="pointMenu">`)
    expect(search).toBeGreaterThan(0)
    expect(point).toBeGreaterThan(search)
    // Siblings, not nested: the search slot closes before the point menu's opens.
    const between = column.slice(search, point)
    expect(between.split('<div').length - 1).toBe(between.split('</div>').length - 1)
  })

  it('makes the point menu as wide as the search bar, so the two line up', () => {
    const width = (id: SlotId) => SLOTS[id].position.split(/\s+/).filter((c) => /^w-/.test(c))
    expect(width('pointMenu')).toEqual(['w-96'])
    expect(width('pointMenu')).toEqual(width('search'))
  })

  it('keeps the caption in every mode, pushed to the column bottom', () => {
    expect(leftColumn('welcome')).toEqual(['search', 'intro', 'caption', 'scaleBar'])
    // The caption is the first member with mt-auto, so it and whatever
    // follows sit at the bottom while the detail panel above shrinks. Where
    // the coordinate table can open, it sits just above and comes first.
    for (const mode of ['welcome', 'close-up', 'navigation'] as const) {
      const ids = leftColumn(mode)!
      const first = ids.findIndex((id) => MT_AUTO.test(SLOTS[id].position))
      expect(ids[first], mode).toBe(mode === 'welcome' ? 'caption' : 'coordinateTable')
    }
  })

  it('stacks the open coordinate table on the caption with one auto margin', () => {
    // Closed, its panel renders nothing and the slot hides with its gap.
    expect(SLOTS.coordinateTable.position).toMatch(/(^|\s)empty:hidden(\s|$)/)
    // Open, the caption gives up its own mt-auto, else the two would split
    // the free space and float the table mid-column.
    expect(SLOTS.coordinateTable.position).toMatch(/(^|\s)peer\/coords(\s|$)/)
    expect(SLOTS.caption.position).toContain('peer-[:not(:empty)]/coords:mt-0')
    expect(SLOT_ORDER.indexOf('caption') - SLOT_ORDER.indexOf('coordinateTable')).toBe(1)
  })

  it('draws a column once, where its first member falls in the order', () => {
    const placements = arrange(visibleIn('navigation'))
    const kinds = placements.map((p) => (p.kind === 'slot' ? p.id : `column:${p.column}`))
    expect(kinds.filter((k) => k === 'column:left')).toHaveLength(1)
    // search is the first column member in SLOT_ORDER; the column takes its place.
    expect(kinds.indexOf('column:left')).toBe(visibleIn('navigation').indexOf('search'))
    expect(kinds.indexOf('column:left')).toBeLessThan(kinds.indexOf('time'))
  })

  it('keeps the order of slots outside any column, and of members within one', () => {
    const visible = visibleIn('welcome')
    const placements = arrange(visible)
    const lone = placements.flatMap((p) => (p.kind === 'slot' ? [p.id] : []))
    expect(lone).toEqual(visible.filter((id) => SLOTS[id].column === undefined))
    const members = placements.flatMap((p) => (p.kind === 'column' ? [...p.ids] : []))
    expect(members).toEqual(visible.filter((id) => SLOTS[id].column !== undefined))
    // Nothing lost or duplicated.
    expect([...lone, ...members].sort()).toEqual([...visible].sort())
  })
})

describe('time menu peer', () => {
  const FOLLOWERS = ['iconPanel'] as const

  it('renders the time slot as a sibling before the slots that follow its open state', () => {
    // A CSS peer only reaches later siblings, so neither may sit in a column.
    for (const id of ['time', ...FOLLOWERS] as const) {
      expect(SLOTS[id].column, id).toBeUndefined()
    }
    expect(SLOTS.time.position).toMatch(/(^|\s)peer\/time(\s|$)/)
    for (const id of FOLLOWERS) {
      expect(SLOT_ORDER.indexOf(id), id).toBeGreaterThan(SLOT_ORDER.indexOf('time'))
      expect(SLOTS[id].position, id).toContain('/time:')
    }
  })

  it('keeps the icon panel a column, beside the open time menu instead of a bar', () => {
    const classes = SLOTS.iconPanel.position.split(/\s+/)
    const OPEN = 'peer-has-[[aria-expanded=true]]/time:'
    // Closed: a column on the right edge, centred. (No variant prefix; the
    // custom-property classes carry a colon of their own.)
    const closed = classes.filter((c) => !/^(peer-|has-)/.test(c))
    expect(closed).toEqual(expect.arrayContaining(['right-4', 'top-1/2', 'h-64', 'w-12']))
    // Open: still a column, at the top, left of the menu (right-4 + w-64 + 1 rem).
    const open = classes.filter((c) => c.startsWith(OPEN)).map((c) => c.slice(OPEN.length))
    expect(open).toEqual(expect.arrayContaining(['top-4', 'right-72', 'translate-y-0']))
    expect(SLOTS.time.position.split(/\s+/)).toEqual(expect.arrayContaining(['right-4', 'w-64']))
    expect(open.some((c) => /^(h|w|bottom)-/.test(c))).toBe(false)
    // The layer menu hangs below the collapsed time menu, or level with the column beside the open one.
    expect(closed).toEqual(
      expect.arrayContaining(['[--icons-menu-top:calc(15rem_-_50vh)]', '[--icons-menu-max:calc(100vh_-_18rem)]']),
    )
    expect(open).toEqual(
      expect.arrayContaining(['[--icons-menu-top:0px]', '[--icons-menu-max:calc(100vh_-_14rem)]']),
    )
  })
})

describe('the compass slot', () => {
  it('sits bottom right, on the walker widget\'s baseline and left of it, in every mode', () => {
    const classes = SLOTS.compass.position.split(/\s+/)
    // The walker widget is right-4 bottom-14 w-56 (WalkerDrop.tsx): 15 rem from the edge.
    expect(classes).toEqual(['bottom-14', 'right-64'])
    expect(SLOTS.compass.column).toBeUndefined()
    expect(SLOTS.compass.modes).toEqual(['welcome', 'close-up', 'navigation', 'surface'])
  })
})

describe('aria-expanded the peers follow', () => {
  // slots.ts reads aria-expanded inside the time and icon-panel slots. A
  // second one there would move the bar or hide the tracker at the wrong
  // time; moving the toggle to another attribute would silently stop it.
  const expandedIn = (html: string) => html.match(/<[^>]*aria-expanded="[^"]*"[^>]*>/g) ?? []

  it.each([false, true])('the time menu has exactly one, on its toggle (open: %s)', (open) => {
    const tags = expandedIn(renderToStaticMarkup(createElement(TimeMenu, { defaultOpen: open })))
    expect(tags).toHaveLength(1)
    expect(tags[0]).toMatch(/^<button/)
    expect(tags[0]).toContain(`aria-expanded="${open}"`)
  })

  // A server render reads the store's initial state, so the icon panel
  // renders closed here; the layer menu is rendered on its own for the
  // open case.
  it('the icon panel has one on each sub-panel toggle and no others', () => {
    const tags = expandedIn(renderToStaticMarkup(createElement(IconPanel)))
    expect(tags.map((t) => t.match(/aria-label="([^"]*)"/)?.[1])).toEqual(['Layers', 'Compass'])
  })

  // Its title bar's minimise button is the one exception: the menu
  // exists only while its Layers toggle is already aria-expanded="true", so
  // the slot's z-20 cannot change. Anything else here would.
  it('the layer sub-panel adds only its minimise toggle', () => {
    const tags = expandedIn(renderToStaticMarkup(createElement(LayerMenu)))
    expect(tags.map((t) => t.match(/aria-label="([^"]*)"/)?.[1])).toEqual(['Minimise Layers'])
  })
})

describe('visibleSlots', () => {
  it('shows a mode\'s slots, in SLOT_ORDER', () => {
    for (const mode of ['welcome', 'close-up', 'navigation'] as const) {
      expect(visibleSlots(mode, false)).toEqual(visibleIn(mode))
    }
  })

  it('keeps the scene and the surface caption under "Hide all tools"', () => {
    for (const mode of ['welcome', 'close-up', 'navigation'] as const) {
      expect(visibleSlots(mode, true), mode).toEqual(['scene', 'caption'])
    }
  })

  it('shows the ground, the time menu and the compass dial in surface, no icon panel', () => {
    expect(visibleSlots('surface', false)).toEqual(['scene', 'hud', 'stopCard', 'time', 'compass'])
  })

  it('leaves only the scene under "Hide all tools" in surface, which captions itself', () => {
    expect(visibleSlots('surface', true)).toEqual(['scene'])
  })
})

describe('SlotTree columns', () => {
  const COLUMN_OPEN = `<div class="pointer-events-none absolute flex flex-col ${COLUMNS.left}">`
  const MEMBER = /<div class="pointer-events-auto ([^"]*)" data-slot="[^"]*">/g

  const render = (mode: ViewMode) =>
    renderToStaticMarkup(createElement(SlotTree, { visible: visibleIn(mode), panels: {} }))

  it('renders the navigation column members in order inside one pass-through column', () => {
    const html = render('navigation')
    expect(html.split(COLUMN_OPEN)).toHaveLength(2)
    const members = [...html.matchAll(MEMBER)].map((m) => m[1])
    expect(members).toEqual([
      SLOTS.search.position,
      SLOTS.destination.position,
      SLOTS.hazards.position,
      SLOTS.elevationProfile.position,
      SLOTS.coordinateTable.position,
      SLOTS.caption.position,
      SLOTS.scaleBar.position,
    ])
    // Placeholders sit inside the column, in that order.
    const column = html.slice(html.indexOf(COLUMN_OPEN))
    const at = (label: string) => column.indexOf(label)
    expect(at('Destination bar')).toBeGreaterThan(0)
    expect(at('Hazards')).toBeGreaterThan(at('Destination bar'))
    expect(at('Elevation profile')).toBeGreaterThan(at('Hazards'))
    expect(at('Progress tracker')).toBe(-1)
    expect(at('Coordinate table')).toBeGreaterThan(at('Elevation profile'))
    expect(at('Surface caption')).toBeGreaterThan(at('Coordinate table'))
    expect(at('Scale bar')).toBeGreaterThan(at('Surface caption'))
    // One column; nothing else in the tree opts out.
    expect(html.match(/pointer-events-none/g)).toHaveLength(1)
    // The detail panels sit in one scrolling box, the search line above it and the coordinate table below.
    const box = `<div data-scroll-group="navigation" class="pointer-events-auto ${SCROLL_GROUPS.navigation}">`
    expect(html.split(box)).toHaveLength(2)
    const inBox = column.slice(column.indexOf(box))
    expect(column.indexOf('Search bar')).toBeLessThan(column.indexOf(box))
    for (const label of ['Destination bar', 'Hazards', 'Elevation profile']) {
      expect(inBox.indexOf(label), label).toBeGreaterThan(0)
    }
    expect(inBox.indexOf('Coordinate table')).toBeGreaterThan(inBox.indexOf('Elevation profile'))
  })

  it('draws no scroll box in close-up or welcome', () => {
    for (const mode of ['close-up', 'welcome'] as const) {
      expect(render(mode), mode).not.toContain('data-scroll-group')
    }
  })

  it('renders the close-up and welcome members in order', () => {
    const closeUp = [...render('close-up').matchAll(MEMBER)].map((m) => m[1])
    expect(closeUp).toEqual([
      SLOTS.search.position,
      SLOTS.pointMenu.position,
      SLOTS.coordinateTable.position,
      SLOTS.caption.position,
      SLOTS.scaleBar.position,
    ])
    const welcome = [...render('welcome').matchAll(MEMBER)].map((m) => m[1])
    expect(welcome).toEqual([
      SLOTS.search.position,
      SLOTS.intro.position,
      SLOTS.caption.position,
      SLOTS.scaleBar.position,
    ])
  })

  it('renders the caption alone in the column when tools are hidden', () => {
    const html = renderToStaticMarkup(
      createElement(SlotTree, { visible: visibleSlots('close-up', true), panels: {} }),
    )
    const members = [...html.matchAll(MEMBER)].map((m) => m[1])
    expect(members).toEqual([SLOTS.caption.position])
    expect(html).toContain('Mars 3D view')
    expect(html).not.toContain('Scale bar')
  })
})
