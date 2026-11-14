import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  derived,
  official,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type RouteOption,
} from '../../src/domain'
import {
  pathOfRoute,
  planFor,
  readProfile,
  sampleProfile,
  REFINING_NOTE,
  SAMPLING_REASON,
  type ProfileHeights,
} from '../../src/app/routeProfile'
import type { SourcedHeights } from '../../src/data/adapters/LayeredElevation'
import { ElevationProfileView } from '../../src/features/mission-ui/navigation/ElevationProfilePanel'
import {
  ELEVATION_PROFILE_REASONS,
  type ElevationProfile,
} from '../../src/features/route-analysis/elevationProfile'

// Test fixtures only: invented route geometry and heights, never shown in the app.
const routeThrough = (...coordinates: MarsCoordinate[]): RouteOption => ({
  id: 'fixture-route',
  strategy: 'fastest',
  points: coordinates.map((coordinate, i) => ({
    id: `fixture-${i}`,
    coordinate,
    elevationMeters: unavailable('fixture'),
  })),
  path: unavailable('fixture'),
  metrics: {
    distanceKm: unavailable('fixture'),
    durationHours: unavailable('fixture'),
    metabolicEnergyKcal: unavailable('fixture'),
  },
  hazards: unavailable('fixture'),
})

const A: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const B: MarsCoordinate = { latitude: 1, longitudeEast: 1 }

const reasonOf = (p: Classified<ElevationProfile> | null) =>
  p !== null && p.classification === 'UNAVAILABLE' ? p.reason : null

/**
 * A fake elevation chain: the height is the sample's index, the third
 * sample a no-data cell, every call recorded. 0.2 km cells, as the global
 * DEM. Even samples come from the fixture's first model, odd from its second.
 */
function fakeHeights(answer?: Classified<SourcedHeights>) {
  const calls: Float64Array[] = []
  const heights: ProfileHeights = {
    elevationsAt: async (points, signal) => {
      calls.push(points)
      if (signal.aborted) return unavailable('Cancelled')
      if (answer) return answer
      const out = new Float32Array(points.length / 2)
      const sourceIndex = new Uint8Array(out.length)
      for (let i = 0; i < out.length; i++) {
        out[i] = i === 2 ? Number.NaN : i
        sourceIndex[i] = i % 2
      }
      return official({ heights: out, sourceIndex, sources: [{ label: 'fixture fine model', source: 'fixture fine model', cellKm: 0.02, site: true }, { label: 'fixture coarse model', source: 'fixture coarse model', cellKm: 0.2, site: false }] }, 'fixture chain')
    },
    description: 'fixture cell source',
    noDataReason: 'fixture no-data',
    cellKmAlong: () => 0.2,
  }
  return { heights, calls }
}

const live = () => new AbortController().signal

// The chart's own SVG; the title bar's Minimise icon is an <svg> too.
const CHART_SVG = 'preserveAspectRatio="none"'

describe('pathOfRoute', () => {
  it('is null with no active route, so the panel shows its empty state', () => {
    expect(pathOfRoute(null)).toBeNull()
    const html = renderToStaticMarkup(<ElevationProfileView profile={null} />)
    expect(html).toContain('No route planned')
  })

  it('is the route\'s coordinates in order', () => {
    expect(pathOfRoute(routeThrough(A, B))).toEqual([A, B])
  })
})

