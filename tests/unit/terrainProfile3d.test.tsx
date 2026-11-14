import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, formatMarsCoordinate, unavailable, type Classified, type MarsCoordinate } from '../../src/domain'
import { TerrainProfile3dPlotView, TerrainProfile3dView } from '../../src/features/mission-ui/tools/TerrainProfile3d'
import {
  REFINING_GRID_NOTE,
  routeCaption,
  SAMPLING_GRID_REASON,
  surfaceCaption,
  terrainProfile3dGate,
} from '../../src/features/mission-ui/tools/terrainProfile3dGate'
import { REFINING_NOTE } from '../../src/app/routeProfile'
import { cornersKey, cornersOf } from '../../src/app/useTerrainSurface'
import { TERRAIN_PROFILE_REASONS, type TerrainProfileCorners } from '../../src/features/route-analysis/terrainProfile'
import { terrainProfileGrid, terrainSurface, type TerrainSurface } from '../../src/features/route-analysis/terrainProfileGrid'
import { at } from './terrain.helpers'

// Test fixtures only: invented clicked corners and heights near Jezero, never shown in the app.
const SQUARE: MarsCoordinate[] = [at(0, 0), at(2, 0), at(2, 2), at(0, 2)]
const BOW_TIE: MarsCoordinate[] = [at(0, 0), at(2, 2), at(2, 0), at(0, 2)]

const MODEL = { label: 'Jezero fixture DEM, 20 m', source: 'Jezero fixture DEM, 20 m, nearest cell (fixture)', cellKm: 0.02 }
function fixtureSurface(heights: number[]): Classified<TerrainSurface> {
  const corners = SQUARE as unknown as TerrainProfileCorners
  const grid = terrainProfileGrid(corners, { cellKm: 1 })
  return terrainSurface(
    grid,
    derived({ heights: Float32Array.from(heights), sourceIndex: new Uint8Array(9), sources: [MODEL] }, 'fixture'),
    'no data',
  )
}

const render = (points: MarsCoordinate[], surface: Classified<TerrainSurface> | null) =>
  renderToStaticMarkup(<TerrainProfile3dView points={points} surface={surface} />)

describe('terrainProfile3dGate', () => {
  it('below four corners says what it needs, with the count, in the contract\'s words', () => {
    const { state, line } = terrainProfile3dGate(SQUARE.slice(0, 2))
    expect(state.status).toBe('disabled')
    expect(line).toBe(`${TERRAIN_PROFILE_REASONS.needsCorners} (2 of 4 set)`)
    expect(terrainProfile3dGate([]).line).toContain('(0 of 4 set)')
  })

  it('with four corners in order is ready, with the corners in click order', () => {
    const { state, line } = terrainProfile3dGate(SQUARE)
    expect(line).toBeNull()
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.request.corners.map((c) => c.longitudeEast)).toEqual(SQUARE.map((c) => c.longitudeEast))
  })

  it('names the contract\'s problem for five corners or crossing edges', () => {
    expect(terrainProfile3dGate([...SQUARE, at(1, 1)]).line).toBe(TERRAIN_PROFILE_REASONS.tooManyCorners)
    expect(terrainProfile3dGate(BOW_TIE).line).toBe(TERRAIN_PROFILE_REASONS.selfIntersecting)
  })
})

describe('the shell\'s side', () => {
  it('the refining note repeats the profile\'s words exactly', () => {
    expect(REFINING_GRID_NOTE).toBe(REFINING_NOTE)
  })

  it('the corners key round-trips the corners exactly', () => {
    const corners = SQUARE as unknown as TerrainProfileCorners
    expect(cornersOf(cornersKey(corners))).toEqual(corners)
    expect(cornersKey(corners)).toBe(cornersKey(cornersOf(cornersKey(corners))))
  })
})

