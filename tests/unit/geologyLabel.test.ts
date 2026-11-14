import { describe, expect, it } from 'vitest'
import type { GeologicMap, GeologicUnitArea, MarsCoordinate } from '../../src/domain'
import { colourNote, geologyMaps, unitText, unitUnder } from '../../src/features/mars-3d/geologyLabel'
import { HOVER_DECIMALS, sameAtDecimals, UNIT_HOVER_DECIMALS } from '../../src/features/mars-3d/hoverCompare'

// Test fixture only: invented shapes and citations, not the map's.
const JEZERO: GeologicMap = { id: 'SIM 3464', title: 'fixture', scaleDenominator: 75000, citation: 'fixture A' }
const GLOBAL: GeologicMap = { id: 'SIM 3292', title: 'fixture', scaleDenominator: 20000000, citation: 'fixture B' }

function box(lat: number, lon: number): MarsCoordinate[] {
  return [
    { latitude: lat - 1, longitudeEast: lon - 1 },
    { latitude: lat - 1, longitudeEast: lon + 1 },
    { latitude: lat + 1, longitudeEast: lon + 1 },
    { latitude: lat + 1, longitudeEast: lon - 1 },
  ]
}

const floor: GeologicUnitArea = { unit: { symbol: 'Jf', name: 'Jezero floor unit', map: JEZERO }, rings: [box(18, 77)] }
const rim: GeologicUnitArea = { unit: { symbol: 'Jcr', name: 'Crater riim unit', map: JEZERO }, rings: [box(10, 77)] }
const plains: GeologicUnitArea = { unit: { symbol: 'Nhu', name: 'plains', map: GLOBAL }, rings: [box(0, 77)] }

describe('geologyLabel: unitUnder', () => {
  it('is OFFICIAL with the map citation inside a unit', () => {
    const u = unitUnder([floor, rim], { latitude: 18, longitudeEast: 77 })
    expect(u).toEqual({ classification: 'OFFICIAL', value: floor.unit, source: 'fixture A' })
  })

  it('is UNAVAILABLE where no map covers the point', () => {
    expect(unitUnder([floor], { latitude: -50, longitudeEast: 10 }).classification).toBe('UNAVAILABLE')
  })
})

describe('geologyLabel: unitText', () => {
  it('keeps the map wording as printed, typos included', () => {
    expect(unitText(rim.unit)).toBe('Crater riim unit (Jcr)')
  })
})

describe('geologyLabel: geologyMaps', () => {
  it('lists each map once, in first-seen order, with its scale', () => {
    expect(geologyMaps([floor, plains, rim]).map((m) => m.text)).toEqual([
      'USGS SIM 3464, 1:75,000',
      'USGS SIM 3292, 1:20,000,000',
    ])
  })
})

describe('the hover names the unit under the cursor', () => {
  // Fixture only: two invented squares meeting at 77.05°E, inside one 0.1° square.
  const MAP = { id: 'fixture', title: 'fixture', scaleDenominator: 1, citation: 'fixture citation' }
  const square = (west: number, east: number) => [[
    { latitude: 18.41, longitudeEast: west },
    { latitude: 18.41, longitudeEast: east },
    { latitude: 18.44, longitudeEast: east },
    { latitude: 18.44, longitudeEast: west },
  ]]
  const AREAS = [
    { unit: { symbol: 'A', name: 'West unit', map: MAP }, rings: square(77.01, 77.05) },
    { unit: { symbol: 'B', name: 'East unit', map: MAP }, rings: square(77.05, 77.09) },
  ]
  const WEST = { latitude: 18.42, longitudeEast: 77.04 }
  const EAST = { latitude: 18.42, longitudeEast: 77.06 }

  it('sees a boundary the coordinate tag\'s one decimal cannot', () => {
    expect(sameAtDecimals({ ...WEST, longitudeEast: 77.051 }, { ...EAST, longitudeEast: 77.09 }, HOVER_DECIMALS)).toBe(true)
    expect(sameAtDecimals(WEST, EAST, UNIT_HOVER_DECIMALS)).toBe(false)
    const west = unitUnder(AREAS, WEST)
    const east = unitUnder(AREAS, EAST)
    expect(west.classification === 'OFFICIAL' && west.value.name).toBe('West unit')
    expect(east.classification === 'OFFICIAL' && east.value.name).toBe('East unit')
  })

  it('cites the source it is given, with the simplification', () => {
    const v = unitUnder(AREAS, WEST, 'fixture citation. Geometry simplified')
    expect(v.classification === 'OFFICIAL' && v.source).toBe('fixture citation. Geometry simplified')
  })

  it('says what the colours are, and when some could not be read', () => {
    expect(colourNote([{ unit: { ...AREAS[0].unit, color: '#112233' }, rings: AREAS[0].rings }])).toBe('colours as the map publishes them')
    expect(colourNote(AREAS)).toContain('could not be read')
  })

  it('names the map that has no unit there, never claiming no map has one', () => {
    const v = unitUnder(AREAS, { latitude: 18.9, longitudeEast: 77.5 })
    expect(v.classification === 'UNAVAILABLE' && v.reason).toBe('fixture has no unit at this point; the coarser global map drawn around it is not read here')
  })
})