describe('readProfile, progressive', () => {
  it('shows a first profile marked as refining, then the final one, each height naming its model', async () => {
    const coarse = (n: number) =>
      official({ heights: new Float32Array(n).fill(7), sourceIndex: new Uint8Array(n).fill(1), sources: [{ label: 'fixture fine', source: 'fixture fine', cellKm: 0.02, site: true }, { label: 'fixture coarse', source: 'fixture coarse', cellKm: 0.2, site: false }] }, 'fixture chain')
    const fine = (n: number) =>
      official({ heights: new Float32Array(n).fill(9), sourceIndex: new Uint8Array(n), sources: [{ label: 'fixture fine', source: 'fixture fine', cellKm: 0.02, site: true }, { label: 'fixture coarse', source: 'fixture coarse', cellKm: 0.2, site: false }] }, 'fixture chain')
    const heights: ProfileHeights = {
      elevationsAt: async (points, _signal, onFirst) => {
        onFirst?.(coarse(points.length / 2))
        return fine(points.length / 2)
      },
      description: 'fixture cell source',
      noDataReason: 'fixture no-data',
      cellKmAlong: () => 0.2,
    }
    const firsts: Classified<ElevationProfile>[] = []
    const last = await readProfile(planFor([A, B], heights), heights, live(), (p) => firsts.push(p))
    expect(firsts).toHaveLength(1)
    const first = firsts[0]
    if (first.classification !== 'DERIVED' || last.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(first.method).toContain(REFINING_NOTE)
    expect(first.value.samples[0].elevationMeters).toEqual(official(7, 'fixture coarse'))
    expect(last.method).not.toContain(REFINING_NOTE)
    expect(last.value.samples[0].elevationMeters).toEqual(official(9, 'fixture fine'))
  })
})

describe('sampleProfile', () => {
  it('reads every planned sample in one call and pairs the heights with them, a no-data cell as a gap', async () => {
    const { heights, calls } = fakeHeights()
    const profile = await sampleProfile([A, B], heights, live())
    expect(calls).toHaveLength(1)
    expect(profile.classification).toBe('DERIVED')
    if (profile.classification !== 'DERIVED') return
    const { samples } = profile.value
    // 1° of arc is about 59 km at 0.2 km cells: capped at 200 samples.
    expect(samples).toHaveLength(200)
    expect(calls[0]).toHaveLength(400)
    // Each height names the model it came from.
    expect(samples[0].elevationMeters).toEqual(official(0, 'fixture fine model'))
    expect(samples[1].elevationMeters).toEqual(official(1, 'fixture coarse model'))
    expect(samples[2].elevationMeters).toEqual(unavailable('fixture no-data'))
    expect(samples[0].coordinate).toEqual(A)
    expect(samples.at(-1)?.coordinate).toEqual(B)
    expect(profile.method).toMatch(/200 samples .*; each height is the fixture cell source/)
    const html = renderToStaticMarkup(<ElevationProfileView profile={profile} />)
    expect(html).toContain(CHART_SVG)
    expect(html).toContain('DERIVED')
  })

  it('answers a path that cannot be profiled without reading anything', async () => {
    const { heights, calls } = fakeHeights()
    expect(reasonOf(await sampleProfile([], heights, live()))).toBe(ELEVATION_PROFILE_REASONS.empty)
    expect(reasonOf(await sampleProfile([A], heights, live()))).toBe(ELEVATION_PROFILE_REASONS.singlePoint)
    expect(reasonOf(await sampleProfile([A, A], heights, live()))).toBe(ELEVATION_PROFILE_REASONS.zeroLength)
    // 0°E and 360°E are the same meridian.
    expect(reasonOf(await sampleProfile([A, { latitude: 0, longitudeEast: 360 }], heights, live()))).toBe(
      ELEVATION_PROFILE_REASONS.zeroLength,
    )
    expect(calls).toHaveLength(0)
    expect(planFor([A, A], heights).classification).toBe('UNAVAILABLE')
  })

  it('passes a failed read through with its reason, so the chart says why', async () => {
    const { heights } = fakeHeights(unavailable('The server answered 503'))
    const profile = await sampleProfile([A, B], heights, live())
    expect(reasonOf(profile)).toBe('The server answered 503')
    const html = renderToStaticMarkup(<ElevationProfileView profile={profile} />)
    expect(html).toContain('Elevation unavailable')
    expect(html).toContain('The server answered 503')
    expect(html).not.toContain(CHART_SVG)
  })

  it('reports a cancelled read as such', async () => {
    const { heights } = fakeHeights()
    const controller = new AbortController()
    controller.abort()
    expect(reasonOf(await readProfile(planFor([A, B], heights), heights, controller.signal))).toBe('Cancelled')
  })

  it('shows the sampling state as the hatched frame saying loading, with its reason, never zeros', () => {
    const html = renderToStaticMarkup(<ElevationProfileView profile={unavailable(SAMPLING_REASON)} />)
    expect(html).toContain('Elevation loading…')
    expect(html).not.toContain('Elevation unavailable')
    expect(html).toContain(SAMPLING_REASON)
    expect(html).not.toContain(CHART_SVG)
    expect(html).not.toContain('0 m')
  })
})

describe('ElevationProfileView zero-length guard', () => {
  // A profile no contract should produce, to prove the view cannot divide by it.
  const zeroLength = (totalDistanceKm: number) =>
    derived<ElevationProfile>(
      {
        samples: [
          { coordinate: A, distanceKm: 0, elevationMeters: derived(10, 'fixture') },
          { coordinate: A, distanceKm: 0, elevationMeters: derived(20, 'fixture') },
        ],
        totalDistanceKm,
      },
      'fixture-method',
    )

  it.each([0, -1, NaN])('draws no chart for a total distance of %s', (km) => {
    const html = renderToStaticMarkup(<ElevationProfileView profile={zeroLength(km)} />)
    expect(html).toContain('no profile to draw')
    expect(html).not.toContain(CHART_SVG)
    expect(html).not.toMatch(/NaN|Infinity/)
  })
})

describe('useProfile key', () => {
  it('round-trips a path through its key at full precision, the empty path included', async () => {
    const { keyOf, pathOf } = await import('../../src/app/useProfile')
    const path: MarsCoordinate[] = [
      { latitude: -4.123456789012345, longitudeEast: 137.98765432109877 },
      { latitude: 0, longitudeEast: 359.99999999999994 },
    ]
    expect(pathOf(keyOf(path))).toEqual(path)
    expect(pathOf(keyOf([]))).toEqual([])
    expect(keyOf(path)).not.toBe(keyOf([path[1], path[0]]))
  })
})

describe('useProfile first render', () => {
  // Effects do not run in a static render, so this is the state before any read lands.
  it('is null with no path, the plan\'s own reason for a path that cannot be profiled, and sampling otherwise', async () => {
    const { useProfile } = await import('../../src/app/useProfile')
    const { heights, calls } = fakeHeights()
    const Probe = ({ path }: { path: MarsCoordinate[] | null }) => {
      const profile = useProfile(path, heights)
      return <span>{profile === null ? 'null' : reasonOf(profile) ?? profile.classification}</span>
    }
    expect(renderToStaticMarkup(<Probe path={null} />)).toContain('null')
    expect(renderToStaticMarkup(<Probe path={[A, A]} />)).toContain(ELEVATION_PROFILE_REASONS.zeroLength)
    expect(renderToStaticMarkup(<Probe path={[A, B]} />)).toContain(SAMPLING_REASON)
    expect(calls).toHaveLength(0)
  })
})
