import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { derived, unavailable, type MarsCoordinate, type SurfacePoint, type WalkPlan } from '../../src/domain'
import { localPointToCoordinate } from '../../src/features/mars-3d/projection'
import { greatCirclePath } from '../../src/features/mars-3d/routeGeometry'
import { drawOverlay, drawTraverse, drawWalk, walkOnMap, greatCircleTrack, mapPins, pinAt, PIN_HIT_PX, trackOnScreen } from '../../src/features/mars-3d/surfaceView/mapOverlay'

const at = (latitude: number, longitudeEast: number): MarsCoordinate => ({ latitude, longitudeEast })
const marker = (id: string, c: MarsCoordinate, label?: string): SurfacePoint => ({
  id,
  coordinate: c,
  elevationMeters: unavailable('fixture'),
  ...(label ? { label } : {}),
})

describe('mapPins', () => {
  it('lists the draft in travel order, numbering the stops, then the marked points by name', () => {
    const pins = mapPins(
      { departure: at(0, 10), stops: [at(1, 11), null, at(2, 12)], destination: at(3, 13) },
      [marker('m1', at(5, 15), 'Crater rim'), marker('m2', at(6, 16))],
    )
    expect(pins.map((p) => `${p.kind}:${p.name}`)).toEqual([
      'departure:Departure',
      'stop:Stop 1',
      'stop:Stop 2',
      'destination:Destination',
      'marked:Crater rim',
      'marked:Marked point 2',
    ])
  })

  it('shows nothing for an empty draft and no marked points', () => {
    expect(mapPins({ departure: null, stops: [], destination: null }, [])).toEqual([])
  })
})

describe('greatCircleTrack', () => {
  it('runs through every waypoint in order, ending exactly on each', () => {
    const ways = [at(-5, 277), at(10, 300), at(20, 10)]
    const track = greatCircleTrack(ways)
    for (const w of ways) expect(track).toContainEqual(w)
    expect(track[0]).toEqual(ways[0])
    expect(track[track.length - 1]).toEqual(ways[2])
  })

  it('follows the same line as the globe draws', () => {
    const ways = [at(-30, 200), at(45, 330), at(-10, 80)]
    const globe = greatCirclePath(ways, 1, 0.1)
    const track = greatCircleTrack(ways, 0.1)
    expect(track.length).toBe(globe.length / 3)
    const v = new Vector3()
    for (let i = 0; i < track.length; i += 37) {
      const c = localPointToCoordinate(v.set(globe[i * 3], globe[i * 3 + 1], globe[i * 3 + 2]), 1)
      expect(track[i].latitude).toBeCloseTo(c.latitude, 4)
      const dLon = Math.abs(((track[i].longitudeEast - c.longitudeEast + 540) % 360) - 180)
      expect(dLon).toBeLessThan(1e-4)
    }
  })

  it('skips a repeated point and takes antipodes through the north pole', () => {
    expect(greatCircleTrack([at(0, 0), at(0, 0)])).toEqual([at(0, 0)])
    const track = greatCircleTrack([at(0, 0), at(0, 180)], 1)
    expect(Math.max(...track.map((c) => c.latitude))).toBeCloseTo(90, 6)
  })
})

describe('trackOnScreen', () => {
  it('stays unbroken across 180°, never jumping the width of the planet', () => {
    const view = { centre: at(0, 180), pxPerDeg: 10 }
    const line = trackOnScreen(view, { width: 400, height: 200 }, greatCircleTrack([at(0, 175), at(0, 185)], 1))
    for (let i = 1; i < line.length; i++) expect(Math.abs(line[i].x - line[i - 1].x)).toBeLessThanOrEqual(10 + 1e-9)
    expect(line[0].x).toBeCloseTo(150, 6)
    expect(line[line.length - 1].x).toBeCloseTo(250, 6)
  })
})

describe('pinAt', () => {
  const view = { centre: at(0, 100), pxPerDeg: 20 }
  const size = { width: 400, height: 400 }
  const pins = mapPins({ departure: at(0, 100), stops: [], destination: null }, [marker('m', at(0, 100), 'On top')])

  it('picks a pin by its tip or its head, the one drawn last first', () => {
    expect(pinAt(view, size, pins, 200, 200)?.name).toBe('On top')
    expect(pinAt(view, size, pins, 200, 189)?.name).toBe('On top')
    expect(pinAt(view, size, pins.slice(0, 1), 203, 198)?.name).toBe('Departure')
  })

  it('picks nothing away from every pin', () => {
    expect(pinAt(view, size, pins, 200 + PIN_HIT_PX + 1, 200)).toBeNull()
  })
})

