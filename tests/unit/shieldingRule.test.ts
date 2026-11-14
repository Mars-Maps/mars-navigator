import { describe, expect, it } from 'vitest'
import { GALE_RAD_REFERENCE } from '../../src/data/radiation/galeRadReference'
import {
  GALE_RAD_ELEVATION_KM,
  MARS_SCALE_HEIGHT_KM,
  RADIATION_LEVEL_BASIS,
  RADIATION_LEVEL_LINES,
  RADIATION_LEVEL_TEXT,
  radiationLevel,
  MARS_SCALE_HEIGHT_SOURCE,
  RADIATION_HAZARD_UNIT,
  SHIELDING_METHOD,
  SHIELDING_WARNING_BASIS,
  SHIELDING_WARNING_FRACTION,
  SHIELDING_WARNING_TEXT,
  columnMassFraction,
  isShieldingWarning,
  shieldingWarningElevationM,
  unavailable,
  type Hazard,
} from '../../src/domain'

// Heights read from the Jezero CTX 20 m model on 2026-10-28.
const JEZERO = { landingSite: -2567, deltaTop: -2483, westernRim: -1962, highestCell: -1550 }

describe('atmospheric shielding rule', () => {
  it('cites the scale height and the Gale reference, and shares the Gale height with the reference entry', () => {
    expect(MARS_SCALE_HEIGHT_KM).toBe(11)
    expect(MARS_SCALE_HEIGHT_SOURCE).toMatch(/marsfact\.html.*Scale height: 11\.0 km.*checked 2026-10-28/)
    expect(GALE_RAD_ELEVATION_KM).toBe(-4.4)
    expect(GALE_RAD_REFERENCE.elevationKm).toBe(GALE_RAD_ELEVATION_KM)
  })

  it('gives f = 1 at Gale, under 1 on higher ground, over 1 in a deeper basin', () => {
    expect(columnMassFraction(-4400)).toBeCloseTo(1, 12)
    expect(columnMassFraction(0)).toBeCloseTo(Math.exp(-4.4 / 11), 12)
    expect(columnMassFraction(21_000)).toBeLessThan(0.11)
    expect(columnMassFraction(-7000)).toBeGreaterThan(1.2)
  })

  it('is NaN for a missing height, which is neither a warning nor an all-clear', () => {
    for (const h of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(columnMassFraction(h)).toBeNaN()
      expect(isShieldingWarning(columnMassFraction(h))).toBe(false)
    }
  })

  it('at Jezero flags the rim crests and leaves the floor, the landing site and the delta alone', () => {
    const f = (m: number) => columnMassFraction(m)
    expect(f(JEZERO.landingSite)).toBeCloseTo(0.846, 2)
    expect(isShieldingWarning(f(JEZERO.landingSite))).toBe(false)
    expect(isShieldingWarning(f(JEZERO.deltaTop))).toBe(false)
    expect(f(JEZERO.highestCell)).toBeCloseTo(0.772, 2)
    expect(isShieldingWarning(f(JEZERO.highestCell))).toBe(true)
    // The western rim sits 16 m under the line (−1,962 m against −1,946 m): not flagged, a borderline case.
    expect(f(JEZERO.westernRim)).toBeCloseTo(0.80, 2)
    expect(isShieldingWarning(f(JEZERO.westernRim))).toBe(false)
  })

  it('reads three levels on the fraction, with HIGH exactly the warning', () => {
    expect(RADIATION_LEVEL_LINES).toEqual({ low: 1, high: SHIELDING_WARNING_FRACTION })
    expect(radiationLevel(0.5)).toBe('HIGH')
    expect(radiationLevel(0.7999)).toBe('HIGH')
    expect(radiationLevel(0.8)).toBe('MEDIUM')
    expect(radiationLevel(0.9999)).toBe('MEDIUM')
    expect(radiationLevel(1)).toBe('LOW')
    expect(radiationLevel(1.3)).toBe('LOW')
    for (const f of [0.3, 0.79, 0.8, 0.95, 1, 1.5]) expect(radiationLevel(f) === 'HIGH').toBe(isShieldingWarning(f))
    for (const h of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(radiationLevel(h)).toBeNull()
  })

  it('at Jezero: the rim crest HIGH, the floor and the delta MEDIUM, nothing LOW', () => {
    expect(radiationLevel(columnMassFraction(JEZERO.highestCell))).toBe('HIGH')
    expect(radiationLevel(columnMassFraction(JEZERO.westernRim))).toBe('MEDIUM')
    expect(radiationLevel(columnMassFraction(JEZERO.landingSite))).toBe('MEDIUM')
    expect(radiationLevel(columnMassFraction(JEZERO.deltaTop))).toBe('MEDIUM')
    // LOW needs Gale's own column or more: ground at or below −4,400 m.
    expect(radiationLevel(columnMassFraction(-4400))).toBe('LOW')
    expect(radiationLevel(columnMassFraction(-4399))).toBe('MEDIUM')
  })

  it('the level texts say what each means without a dose, and the basis names the lines as a project scale', () => {
    expect(RADIATION_LEVEL_TEXT.HIGH).toBe(SHIELDING_WARNING_TEXT)
    for (const text of [...Object.values(RADIATION_LEVEL_TEXT), RADIATION_LEVEL_BASIS]) {
      expect(text).not.toMatch(/mSv|sievert|higher dose|\bsafe\b/i)
    }
    expect(RADIATION_LEVEL_BASIS).toMatch(/not a dose/)
    expect(RADIATION_LEVEL_BASIS).toMatch(/1\.00/)
    expect(RADIATION_LEVEL_BASIS).toMatch(/0\.80/)
    // Shown on screen: what the line means, no tracker number a reader cannot look up.
    expect(RADIATION_LEVEL_BASIS).toMatch(/a project choice, not an agency limit/)
    expect(RADIATION_LEVEL_BASIS).not.toMatch(/#\d/)
  })

  it('puts the warning line at −1,946 m and states the threshold as a project choice', () => {
    expect(SHIELDING_WARNING_FRACTION).toBe(0.8)
    expect(shieldingWarningElevationM()).toBeCloseTo(-1945.5, 0)
    expect(isShieldingWarning(columnMassFraction(shieldingWarningElevationM() + 1))).toBe(true)
    expect(isShieldingWarning(columnMassFraction(shieldingWarningElevationM() - 1))).toBe(false)
    expect(SHIELDING_WARNING_BASIS).toMatch(/Project choice/)
    expect(SHIELDING_WARNING_BASIS).toMatch(/not an agency limit/)
    expect(SHIELDING_WARNING_BASIS).not.toMatch(/#\d/)
  })

  it('names the method, the unit and the text, none of which mention a dose value', () => {
    expect(SHIELDING_METHOD).toMatch(/exp\(−\(h − h_Gale\) \/ H\)/)
    expect(SHIELDING_METHOD).toMatch(/h_Gale = −4\.4 km/)
    expect(SHIELDING_METHOD).toMatch(/H = 11\.0 km/)
    expect(SHIELDING_METHOD).toMatch(/dose itself is not derived/)
    expect(RADIATION_HAZARD_UNIT).toBe('fraction of the Gale column')
    expect(SHIELDING_WARNING_TEXT).toMatch(/^Less atmospheric shielding than at Gale/)
    expect(SHIELDING_WARNING_TEXT).toMatch(/Dose here: UNAVAILABLE$/)
    for (const text of [SHIELDING_METHOD, SHIELDING_WARNING_TEXT, SHIELDING_WARNING_BASIS]) {
      expect(text).not.toMatch(/higher dose|mSv|mGy/)
    }
  })

  it('types a radiation hazard with the named unit and other kinds with a free string', () => {
    const radiation: Hazard = {
      id: 'r',
      kind: 'radiation',
      coordinate: { latitude: 18.4, longitudeEast: 77.4 },
      magnitude: unavailable('fixture'),
      unit: RADIATION_HAZARD_UNIT,
    }
    const slope: Hazard = { ...radiation, id: 's', kind: 'slope', unit: 'deg' }
    expect(radiation.unit).toBe('fraction of the Gale column')
    expect(slope.unit).toBe('deg')
    // @ts-expect-error a radiation hazard cannot carry a dose unit
    const wrong: Hazard = { ...radiation, unit: 'mSv/day' }
    expect(wrong.kind).toBe('radiation')
  })
})
