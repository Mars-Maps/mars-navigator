import { describe, expect, it } from 'vitest'
import {
  AVOID_GAP_PX,
  DEFAULT_RIGHT_PX,
  DEFAULT_TOP_PX,
  KEY_STEP_PX,
  PLOT_SIZES,
  avoid,
  clampPlace,
  defaultPlace,
  keyPlace,
  overlapArea,
  parsePlace,
  plotSize,
  sameAway,
  type Rect,
  type Size,
} from '../../src/app/terrainPlot/plotPlacement'

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })
const at = (p: { x: number; y: number }, s: Size): Rect => rect(p.x, p.y, p.x + s.width, p.y + s.height)

/**
 * The panels as measured in the browser at 1280 × 720 and 1920 × 1080, 16 px to the rem, with the tool's
 * own panel open above the dock and the box's height beyond the plot (handle and notes) as drawn there.
 */
const SCREENS = [
  {
    viewport: { width: 1280, height: 720 },
    leftColumn: rect(16, 16, 400, 704),
    timeMenu: rect(1008, 16, 1264, 102),
    iconColumn: rect(1216, 232, 1264, 488),
    walker: rect(1040, 558, 1264, 664),
    toolDock: rect(448, 374, 832, 704),
    chrome: 62,
    layerMenu: rect(888, 112, 1208, 544),
  },
  {
    viewport: { width: 1920, height: 1080 },
    leftColumn: rect(16, 16, 400, 1064),
    timeMenu: rect(1648, 16, 1904, 102),
    iconColumn: rect(1856, 412, 1904, 668),
    walker: rect(1680, 918, 1904, 1024),
    toolDock: rect(768, 734, 1152, 1064),
    chrome: 112,
    layerMenu: rect(1528, 112, 1848, 700),
  },
]
const boxSize = (id: keyof typeof PLOT_SIZES, chrome = 112): Size => ({ width: PLOT_SIZES[id].width, height: PLOT_SIZES[id].plotHeight + chrome })

describe('the plot box size and default place', () => {
  it('is compact below 900 px of height and regular from there', () => {
    expect(plotSize({ width: 1280, height: 720 })).toBe('compact')
    expect(plotSize({ width: 1440, height: 899 })).toBe('compact')
    expect(plotSize({ width: 1920, height: 1080 })).toBe('regular')
    expect(PLOT_SIZES.small.width).toBeLessThan(PLOT_SIZES.compact.width)
    expect(PLOT_SIZES.compact.width).toBeLessThan(PLOT_SIZES.regular.width)
  })

  it('by default sits from the right edge, under the closed time menu', () => {
    expect(defaultPlace({ width: 1280, height: 720 }, 304)).toEqual({ x: 1280 - DEFAULT_RIGHT_PX - 304, y: DEFAULT_TOP_PX })
  })

  it.each(SCREENS)('by default covers no other panel at $viewport.width × $viewport.height', (s) => {
    // With the notes unfolded and a route line under them, taller than it is ever drawn by default.
    const size = boxSize(plotSize(s.viewport), 170)
    const box = at(defaultPlace(s.viewport, size.width), size)
    for (const panel of [s.leftColumn, s.timeMenu, s.iconColumn, s.walker, s.toolDock]) expect(overlapArea(box, panel)).toBe(0)
    expect(box.right).toBeLessThanOrEqual(s.viewport.width)
    expect(box.bottom).toBeLessThanOrEqual(s.viewport.height)
  })
})

describe('keeping the plot box on screen', () => {
  const size = { width: 300, height: 200 }
  const viewport = { width: 1000, height: 600 }

  it('leaves a place on screen alone', () => {
    expect(clampPlace({ x: 10, y: 20 }, size, viewport)).toEqual({ x: 10, y: 20 })
  })

  it('brings a place past any edge back so the whole box shows', () => {
    expect(clampPlace({ x: -50, y: -5 }, size, viewport)).toEqual({ x: 0, y: 0 })
    expect(clampPlace({ x: 900, y: 550 }, size, viewport)).toEqual({ x: 700, y: 400 })
    expect(clampPlace({ x: 900, y: 550 }, size, viewport, 8)).toEqual({ x: 692, y: 392 })
  })

  it('a window made smaller pulls the box in; the wanted place is not lost by clamping again larger', () => {
    const wanted = { x: 650, y: 380 }
    expect(clampPlace(wanted, size, { width: 800, height: 500 })).toEqual({ x: 500, y: 300 })
    expect(clampPlace(wanted, size, viewport)).toEqual(wanted)
  })

  it('a box larger than the screen keeps its top-left corner, and the handle, on it', () => {
    expect(clampPlace({ x: 40, y: 40 }, size, { width: 200, height: 100 })).toEqual({ x: 0, y: 0 })
  })
})

describe('moving the plot box with the keyboard', () => {
  const place = { x: 100, y: 100 }

  it('arrow keys step it, further with Shift', () => {
    expect(keyPlace('ArrowLeft', place)).toEqual({ x: 100 - KEY_STEP_PX, y: 100 })
    expect(keyPlace('ArrowRight', place)).toEqual({ x: 100 + KEY_STEP_PX, y: 100 })
    expect(keyPlace('ArrowUp', place)).toEqual({ x: 100, y: 100 - KEY_STEP_PX })
    expect(keyPlace('ArrowDown', place, true)).toEqual({ x: 100, y: 100 + KEY_STEP_PX * 4 })
  })

  it('Home asks for the default place and other keys do nothing', () => {
    expect(keyPlace('Home', place)).toBe('home')
    expect(keyPlace('Enter', place)).toBeNull()
    expect(keyPlace('a', place)).toBeNull()
  })
})