describe('drawTraverse', () => {
  const view = { centre: at(18.44, 77.45), pxPerDeg: 2000 }
  const size = { width: 200, height: 200 }

  function recorder() {
    const strokes: { style: string; dash: number[] }[] = []
    let dash: number[] = []
    const ctx = {
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      save() {},
      restore() {},
      setLineDash(d: number[]) {
        dash = d
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {
        strokes.push({ style: ctx.strokeStyle, dash })
      },
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes }
  }

  it('strokes a solid line in the traverse colour over a dark edge, in each planet copy', () => {
    const { ctx, strokes } = recorder()
    drawTraverse(ctx, view, size, [at(18.44, 77.45), at(18.441, 77.452)])
    expect(strokes).toHaveLength(6)
    expect(strokes.every((s) => s.dash.length === 0)).toBe(true)
    expect(strokes[1].style).toBe('#e879f9')
  })

  it('draws nothing for fewer than two waypoints', () => {
    const { ctx, strokes } = recorder()
    drawTraverse(ctx, view, size, [at(18.44, 77.45)])
    expect(strokes).toHaveLength(0)
  })
})

describe('walkOnMap', () => {
  const planWith = (paths: WalkPlan['legs'][number]['path'][]): WalkPlan => ({
    ...SAMPLE_WALK_PLAN,
    legs: SAMPLE_WALK_PLAN.legs.map((leg, i) => ({ ...leg, path: paths[i] ?? leg.path })),
  })
  const points = [at(18, 77), at(18.1, 77.1)]
  const line = derived(points, 'straight line, test')

  it('draws nothing with no plan', () => {
    expect(walkOnMap(null)).toEqual({ paths: [], stops: [], mark: null })
  })

  it('gives each leg its own path, in order, and every stop', () => {
    const plan = planWith(SAMPLE_WALK_PLAN.legs.map(() => line))
    const walk = walkOnMap(plan)
    expect(walk.paths).toEqual(plan.legs.map(() => points))
    expect(walk.stops).toEqual(plan.stops.map((s) => s.coordinate))
    expect(walk.mark).toEqual({ classification: 'DERIVED', detail: 'straight line, test' })
  })

  it('draws no line for an UNAVAILABLE leg or a single point, and keeps the stops', () => {
    const plan = planWith(SAMPLE_WALK_PLAN.legs.map((_, i) => (i === 0 ? unavailable('fixture') : derived([at(18, 77)], 'one point'))))
    const walk = walkOnMap(plan)
    expect(walk.paths).toEqual([])
    expect(walk.mark).toBeNull()
    expect(walk.stops).toHaveLength(plan.stops.length)
  })

  it('skips an undrawn leg, and takes the mark from the first leg drawn', () => {
    const second = derived(points, 'the second leg')
    const plan = planWith(SAMPLE_WALK_PLAN.legs.map((_, i) => (i === 0 ? unavailable('fixture') : second)))
    const walk = walkOnMap(plan)
    expect(walk.paths).toEqual(plan.legs.slice(1).map(() => points))
    expect(walk.mark).toEqual({ classification: 'DERIVED', detail: 'the second leg' })
    expect(walk.stops).toHaveLength(plan.stops.length)
  })

  it('keeps a simulated plan marked as simulated', () => {
    expect(walkOnMap(SAMPLE_WALK_PLAN).mark?.classification).toBe('SIMULATED')
  })
})

describe('drawWalk', () => {
  const view = { centre: at(18.44, 77.45), pxPerDeg: 2000 }
  const size = { width: 200, height: 200 }

  it('strokes a dashed white line over a dark edge in each planet copy, and a dot per stop', () => {
    const strokes: { style: string; dash: number[] }[] = []
    const dots: { x: number; y: number }[] = []
    let dash: number[] = []
    const ctx = {
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      save() {},
      restore() {},
      setLineDash(d: number[]) {
        dash = d
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      fill() {},
      arc(x: number, y: number) {
        dots.push({ x, y })
      },
      stroke() {
        strokes.push({ style: ctx.strokeStyle, dash })
      },
    }
    const path = [at(18.44, 77.45), at(18.441, 77.452)]
    drawWalk(ctx as unknown as CanvasRenderingContext2D, view, size, { paths: [path], stops: [path[1]], mark: null })
    // Six line strokes (edge and dash, three copies), then one dot's rim.
    expect(strokes).toHaveLength(7)
    expect(strokes[1]).toEqual({ style: '#ffffff', dash: [7, 5] })
    expect(strokes[6].dash).toEqual([])
    expect(dots).toHaveLength(1)
    expect(dots[0].x).toBeCloseTo(104, 6)
    expect(dots[0].y).toBeCloseTo(98, 6)
  })
})

describe('drawOverlay: the route line', () => {
  const view = { centre: at(18.44, 77.45), pxPerDeg: 2000 }
  const size = { width: 200, height: 200 }

  function strokesOf(track: MarsCoordinate[]) {
    const strokes: { style: string; width: number; dash: number[] }[] = []
    let dash: number[] = []
    const ctx = {
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      save() {},
      restore() {},
      setLineDash(d: number[]) {
        dash = d
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {
        strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, dash })
      },
    }
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, view, size, [], track, false)
    return strokes
  }

  it('strokes a dotted white line over a dark edge, in each planet copy', () => {
    const strokes = strokesOf([at(18.44, 77.45), at(18.441, 77.452)])
    expect(strokes).toHaveLength(6)
    expect(strokes[0]).toEqual({ style: 'rgba(0, 0, 0, 0.6)', width: 3.5, dash: [] })
    expect(strokes[1]).toEqual({ style: '#ffffff', width: 1.5, dash: [1, 5] })
  })

  it('strokes nothing under two points', () => {
    expect(strokesOf([at(18.44, 77.45)])).toHaveLength(0)
  })
})