describe('TerrainProfile3dView', () => {
  it('below four corners lists the corners set, each with a pencil, Clear, and the gate with the count and how to click', () => {
    const html = render(SQUARE.slice(0, 3), null)
    expect(html).toContain(`${TERRAIN_PROFILE_REASONS.needsCorners} (3 of 4 set)`)
    expect(html).toContain('Each click sets the next corner, in order around the region; a fifth click starts over.')
    expect(html).toContain('aria-label="Corners"')
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html.match(/aria-label="Change point \d"/g)).toHaveLength(3)
    expect(html).toContain('>Clear</button>')
    // Minimise, three pencils and Clear.
    expect(html.match(/<button/g)).toHaveLength(5)
    expect(html).not.toContain('data-plot')
  })

  it('with no corners shows the gate alone: no list, no pencils, no Clear', () => {
    const html = render([], null)
    expect(html).toContain('(0 of 4 set)')
    expect(html).not.toContain('aria-label="Corners"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })

  it('while a corner is being moved, its pencil is pressed and the panel says which click moves it', () => {
    const html = renderToStaticMarkup(<TerrainProfile3dView points={SQUARE} surface={null} replacing={2} />)
    expect(html).toContain('aria-label="Change point 3" aria-pressed="true"')
    expect(html).toContain('aria-label="Change point 1" aria-pressed="false"')
    expect(html).toContain('Click the surface to move corner 3.')
    expect(html).not.toContain('The plot')
  })

  it('with an invalid region says why and how to fix it', () => {
    const html = render(BOW_TIE, null)
    expect(html).toContain(TERRAIN_PROFILE_REASONS.selfIntersecting)
    expect(html).toContain('Use a corner&#x27;s pencil to move it, or click the corners again in order around the region.')
    expect(html).not.toContain('data-plot')
  })

  it('ready lists the corners numbered in click order and points at the box of the plot and its handle, loading or drawn', () => {
    const loading = render(SQUARE, unavailable(SAMPLING_GRID_REASON))
    expect(loading).toContain('aria-label="Corners"')
    expect(loading.match(/<li/g)).toHaveLength(4)
    expect(loading.indexOf('>1<')).toBeLessThan(loading.indexOf('>2<'))
    expect(loading).toContain(formatMarsCoordinate(SQUARE[0], 2))
    expect(loading).toContain('The plot, in its own box, is waiting for the heights. Drag the box by its handle to move it.')
    expect(loading).not.toContain('Heights loading…')
    const drawn = render(SQUARE, fixtureSurface(new Array<number>(9).fill(-2000)))
    expect(drawn).toContain('DERIVED')
    expect(drawn).toContain('The plot is in its own box: drag inside it to orbit, scroll to zoom, drag its handle to move it.')
    expect(drawn).not.toContain('data-plot')
  })
})

describe('TerrainProfile3dPlotView, what the movable box shows', () => {
  const renderPlot = (surface: Classified<TerrainSurface> | null) =>
    renderToStaticMarkup(<TerrainProfile3dPlotView surface={surface} plot={<div data-plot="" />} />)

  it('draws nothing without a surface', () => {
    expect(renderPlot(null)).toBe('')
  })

  it('while the heights are read shows the hatched frame saying loading, never a plane', () => {
    const html = renderPlot(unavailable(SAMPLING_GRID_REASON))
    expect(html).toContain('Heights loading…')
    expect(html).toContain(SAMPLING_GRID_REASON)
    expect(html).toContain('h-(--plot-h,15rem)')
    expect(html).not.toContain('data-plot')
  })

  it('an unavailable surface says so with its reason and shows no plot', () => {
    const html = renderPlot(unavailable('No height here: fixture'))
    expect(html).toContain('Heights unavailable')
    expect(html).toContain('No height here: fixture')
    expect(html).not.toContain('data-plot')
  })

  it('with a surface shows the plot and the caption with the models, the range and the holes', () => {
    const surface = fixtureSurface([-2500, -2490, Number.NaN, -2480, -2470, -2460, -2450, -2440, -2430])
    const html = renderPlot(surface)
    expect(html).toContain('data-plot')
    expect(html).toContain('3 × 3 heights about every 1,000 m: 8 from the Jezero fixture DEM, 20 m.')
    expect(html).toContain('Ground from -2,500 m to -2,430 m.')
    expect(html).toContain('1 node has no height: left as holes, never filled.')
  })

  it('the caption gives both spacings when the box is long and thin', () => {
    // 100 km by 2 km at 1 km cells: the long side is capped at 48 nodes, so its spacing is coarser.
    const corners = [at(0, 0), at(100, 0), at(100, 2), at(0, 2)] as unknown as TerrainProfileCorners
    const grid = terrainProfileGrid(corners, { cellKm: 1 })
    if (grid.classification !== 'DERIVED') throw new Error(grid.classification)
    const count = grid.value.nodes.length
    const surface = terrainSurface(
      grid,
      derived({ heights: new Float32Array(count).fill(-2000), sourceIndex: new Uint8Array(count), sources: [MODEL] }, 'fixture'),
      'no data',
    )
    if (surface.classification !== 'DERIVED') throw new Error(surface.classification)
    expect(surfaceCaption(surface.value)).toMatch(/^\d+ × \d+ heights about every [\d,]+ m east and [\d,]+ m north: /)
  })

  it('the caption leaves out holes when there are none', () => {
    const surface = fixtureSurface(new Array<number>(9).fill(-2000))
    if (surface.classification !== 'DERIVED') throw new Error(surface.classification)
    expect(surfaceCaption(surface.value)).toBe(
      '3 × 3 heights about every 1,000 m: 9 from the Jezero fixture DEM, 20 m. Ground from -2,000 m to -2,000 m.',
    )
  })
})

describe('the followed route on the plot', () => {
  it('the caption names the strategy and says whether its path is drawn, outside the box, or missing', () => {
    expect(routeCaption('fastest', 'crosses')).toBe('The fastest route is drawn where it crosses the box.')
    expect(routeCaption('scientific', 'outside')).toBe('The scientific route does not cross the box.')
    expect(routeCaption('fastest', 'holes')).toBe('The fastest route crosses the box only over ground with no height, so it is not drawn.')
    expect(routeCaption('energy-efficient', 'no-path')).toBe('The energy-efficient (metabolic) route has no path to draw.')
    expect(routeCaption('shortest', 'crosses')).toBe('The shortest distance route is drawn where it crosses the box.')
  })

  it('the plot view shows the route line under the caption only while a route is followed', () => {
    const surface = fixtureSurface([0, 10, 20, 30, 40, 50, 60, 70, 80])
    const plain = renderToStaticMarkup(<TerrainProfile3dPlotView surface={surface} plot={null} />)
    expect(plain).not.toContain('route')
    const note = routeCaption('fastest', 'crosses')
    const withRoute = renderToStaticMarkup(<TerrainProfile3dPlotView surface={surface} plot={null} routeNote={note} />)
    expect(withRoute).toContain(note)
    expect(withRoute).toContain(surfaceCaption(surface.classification === 'DERIVED' ? surface.value : (() => { throw new Error() })()))
  })
})
