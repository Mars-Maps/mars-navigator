import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LayerMenuView } from '../../src/features/mission-ui/LayerMenu'
import {
  baseBox,
  clampOffset,
  KEY_STEP_PX,
  keepPlace,
  keyOffset,
  NO_OFFSET,
  type Box,
} from '../../src/features/mission-ui/layerMenuDrag'
import type { LayerMenuMove } from '../../src/features/mission-ui/useLayerMenuDrag'

// The menu at its 1280×720 place beside the icon panel: 320 px wide.
const SCREEN = { width: 1280, height: 720 }
const BASE: Box = { left: 900, top: 100, width: 320, height: 400 }

describe('clampOffset', () => {
  it('lets the menu go anywhere it fits', () => {
    expect(clampOffset({ dx: -500, dy: 100 }, BASE, SCREEN)).toEqual({ dx: -500, dy: 100 })
  })

  it('stops at every edge of the screen', () => {
    expect(clampOffset({ dx: -2000, dy: 0 }, BASE, SCREEN).dx).toBe(-900) // left edge at 0
    expect(clampOffset({ dx: 2000, dy: 0 }, BASE, SCREEN).dx).toBe(1280 - 900 - 320) // right edge at 1280
    expect(clampOffset({ dx: 0, dy: -2000 }, BASE, SCREEN).dy).toBe(-100) // top at 0
    expect(clampOffset({ dx: 0, dy: 2000 }, BASE, SCREEN).dy).toBe(720 - 100 - 400) // bottom at 720
  })

  it('keeps the top-left corner, and so the title bar, on a screen too small for the menu', () => {
    const tall: Box = { ...BASE, height: 900 }
    expect(clampOffset({ dx: 0, dy: 300 }, tall, SCREEN).dy).toBe(-100)
    const wide: Box = { ...BASE, width: 1400 }
    expect(clampOffset({ dx: 50, dy: 0 }, wide, SCREEN).dx).toBe(-900)
  })

  it('pulls a menu back on screen after the window shrinks', () => {
    const small = { width: 800, height: 600 }
    const placeNow: Box = { left: 700, top: 100, width: 320, height: 400 }
    // It overhangs the right edge by 220 px and still fits top to bottom.
    expect(clampOffset(NO_OFFSET, placeNow, small)).toEqual({ dx: 800 - 700 - 320, dy: 0 })
  })
})

describe('keyOffset', () => {
  const at = { dx: 10, dy: 20 }

  it('steps by the arrow keys', () => {
    expect(keyOffset('ArrowLeft', at)).toEqual({ dx: 10 - KEY_STEP_PX, dy: 20 })
    expect(keyOffset('ArrowRight', at)).toEqual({ dx: 10 + KEY_STEP_PX, dy: 20 })
    expect(keyOffset('ArrowUp', at)).toEqual({ dx: 10, dy: 20 - KEY_STEP_PX })
    expect(keyOffset('ArrowDown', at)).toEqual({ dx: 10, dy: 20 + KEY_STEP_PX })
  })

  it('puts the menu back on Home, and ignores other keys', () => {
    expect(keyOffset('Home', at)).toEqual(NO_OFFSET)
    expect(keyOffset('Enter', at)).toBeNull()
    expect(keyOffset('a', at)).toBeNull()
  })
})

describe('keepPlace', () => {
  // Opening the time menu moves the default place 272 px left and 96 px up.
  const moved: Box = { ...BASE, left: BASE.left - 272, top: BASE.top - 96 }

  it('keeps a moved menu where it is on screen', () => {
    const offset = { dx: -500, dy: 150 }
    const kept = keepPlace(offset, BASE, moved)
    expect(moved.left + kept.dx).toBe(BASE.left + offset.dx)
    expect(moved.top + kept.dy).toBe(BASE.top + offset.dy)
  })

  it('lets a menu never moved follow its default place', () => {
    expect(keepPlace(NO_OFFSET, BASE, moved)).toEqual(NO_OFFSET)
  })

  it('changes nothing before there is an earlier place to compare', () => {
    expect(keepPlace({ dx: -500, dy: 150 }, null, moved)).toEqual({ dx: -500, dy: 150 })
  })
})

describe('baseBox', () => {
  it('removes the current offset from where the menu is drawn', () => {
    expect(baseBox({ left: 400, top: 250, width: 320, height: 400 }, { dx: -500, dy: 150 })).toEqual(BASE)
  })
})

describe('LayerMenuView move handle', () => {
  const noop = () => {}
  const MOVE: LayerMenuMove = {
    onPointerDown: noop,
    onPointerMove: noop,
    onPointerUp: noop,
    onPointerCancel: noop,
    onDoubleClick: noop,
    onKeyDown: noop,
  }
  const render = (move?: LayerMenuMove) =>
    renderToStaticMarkup(<LayerMenuView layers={[]} activeLayerId="satellite" onSelect={noop} move={move} />)

  it('offers a keyboard grip that says how to move and reset the menu', () => {
    const html = render(MOVE)
    expect(html).toContain('data-drag-grip')
    expect(html).toMatch(/aria-label="Move Layers: drag, or arrow keys; Home or double-click puts it back"/)
    expect(html).toContain('cursor-grab')
  })

  it('shows no grip where the menu cannot move', () => {
    const html = render()
    expect(html).not.toContain('data-drag-grip')
    expect(html).not.toContain('cursor-grab')
  })
})