describe('overlapArea', () => {
  it('is the shared area, and 0 for boxes that only touch', () => {
    expect(overlapArea(rect(0, 0, 10, 10), rect(5, 5, 20, 20))).toBe(25)
    expect(overlapArea(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(0)
  })

  it('with a gap counts boxes nearer than the gap as overlapping, and exactly the gap apart as clear', () => {
    expect(overlapArea(rect(0, 0, 10, 10), rect(14, 0, 20, 10), 8)).toBeGreaterThan(0)
    expect(overlapArea(rect(0, 0, 10, 10), rect(18, 0, 20, 10), 8)).toBe(0)
  })
})

describe('getting out of the way of an open menu', () => {
  it.each(SCREENS)('stays put when no menu is over it at $viewport.width px', (s) => {
    const sizes = [boxSize(plotSize(s.viewport), s.chrome), boxSize('small', s.chrome)]
    const home = defaultPlace(s.viewport, sizes[0].width)
    expect(avoid(home, sizes, s.viewport, [], [s.leftColumn, s.walker])).toBeNull()
    // A menu open elsewhere does not move it either.
    expect(avoid(home, sizes, s.viewport, [rect(100, 400, 300, 600)], [])).toBeNull()
  })

  it.each(SCREENS)('moves clear of the layer menu and of every other panel, at its own size, at $viewport.width px', (s) => {
    const sizes = [boxSize(plotSize(s.viewport), s.chrome), boxSize('small', s.chrome)]
    const home = defaultPlace(s.viewport, sizes[0].width)
    const others = [s.leftColumn, s.timeMenu, s.iconColumn, s.walker, s.toolDock]
    const away = avoid(home, sizes, s.viewport, [s.layerMenu], others)
    if (away === null) throw new Error('the default place is under the layer menu, so it must move')
    expect(away.size).toBe(0)
    const box = at(away.place, sizes[0])
    expect(overlapArea(box, s.layerMenu, AVOID_GAP_PX)).toBe(0)
    for (const panel of others) expect(overlapArea(box, panel)).toBe(0)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(s.viewport.height)
    // Beside the menu, on its left, the shortest way out; no lower than it was, and raised only to clear the tool's panel.
    expect(away.place.x).toBe(s.layerMenu.left - AVOID_GAP_PX - sizes[0].width)
    expect(away.place.y).toBeLessThanOrEqual(home.y)
    expect(away.place.y).toBeGreaterThanOrEqual(home.y - 20)
  })

  it('gives the same answer asked again, so the box does not wander while the menu stays open', () => {
    const s = SCREENS[0]
    const sizes = [boxSize('compact'), boxSize('small')]
    const home = defaultPlace(s.viewport, sizes[0].width)
    const first = avoid(home, sizes, s.viewport, [s.layerMenu], [s.leftColumn])
    expect(sameAway(first, avoid(home, sizes, s.viewport, [s.layerMenu], [s.leftColumn]))).toBe(true)
    expect(sameAway(first, null)).toBe(false)
    expect(sameAway(null, null)).toBe(true)
  })

  it('goes below or above a menu when there is no room beside it', () => {
    const viewport = { width: 400, height: 900 }
    const size = { width: 300, height: 200 }
    const menu = rect(0, 0, 400, 300)
    const away = avoid({ x: 50, y: 50 }, [size], viewport, [menu], [])
    expect(away).toEqual({ place: { x: 50, y: 308 }, size: 0 })
  })

  it('shrinks only when its own size cannot clear the other panels and the small one covers less', () => {
    const viewport = { width: 1000, height: 400 }
    const own = { width: 300, height: 300 }
    const small = { width: 180, height: 200 }
    // A menu over the right half and a panel over the left, with a 220 px lane between them.
    const menu = rect(520, 0, 1000, 400)
    const panel = rect(0, 0, 300, 400)
    const away = avoid({ x: 600, y: 50 }, [own, small], viewport, [menu], [panel])
    if (away === null) throw new Error('must move')
    expect(away.size).toBe(1)
    const box = at(away.place, small)
    expect(overlapArea(box, menu, AVOID_GAP_PX)).toBe(0)
    expect(overlapArea(box, panel)).toBe(0)
    // With room for its own size it keeps it.
    expect(avoid({ x: 600, y: 50 }, [own, small], viewport, [menu], [rect(0, 0, 150, 400)])?.size).toBe(0)
  })

  it('with nowhere clear of the menu takes the place least under it rather than none', () => {
    const viewport = { width: 400, height: 300 }
    const away = avoid({ x: 50, y: 50 }, [{ width: 300, height: 200 }], viewport, [rect(0, 0, 400, 250)], [])
    expect(away).not.toBeNull()
    expect(away?.place.y).toBe(300 - 200 - AVOID_GAP_PX)
  })
})

describe('the stored place', () => {
  it('reads back two finite numbers', () => {
    expect(parsePlace('{"x":12,"y":34.5}')).toEqual({ x: 12, y: 34.5 })
  })

  it('is null for nothing stored, broken JSON or anything that is not a place', () => {
    for (const text of [null, '', 'not json', 'null', '[1,2]', '{"x":"1","y":2}', '{"x":1}', '{"x":1e999,"y":2}']) {
      expect(parsePlace(text)).toBeNull()
    }
  })
})
