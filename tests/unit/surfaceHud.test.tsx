import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  RADIATION_HAZARD_UNIT,
  derived,
  unavailable,
  type Classified,
  type Hazard,
  type MarsCoordinate,
  type MarsSolarTime,
  type SlopeLimit,
  SUITED_SLOPE_LIMIT,
} from '../../src/domain'
import { PlannedSurfaceHud, SurfaceHud } from '../../src/features/mission-ui/hud/SurfaceHud'
import type { HudStop } from '../../src/features/mission-ui/hud/hudMath'

// Test fixtures only — invented positions, stops, slopes, sun and clock, never shown in the app.
const METHOD = 'fixture-method'
/** Facing east: north is 90° to the left, so the compass heading is 270°. */
const FACING_EAST = derived(270, METHOD)
const HERE = derived<MarsCoordinate>({ latitude: 0, longitudeEast: 10 }, 'fixture-position')
// The cited suited limit: only it carries an OFFICIAL mark with its citation.
const LIMIT: SlopeLimit = SUITED_SLOPE_LIMIT
const SUN = derived(34.4, 'fixture-sky')
/** 12:00 at 0°E with no equation of time, so 12:40 at 10°E. */
const SOLAR = derived<MarsSolarTime>(
  {
    marsSolDate: 50000,
    coordinatedMarsTimeHours: 12,
    solarLongitudeDeg: 100,
    equationOfTimeDeg: 0,
    heliocentricDistanceAu: 1.52,
    subsolarPoint: { latitude: 0, longitudeEast: 0 },
  },
  'fixture-mars24',
)

const stop = (
  label: string,
  latitude: number,
  longitudeEast: number,
  slope: Classified<number> = derived(3, METHOD),
  legHazards: Classified<Hazard[]> = derived([], 'fixture-scan'),
): HudStop => ({
  label,
  coordinate: { latitude, longitudeEast },
  steepestSlopeDeg: slope,
  legHazards,
})
/** 0.2° east of HERE on the equator: 11.8 km, bearing 90°. */
const EAST = (label: string, slope?: Classified<number>) => stop(label, 0, 10.2, slope)
/** 0.1° north of HERE: 5.9 km, bearing 0°. */
const NORTH = (label: string, slope?: Classified<number>) => stop(label, 0.1, 10, slope)
/** 0.001° east of HERE: 59 m, within reach. */
const BESIDE = (label: string) => stop(label, 0, 10.001)

const render = ({
  heading = FACING_EAST,
  position = HERE,
  stops,
  sun = SUN,
  activeStopIndex = 0,
  minimized = false,
}: {
  heading?: Classified<number>
  position?: Classified<MarsCoordinate>
  stops: HudStop[]
  sun?: Classified<number>
  activeStopIndex?: number
  minimized?: boolean
}) =>
  renderToStaticMarkup(
    <SurfaceHud
      heading={heading}
      position={position}
      stops={stops}
      slopeLimit={LIMIT}
      activeStopIndex={activeStopIndex}
      onGoToStop={() => {}}
      sunElevationDeg={sun}
      solar={SOLAR}
      defaultMinimized={minimized}
    />,
  )

/** The opening tag of the button with this name. */
const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]

describe('SurfaceHud: minimised to its title bar', () => {
  const stops = [EAST('Stop 1 · fixture unit'), NORTH('Stop 2')]

  it('has a Minimise button naming the body it hides, and shows everything while open', () => {
    const html = render({ stops })
    const minimise = button(html, 'Minimise Walk guide')
    expect(minimise).toBeDefined()
    const body = minimise!.match(/aria-controls="([^"]+)"/)![1]
    expect(html).toContain(`id="${body}"`)
    expect(html).toContain('To Stop 1 · fixture unit')
    expect(html).toContain('34° above the horizon')
  })

  it('keeps the title, the stop count and Previous / Next on the bar, and hides the rest', () => {
    const html = render({ stops, minimized: true })
    expect(button(html, 'Restore Walk guide')).toContain('aria-expanded="false"')
    expect(html).toContain('>Walk guide</h2>')
    expect(html).toContain('1 of 2')
    // Next still walks on while the guide is small.
    expect(button(html, 'Next stop')).toContain('aria-disabled="false"')
    expect(button(html, 'Previous stop')).toBeDefined()
    expect(html).not.toContain('data-arrow')
    expect(html).not.toContain('To Stop 1')
    expect(html).not.toContain('above the horizon')
  })
})

