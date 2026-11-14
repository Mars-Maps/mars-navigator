import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, unavailable, type Classified, type MarsCoordinate } from '../../src/domain'
import { NO_SAMPLE_ELEVATION_REASON, SAMPLING_REASON } from '../../src/features/mission-ui/navigation/ElevationProfilePanel'
import { TerrainProfileView } from '../../src/features/mission-ui/tools/TerrainProfile'
import { terrainProfileGate } from '../../src/features/mission-ui/tools/terrainProfilePoints'
import type { ElevationProfile } from '../../src/features/route-analysis/elevationProfile'

// Test fixtures only — invented points and elevations, never shown in the app.
const METHOD = 'fixture-method'
const A: MarsCoordinate = { latitude: 0, longitudeEast: 10 }
const B: MarsCoordinate = { latitude: 0, longitudeEast: 20 }

/** What the shell hands over while it reads the heights. */
const pendingProfile = (): Classified<ElevationProfile> => unavailable(SAMPLING_REASON)

const fixtureProfile = (a: MarsCoordinate, b: MarsCoordinate): Classified<ElevationProfile> =>
  derived(
    {
      samples: [
        { coordinate: a, distanceKm: 0, elevationMeters: derived(-1200, METHOD) },
        { coordinate: b, distanceKm: 590, elevationMeters: derived(300, METHOD) },
      ],
      totalDistanceKm: 590,
    },
    METHOD,
  )

const render = (
  points: MarsCoordinate[],
  profileBetween: (a: MarsCoordinate, b: MarsCoordinate) => Classified<ElevationProfile> = pendingProfile,
  replacing: number | null = null,
) =>
  renderToStaticMarkup(
    <TerrainProfileView
      points={points}
      profile={points.length >= 2 ? profileBetween(points[0], points[1]) : null}
      replacing={replacing}
    />,
  )

/** The opening tag of the button with this name. */
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]

describe('terrainProfileGate', () => {
  it('asks for A, then B, in Measure\'s words, and nothing with two', () => {
    expect(terrainProfileGate(0)).toBe('Click the surface to set point A.')
    expect(terrainProfileGate(1)).toBe('Click the surface to set point B.')
    expect(terrainProfileGate(2)).toBeNull()
  })
})

describe('TerrainProfileView', () => {
  it('below two points asks for the next click, lists the point set so far with its pencil and Clear, and draws no chart', () => {
    const none = render([])
    expect(none).toContain('Click the surface to set point A.')
    expect(none).toContain('A third click starts a new line.')
    expect(none).not.toContain('aria-label="Points"')
    // The title bar's Minimise is the only button: nothing to change or clear yet.
    expect(none.match(/<button/g)).toHaveLength(1)
    const one = render([A])
    expect(one).toContain('Click the surface to set point B.')
    expect(one).toContain('aria-label="Points"')
    expect(one.match(/<li/g)).toHaveLength(1)
    expect(one).toContain('>A</span>')
    expect(one).toContain('0.00°N 10.00°E')
    expect(one).toContain('aria-label="Change point A" aria-pressed="false"')
    expect(one).toContain('>Clear</button>')
    expect(one.match(/<button/g)).toHaveLength(3)
    for (const html of [none, one]) {
      expect(html).not.toContain('Elevation unavailable')
      expect(html).not.toContain('<polyline')
    }
  })

  it('with two points lists A and B, each with a pencil, and names the line', () => {
    const html = render([A, B])
    expect(html).toContain('>A</span>')
    expect(html).toContain('>B</span>')
    expect(html).toContain('0.00°N 20.00°E')
    expect(html.match(/aria-label="Change point [AB]"/g)).toHaveLength(2)
    expect(html).toContain('Along the great-circle line from A to B')
    expect(html).not.toContain('Click the surface')
  })

  it('while a point is being moved, its pencil is pressed and the panel says which click moves it', () => {
    const html = render([A, B], pendingProfile, 1)
    expect(html).toContain('aria-label="Change point B" aria-pressed="true"')
    expect(html).toContain('aria-label="Change point A" aria-pressed="false"')
    expect(html).toContain('Click the surface to move point B.')
    expect(html).not.toContain('Along the great-circle line')
  })

  it('while the shell samples, shows the chart\'s frame saying loading, never a line or zeros', () => {
    const html = render([A, B])
    expect(html).toContain('Elevation loading…')
    expect(html).not.toContain('Elevation unavailable')
    expect(html).toContain(SAMPLING_REASON)
    expect(html).not.toContain('<polyline')
    expect(html).not.toContain('0 m')
  })

  it('draws the chart and carries its mark once the profile is DERIVED', () => {
    const html = render([A, B], fixtureProfile)
    expect(html).not.toContain('Elevation unavailable')
    expect(html).toContain('<polyline')
    expect(html).toContain(METHOD)
  })

  it('shows the unavailable frame when no sample along the line has elevation', () => {
    const allGaps = (a: MarsCoordinate, b: MarsCoordinate): Classified<ElevationProfile> =>
      derived(
        {
          samples: [
            { coordinate: a, distanceKm: 0, elevationMeters: unavailable('fixture-gap') },
            { coordinate: b, distanceKm: 590, elevationMeters: unavailable('fixture-gap') },
          ],
          totalDistanceKm: 590,
        },
        METHOD,
      )
    const html = render([A, B], allGaps)
    expect(html).toContain('Elevation unavailable')
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain(NO_SAMPLE_ELEVATION_REASON)
    expect(html).not.toContain('<polyline')
  })
})

describe('Terrain Profile title bar', () => {
  it.each([
    ['below two points', [A]],
    ['with a line drawn', [A, B]],
  ])('%s: Minimise names the body that is there, and there is no ×', (_, points) => {
    const html = render(points)
    const minimise = button(html, 'Minimise Terrain Profile')
    expect(minimise).toBeDefined()
    expect(minimise).toContain('aria-expanded="true"')
    expect(html).not.toContain('aria-label="Close')
  })
})
