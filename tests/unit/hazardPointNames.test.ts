import { describe, expect, it } from 'vitest'
import {
  derived,
  HAZARD_NOT_CHECKED,
  RADIATION_HAZARD_UNIT,
  unavailable,
  type Hazard,
  type MarsCoordinate,
} from '../../src/domain'
import { drawnHazards, HAZARD_POINT_LABEL, hazardPointName } from '../../src/features/mars-3d/hazardPointNames'
import { HAZARD_LABEL } from '../../src/features/mission-ui/navigation/labels'

const AT: MarsCoordinate = { latitude: 18.5, longitudeEast: 77.2 }
const radiation = (id: string, fraction: number | null): Hazard => ({
  id,
  kind: 'radiation',
  coordinate: AT,
  magnitude: fraction === null ? unavailable('no height here') : derived(fraction, 'fixture'),
  unit: RADIATION_HAZARD_UNIT,
})
const obstacle = (id: string, unit: string): Hazard => ({
  id,
  kind: 'mapped-obstacle',
  coordinate: AT,
  magnitude: unavailable('a map gives no size'),
  unit,
})
const slope = (id: string): Hazard => ({ id, kind: 'slope', coordinate: AT, magnitude: derived(23.46, 'fixture'), unit: '°' })

describe('the hazards a route draws as points', () => {
  it('draws nothing for no route, a route not yet scanned, or a scan that found nothing', () => {
    expect(drawnHazards(null)).toEqual([])
    expect(drawnHazards(undefined)).toEqual([])
    expect(drawnHazards(unavailable('not yet scanned'))).toEqual([])
    expect(drawnHazards(derived([], 'fixture'))).toEqual([])
    // The same list each time, so a view that depends on it does not rebuild.
    expect(drawnHazards(null)).toBe(drawnHazards(derived([], 'fixture')))
  })

  it('draws each hazard that was found, in the route’s order', () => {
    const list = [radiation('a', 0.78), slope('b'), obstacle('c', 'crater rim')]
    expect(drawnHazards(derived(list, 'fixture')).map((h) => h.id)).toEqual(['a', 'b', 'c'])
  })

  it('draws nothing for ground that was not checked: no height, or an unread map', () => {
    const list = [radiation('a', null), obstacle('b', HAZARD_NOT_CHECKED), radiation('c', 0.7)]
    expect(drawnHazards(derived(list, 'fixture')).map((h) => h.id)).toEqual(['c'])
  })
})

describe('what a hazard’s point says', () => {
  it('uses the Hazards panel’s own word for every kind', () => {
    expect(HAZARD_POINT_LABEL).toEqual(HAZARD_LABEL)
  })

  it('names radiation by the atmosphere overhead against the warning line, never as a dose', () => {
    const name = hazardPointName(radiation('a', 0.7999))
    // Floored as the panel's figure is: just under the line never reads as on it.
    expect(name).toBe("Radiation: atmosphere overhead 0.79 of Gale's, under the warning line (0.80) · 18.5°N 77.2°E")
    expect(name).not.toMatch(/Sv|Gy|dose/i)
  })

  it('says a figure is under the warning line only when it is', () => {
    expect(hazardPointName(radiation('a', 0.8))).toBe("Radiation: atmosphere overhead 0.80 of Gale's · 18.5°N 77.2°E")
    expect(hazardPointName(radiation('b', 0.93))).not.toMatch(/warning line/)
  })

  it('names a mapped obstacle by the map’s wording, and another kind by its figure and unit', () => {
    expect(hazardPointName(obstacle('a', 'crater rim'))).toBe('Mapped obstacle: crater rim · 18.5°N 77.2°E')
    expect(hazardPointName(slope('b'))).toBe('Steep slope: 23.5° · 18.5°N 77.2°E')
  })

  it('shows no issue or decision number', () => {
    for (const h of [radiation('a', 0.5), obstacle('b', 'ridge'), slope('c')]) {
      expect(hazardPointName(h)).not.toMatch(/#\d/)
    }
  })
})