describe('SurfaceHud', () => {
  it('says no walk is planned, and still shows the sun and the local time', () => {
    const html = render({ stops: [] })
    expect(html).toContain('No walk planned yet')
    expect(html).not.toContain('data-arrow')
    expect(html).toContain('34° above the horizon')
    expect(html).toContain('12:40')
  })

  it('aims at the first stop: the arrow turned by heading plus bearing, its name, distance, bearing and marks', () => {
    const html = render({ stops: [EAST('Stop 1 · fixture unit'), NORTH('Stop 2')] })
    expect(html).toContain('To Stop 1 · fixture unit')
    expect(html).toContain('1 of 2')
    // Facing east, a stop due east is straight ahead.
    expect(html).toContain('rotate(0)')
    expect(html).toContain('<title>Way to Stop 1 · fixture unit, 11.8 km. Straight ahead. ')
    expect(html).toContain('11.8 km')
    expect(html).toContain('Bearing')
    expect(html).toContain('90°')
    // The distance's method names the calculation and where the position came from.
    expect(html).toContain('Haversine great-circle distance')
    expect(html).toContain('from your position (fixture-position)')
    expect(html).toContain('DERIVED')
  })

  it('aims at the shared plan’s stop being walked to', () => {
    const html = render({ stops: [EAST('Stop 1'), NORTH('Stop 2'), EAST('Stop 3')], activeStopIndex: 1 })
    expect(html).toContain('To Stop 2')
    expect(html).toContain('2 of 3')
    expect(button(html, 'Previous stop')).toContain('aria-disabled="false"')
  })

  it('stays on a reached stop and waits for Next, never moving on by itself', () => {
    let wrote: number | null = null
    const html = renderToStaticMarkup(
      <SurfaceHud
        heading={FACING_EAST}
        position={HERE}
        stops={[BESIDE('Stop 1'), NORTH('Stop 2'), EAST('Stop 3')]}
        slopeLimit={LIMIT}
        activeStopIndex={0}
        onGoToStop={(i) => (wrote = i)}
        sunElevationDeg={SUN}
        solar={SOLAR}
        />,
    )
    expect(html).toContain('Stop 1 reached')
    expect(html).toContain('1 of 3')
    expect(html).toContain('Press Next stop to walk on to Stop 2.')
    expect(html).toContain('data-arrived')
    expect(button(html, 'Next stop')).toContain('aria-disabled="false"')
    expect(wrote).toBeNull()
  })

  it('points at the next stop once Next has moved the plan on', () => {
    const html = render({ stops: [BESIDE('Stop 1'), NORTH('Stop 2'), EAST('Stop 3')], activeStopIndex: 1 })
    expect(html).toContain('To Stop 2')
    expect(html).toContain('2 of 3')
    // North, facing east, is 90° to the left.
    expect(html).toContain('rotate(270)')
    expect(html).toContain('90° to your left')
  })

  it('says the last stop is reached and draws a dot, not an arrow, with no Next line', () => {
    const html = render({ stops: [stop('Stop 1', 0, 10.0005), BESIDE('Stop 2')], activeStopIndex: 1 })
    expect(html).not.toContain('Press Next stop')
    expect(html).toContain('Stop 2 reached')
    expect(html).toContain('data-arrived')
    expect(html).not.toContain('data-arrow')
    expect(html).toContain('<title>Way to Stop 2, 59 m. Stop 2 reached: within 100 m</title>')
  })

  it('draws no arrow when the heading is UNAVAILABLE and names the reason; the distance still shows', () => {
    const html = render({ heading: unavailable('fixture-pole'), stops: [NORTH('Stop 1')] })
    expect(html).not.toContain('data-arrow')
    expect(html).not.toContain('rotate(')
    expect(html).toContain('Direction unavailable: No heading: fixture-pole')
    expect(html).toContain('5.9 km')
  })

  it('without a position, shows distance, bearing and local time as unavailable with the reason, never as reached', () => {
    const html = render({ position: unavailable('fixture-no-ground'), stops: [NORTH('Stop 1'), EAST('Stop 2')] })
    expect(html).toContain('To Stop 1')
    expect(html).toContain('1 of 2')
    expect(html).not.toContain('data-arrow')
    expect(html).toContain('No position: fixture-no-ground')
    expect(html).toContain('<title>Way to Stop 1, distance unavailable. ')
    expect(html).not.toContain('12:40')
    expect(html.match(/>unavailable</g)?.length).toBe(3)
  })

  it('shows the steepest slope of the leg in the chart’s bands, with no flag under the limit', () => {
    const html = render({ stops: [EAST('Stop 1', derived(12.4, 'fixture-slope'))] })
    expect(html).toContain('Steepest on the way')
    expect(html).toContain('12.4° moderate')
    expect(html).toContain('fixture-slope')
    expect(html).not.toContain('data-over-limit')
  })

  it('flags a leg over the limit in words, with the limit’s label and citation', () => {
    const html = render({ stops: [EAST('Stop 1', derived(23.4, 'fixture-slope'))] })
    expect(html).toContain('23.4° steep')
    expect(html).toContain('data-over-limit')
    expect(html).toContain(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`)
    expect(html).toContain('NASA EVA-EXP-0075')
    expect(html).toContain('OFFICIAL')
  })

  it('does not flag a leg exactly at the limit: the planner flags steeper than it', () => {
    expect(render({ stops: [EAST('Stop 1', derived(20, 'fixture-slope'))] })).not.toContain('data-over-limit')
  })

  it('shows an unknown slope as unavailable with its reason, and never flags it', () => {
    const html = render({ stops: [EAST('Stop 1', unavailable('fixture-dem-gap'))] })
    expect(html).toContain('fixture-dem-gap')
    expect(html).not.toContain('data-over-limit')
  })

  it('flags a part-checked leg on a stretch the planner measured over the limit, the slope still unavailable', () => {
    const overStretch: Hazard = {
      id: 'fixture-slope-1',
      kind: 'slope',
      unit: '°',
      coordinate: { latitude: 0, longitudeEast: 10.1 },
      magnitude: derived(28.4, 'fixture-stretch'),
    }
    const leg = derived([overStretch], 'fixture-scan')
    const html = render({ stops: [stop('Stop 1', 0, 10.2, unavailable('fixture-part-not-checked'), leg)] })
    expect(html).toContain('fixture-part-not-checked')
    expect(html).toContain('data-over-limit')
    expect(html).toContain(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`)
  })

  it('does not flag a part-checked leg whose only stretch has no figure', () => {
    const unchecked: Hazard = {
      id: 'fixture-slope-1',
      kind: 'slope',
      unit: '°',
      coordinate: { latitude: 0, longitudeEast: 10.1 },
      magnitude: unavailable('fixture-stretch-not-checked'),
    }
    const leg = derived([unchecked], 'fixture-scan')
    expect(render({ stops: [stop('Stop 1', 0, 10.2, unavailable('fixture-part-not-checked'), leg)] })).not.toContain('data-over-limit')
  })

  it('once a stop is reached, shows the slope and flag of the leg on to the next stop, not the one behind', () => {
    const html = render({
      stops: [stop('Stop 1', 0, 10, derived(23, 'fixture-behind')), BESIDE('Stop 2'), EAST('Stop 3', derived(12.4, 'fixture-ahead'))],
      activeStopIndex: 1,
    })
    expect(html).toContain('Stop 2 reached')
    expect(html).toContain('Steepest on the way to Stop 3')
    expect(html).toContain('12.4° moderate')
    expect(html).not.toContain('fixture-behind')
    expect(html).not.toContain('data-over-limit')
  })

  it('at the start of a walk, shows the first leg’s slope instead of “unavailable” for the start', () => {
    const start = stop('Stop 1', 0, 10.001, unavailable('fixture-walk-starts-here'))
    const html = render({ stops: [start, EAST('Stop 2', derived(23.4, 'fixture-first-leg'))] })
    expect(html).toContain('Stop 1 reached')
    expect(html).toContain('Steepest on the way to Stop 2')
    expect(html).toContain('23.4° steep')
    expect(html).toContain('data-over-limit')
    expect(html).not.toContain('fixture-walk-starts-here')
  })

  it('shows no slope row once the last stop is reached: no leg is ahead', () => {
    const html = render({ stops: [stop('Stop 1', 0, 10.0005), stop('Stop 2', 0, 10.001, derived(23.4, 'fixture-last-leg'))], activeStopIndex: 1 })
    expect(html).toContain('Stop 2 reached')
    expect(html).not.toContain('Steepest on the way')
    expect(html).not.toContain('data-over-limit')
  })

  it('shows the sun below the horizon in words, and an impossible elevation as unavailable', () => {
    expect(render({ stops: [], sun: derived(-6.2, 'fixture-sky') })).toContain('6° below the horizon')
    const html = render({ stops: [], sun: derived(120, 'fixture-sky') })
    expect(html).not.toContain('120')
    expect(html).toContain('not an angle between')
  })

  it('shows the local solar time with the mission clock’s method', () => {
    const html = render({ stops: [] })
    expect(html).toContain('Local solar time')
    expect(html).toContain('12:40')
    expect(html).toContain('Local true solar time at your longitude, from the mission clock in the time menu: fixture-mars24')
  })

  it('marks Previous unavailable at the first stop and Next at the last, keeping both focusable', () => {
    const first = render({ stops: [EAST('Stop 1'), NORTH('Stop 2')] })
    expect(button(first, 'Previous stop')).toContain('aria-disabled="true"')
    expect(button(first, 'Next stop')).toContain('aria-disabled="false"')
    const last = render({ stops: [BESIDE('Stop 1'), NORTH('Stop 2')], activeStopIndex: 1 })
    // Back one stop, even one within reach: arriving no longer skips past it.
    expect(button(last, 'Previous stop')).toContain('aria-disabled="false"')
    expect(button(last, 'Next stop')).toContain('aria-disabled="true"')
    // Never `disabled`, which would drop the focus of a keyboard user who just pressed it.
    expect(button(first, 'Previous stop')).not.toMatch(/ disabled=""/)
    expect(button(last, 'Next stop')).not.toMatch(/ disabled=""/)
  })

  it('keeps Space and the arrows for its buttons, so pressing one does not walk', () => {
    const html = render({ stops: [EAST('Stop 1'), NORTH('Stop 2')] })
    expect(button(html, 'Previous stop')).toContain('data-own-keys=""')
    expect(button(html, 'Next stop')).toContain('data-own-keys=""')
  })
})

describe('PlannedSurfaceHud', () => {
  it('renders nothing while nobody stands on the surface (no heading yet)', () => {
    // Server rendering reads the stores' initial state: no heading, no plan.
    const html = renderToStaticMarkup(<PlannedSurfaceHud position={HERE} sunElevationDeg={SUN} />)
    expect(html).toBe('')
  })
})

describe('SurfaceHud radiation glyph', () => {
  const RADIATION: Hazard = {
    id: 'fixture-radiation',
    kind: 'radiation',
    coordinate: { latitude: 0, longitudeEast: 10.2 },
    magnitude: derived(0.7, 'fixture-shielding'),
    unit: RADIATION_HAZARD_UNIT,
  }
  const SLOPE: Hazard = {
    id: 'fixture-slope',
    kind: 'slope',
    coordinate: { latitude: 0, longitudeEast: 10.2 },
    magnitude: derived(24, 'fixture-slope'),
    unit: 'deg',
  }
  const withLeg = (label: string, legHazards: Classified<Hazard[]>) => stop(label, 0, 10.2, undefined, legHazards)

  it('shows one glyph when the leg into the stop aimed at carries the hazard', () => {
    const html = render({ stops: [NORTH('Stop 1'), withLeg('Stop 2', derived([SLOPE, RADIATION], 'fixture-scan'))], activeStopIndex: 1 })
    expect(html.match(/data-radiation-warning/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Radiation HIGH on the next leg: ')
    // The shielding rule: about shielding, never a dose.
    expect(html).not.toMatch(/higher dose|mSv/i)
  })

  it('follows the stop aimed at: none for a leg without it', () => {
    const html = render({ stops: [NORTH('Stop 1'), withLeg('Stop 2', derived([RADIATION], 'fixture-scan'))] })
    expect(html).toContain('To Stop 1')
    expect(html).not.toContain('data-radiation-warning')
  })

  it('shows none for other hazards, or while the leg is not scanned', () => {
    expect(render({ stops: [withLeg('Stop 1', derived([SLOPE], 'fixture-scan'))] })).not.toContain('data-radiation-warning')
    expect(render({ stops: [withLeg('Stop 1', unavailable('fixture-not-scanned'))] })).not.toContain('data-radiation-warning')
  })

  it('once a stop is reached, shows the glyph of the leg on to the next stop', () => {
    const html = render({ stops: [BESIDE('Stop 1'), withLeg('Stop 2', derived([RADIATION], 'fixture-scan'))] })
    expect(html).toContain('Stop 1 reached')
    expect(html.match(/data-radiation-warning/g)).toHaveLength(1)
  })

  it('shows none once the last stop is reached: no leg is ahead', () => {
    const beside = stop('Stop 2', 0, 10.001, undefined, derived([RADIATION], 'fixture-scan'))
    const html = render({ stops: [stop('Stop 1', 0, 10.0005), beside], activeStopIndex: 1 })
    expect(html).toContain('Stop 2 reached')
    expect(html).not.toContain('data-radiation-warning')
  })
})
