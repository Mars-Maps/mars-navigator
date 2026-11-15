import { describe, expect, it } from 'vitest'
import { DEFAULT_MISSION_SETTINGS, derived, official, unavailable, walkPlanProblem, type GeologicUnit, type GeologicUnitArea, type MarsCoordinate, type WalkPlan } from '../../src/domain'
import { TRANSECT_GOAL, TRANSECT_REASONS, isOwnRim, transectLine, type NamedCrater } from '../../src/features/route-analysis/transectLine'
import { confirmTransectSamples, confirmTransectStops, sampledUnits, transectWalk } from '../../src/features/route-analysis/transectWalk'
import { RETURN_STOP_LABEL } from '../../src/features/route-analysis/scienceGoals'
import { START, KM_PER_DEG, at, xOf, MAP, unit, UNITS, settings, lineOf, profileOf, walkOf } from '../fixtures/transect'

describe('the review of the transect', () => {
  const patch = (name: string, x0: number, x1: number, y0 = -2, y1 = 2): GeologicUnitArea => ({ unit: unit(name), rings: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]] })
  const walkOn = (units: GeologicUnitArea[], start: MarsCoordinate, s = settings(), crater?: NamedCrater) => {
    const line = transectLine(start, units, 5, crater)
    if (line.classification === 'UNAVAILABLE') throw new Error(line.reason)
    return { line: line.value, walk: transectWalk(line.value, profileOf(line.value), units, s) }
  }
  const legsOf = (stops: { id: string; coordinate: MarsCoordinate }[]) =>
    stops.slice(1).map((to, i) => ({
      fromStopId: stops[i].id,
      toStopId: to.id,
      path: derived([stops[i].coordinate, to.coordinate], 'fixture: the straight line'),
      distanceKm: unavailable<number>('fixture'),
      steepestSlopeDeg: unavailable<number>('fixture'),
      hazards: unavailable<never[]>('fixture'),
    }))
  // Rim, a middle unit, the fan the start stands on, and the floor east of it.
  const EAST_FLOOR = [patch('Crater rim unit', -1.7, -1.2), patch('Upper etched unit', -1.2, -0.3), patch('Jezero fan 2 unit', -0.3, 1), patch('Jezero floor unit', 1, 4)]

  it('runs past the nearest floor point, so a landing site off the floor gets a floor sample', () => {
    const { line, walk } = walkOn(EAST_FLOOR, START)
    expect(line.floor).toBe('end')
    // The floor is 1 km east; the nearest point 50 m inside it, the line 150 m past that.
    expect(xOf(line.path[2])).toBeCloseTo(1.2, 2)
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    expect(walk.value.unitsCrossed).toEqual(['Crater rim unit', 'Upper etched unit', 'Jezero fan 2 unit', 'Jezero floor unit'])
    expect(walk.value.stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · Crater rim unit', 'Stop 2 · back at the landing site', 'Stop 3 · Jezero floor unit', RETURN_STOP_LABEL])
    // The walk ends where it began, and the way back from the floor end is in its distance and its time.
    const stops = walk.value.stops
    expect(stops[stops.length - 1].coordinate).toEqual(START)
    expect(walk.value.notes.join(' ')).not.toContain('the way back is not')
    const outKm = -xOf(stops[1].coordinate)
    const floorKm = xOf(stops[3].coordinate)
    const km = walk.value.budget.distanceKm
    expect(km.classification !== 'UNAVAILABLE' && km.value).toBeCloseTo(2 * outKm + 2 * floorKm, 2)
    const total = walk.value.budget.totalMin
    // At 2 km/h on the level, plus the samples: all of it within the settings.
    expect(total.classification !== 'UNAVAILABLE' && total.value).toBeCloseTo((2 * outKm + 2 * floorKm) * 30 + walk.value.samples.length * 5, 0)
    expect(total.classification !== 'UNAVAILABLE' && total.value).toBeLessThanOrEqual(DEFAULT_MISSION_SETTINGS.durationMin)
    const plan: WalkPlan = {
      goal: TRANSECT_GOAL,
      stops: walk.value.stops,
      legs: legsOf(walk.value.stops),
      slopeLimit: { deg: 20, label: 'fixture', source: 'fixture' },
      kind: 'rim-to-floor',
      settings: DEFAULT_MISSION_SETTINGS,
      samples: walk.value.samples.map((s) => s.sample),
    }
    expect(walkPlanProblem(plan)).toBeNull()
  })

  it('shortens the floor side too: a far floor does not make a walk that fits UNAVAILABLE', () => {
    // A case that once failed: the floor 3.5 km east of a start on the fan, an hour allowed.
    const units = [patch('Crater rim unit', -1.2, -0.7), patch('Upper etched unit', -0.7, -0.3), patch('Jezero fan 2 unit', -0.3, 3.5), patch('Jezero floor unit', 3.5, 6)]
    const { walk } = walkOn(units, START, settings({ durationMin: 60 }))
    expect(walk.classification).toBe('DERIVED')
    if (walk.classification !== 'DERIVED') return
    const total = walk.value.budget.totalMin
    expect(total.classification === 'DERIVED' && total.value <= 60).toBe(true)
    expect(walk.value.unitsCrossed.length).toBeGreaterThanOrEqual(2)
    // The floor is out of an hour's reach, and the fan on that side is fan already sampled.
    expect(walk.value.notes.join(' ')).toContain('The walk does not go past the landing site toward the floor: the Jezero floor unit that way does not fit the duration and the energy with the rest')
  })

  it('names the limit by the shortest two-unit walk with two samples, not more', () => {
    const { walk } = walkOn(UNITS, START, settings({ durationMin: 30 }))
    // Out 0.6 km and back is the least that holds a sample on the fan: 36 min of walking and 10 of sampling.
    expect(walk.classification === 'UNAVAILABLE' && walk.reason).toMatch(/with a sample on each, is over the duration limit by 1[789] min/)
    const energy = walkOn(UNITS, START, settings({ energyKcal: 20 })).walk
    expect(energy.classification === 'UNAVAILABLE' && energy.reason).toMatch(/over the energy limit by \d+ kcal/)
  })

  it('carries the line\'s own method: no word of a smaller crater on the main crater\'s own rim', () => {
    const crater: NamedCrater = { name: 'Fixture', centre: at(8, 0), diameterKm: 20, source: 'fixture gazetteer' }
    const units = [patch('Crater rim unit', -2.6, -2), patch('Upper etched unit', -2, -1.4), patch('Jezero fan 2 unit', -1.4, -0.5), patch('Jezero floor unit', -0.5, 3)]
    const { line, walk } = walkOn(units, START, settings(), crater)
    expect(line.rimOf).toBe('Fixture')
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    const methods = [walk.method, ...walk.value.stops.map((s) => (s.reason.classification === 'DERIVED' ? s.reason.method : ''))]
    for (const m of methods) {
      expect(m).toContain("Fixture crater's own rim")
      expect(m).not.toContain("smaller crater's")
    }
  })

  it('reads a landing site on the main crater\'s own rim as that, and one on another outcrop as maybe a smaller crater\'s', () => {
    const crater: NamedCrater = { name: 'Fixture', centre: at(8, 0), diameterKm: 20, source: 'fixture gazetteer' }
    const units = [patch('Crater rim unit', -2.6, -1.5), patch('Jezero fan 2 unit', -1.5, -0.5), patch('Jezero floor unit', -0.5, 3)]
    const own = walkOn(units, at(-2, 0), settings(), crater)
    expect(own.line.startIndex).toBe(0)
    expect(own.line.rimOf).toBe('Fixture')
    const other = walkOn(units, at(-2, 0))
    expect(other.line.rimOf).toBeNull()
    if (other.walk.classification !== 'DERIVED') throw new Error('no walk')
    expect(other.walk.value.notes[0]).toContain('The landing site stands on an outcrop')
    expect(other.walk.value.stops[0].label).toBe('Start')
    expect(other.walk.value.unitsCrossed).toEqual(['Crater rim unit', 'Jezero fan 2 unit', 'Jezero floor unit'])
  })

  it('says so when fewer samples are taken than the settings ask for', () => {
    const short = walkOf(lineOf(), settings({ durationMin: 120 }))
    expect(short.samples.length).toBeLessThan(6)
    expect(short.notes.join(' ')).toContain(`${short.samples.length} of the 6 samples the settings ask for: the duration left after the walking allows no more`)
    // A short line with time to spare: the room on the line is what runs out.
    const units = [patch('Crater rim unit', -0.75, -0.3), patch('Jezero floor unit', -0.3, 3)]
    const { walk } = walkOn(units, START, settings({ samples: 12 }))
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    expect(walk.value.samples.length).toBeLessThan(12)
    expect(walk.value.notes.join(' ')).toContain('the line has no more room')
  })

  it('names the units left without a sample when the settings ask for fewer samples than units', () => {
    const walk = walkOf(lineOf(), settings({ samples: 2 }))
    expect(walk.notes.join(' ')).toMatch(/No sample on .*: more units lie along the walk than samples are taken/)
    expect(walk.notes.join(' ')).not.toContain('samples fit')
  })

  it('does not double back: a floor unit on the rim\'s side ends the line at the landing site', () => {
    // A case that once failed: rim, then the floor, then the fan the start stands on.
    const units = [patch('Crater rim unit', -3.6, -3), patch('Jezero floor unit', -3, -1.5), patch('Jezero fan 2 unit', -1.5, 3)]
    const { line, walk } = walkOn(units, START)
    expect(line.floor).toBe('toward-rim')
    expect(line.path).toHaveLength(2)
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    const xs = walk.value.samples.map((s) => xOf(s.sample.coordinate))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(walk.value.unitsCrossed).toEqual(['Crater rim unit', 'Jezero floor unit', 'Jezero fan 2 unit'])
    expect(walk.value.notes.join(' ')).toContain("on the rim's side of the landing site")
    expect(walk.value.stops[walk.value.stops.length - 1].reason).toMatchObject({ value: 'The landing site, where this transect ends' })
  })

  it('says the inset is along the line, which is all it measures', () => {
    const walk = transectWalk(lineOf(), profileOf(lineOf()), UNITS, settings())
    expect(walk.classification === 'DERIVED' && walk.method).toContain('50 m or more along the line from where the line crosses a contact')
  })

  it('says when no floor unit is in reach and when the rim is not', () => {
    const noFloor = [patch('Crater rim unit', -1.7, -1.2), patch('Upper etched unit', -1.2, -0.3), patch('Jezero fan 2 unit', -0.3, 6)]
    const a = walkOn(noFloor, START)
    expect(a.line.floor).toBe('out-of-reach')
    expect(a.walk.classification === 'DERIVED' && a.walk.value.notes.join(' ')).toContain('No floor unit is within reach')
    const line = lineOf(START, UNITS, 2)
    const b = walkOf(line)
    expect(b.notes.join(' ')).toContain('farther than the walk reaches')
    expect(b.unitsCrossed).toEqual(['Upper etched unit', 'Jezero fan 2 unit', 'Jezero floor unit'])
  })

  it('is UNAVAILABLE, not a throw, for a start that is no coordinate or sits at a pole', () => {
    expect(transectLine({ latitude: 95, longitudeEast: 10 }, UNITS).classification).toBe('UNAVAILABLE')
    expect(transectLine({ latitude: 88, longitudeEast: 10 }, UNITS).classification).toBe('UNAVAILABLE')
  })

  it('is UNAVAILABLE when the settings ask for fewer than two samples', () => {
    expect(transectWalk(lineOf(), profileOf(lineOf()), UNITS, settings({ samples: 1 }))).toEqual({ classification: 'UNAVAILABLE', reason: TRANSECT_REASONS.fewSamples })
  })

  it('reads an outcrop across 0/360°E as one piece', () => {
    const crater: NamedCrater = { name: 'Fixture', centre: { latitude: 0, longitudeEast: 0 }, diameterKm: 20, source: 'fixture' }
    const d = 10 / KM_PER_DEG
    const ring = [{ latitude: d, longitudeEast: 359.99 }, { latitude: d, longitudeEast: 0.01 }, { latitude: d + 0.01, longitudeEast: 0.01 }, { latitude: d + 0.01, longitudeEast: 359.99 }]
    expect(isOwnRim({ unit: unit('Crater rim unit'), rings: [ring] }, crater)).toBe(true)
    // Its middle is at 0°E, 10 km north: a named crater 30 km east of there does not claim it, one at it does.
    const far = { centre: { latitude: d, longitudeEast: 30 / KM_PER_DEG }, diameterKm: 1 }
    expect(isOwnRim({ unit: unit('Crater rim unit'), rings: [ring] }, { ...crater, others: [far] })).toBe(true)
    const here = { centre: { latitude: d, longitudeEast: 0 }, diameterKm: 1 }
    expect(isOwnRim({ unit: unit('Crater rim unit'), rings: [ring] }, { ...crater, others: [here] })).toBe(false)
  })

  it('gives the line\'s room as the reason for fewer samples when the duration would allow more', () => {
    // A case that once failed: 45 min allow four samples on a line with room for two.
    const units = [patch('Crater rim unit', -0.75, -0.3), patch('Jezero floor unit', -0.3, 3)]
    const { walk } = walkOn(units, START, settings({ durationMin: 45 }))
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    expect(walk.value.samples).toHaveLength(2)
    expect(walk.value.notes.join(' ')).toContain('2 of the 6 samples the settings ask for: the line has no more room')
    expect(walk.value.notes.join(' ')).not.toContain('the duration left after the walking')
  })

  it('between equals, takes the walk that samples one of the transect\'s named ends', () => {
    // A case that once failed: the rim side offers two unnamed units, the floor side the fan and the floor.
    const units = [patch('Crater rim unit', -6, -4.6, -6, 6), patch('Upper etched unit', -4.6, -2, -6, 6), patch('Jezero fan 2 unit', -2, 4, -6, 6), patch('Jezero floor unit', 4, 8, -6, 6)]
    // 270 min and two samples: to the floor 4 km east and back fits; to the rim 4.6 km west and back does not.
    // Either side then has two units and room for both samples, so the named end decides.
    const { walk } = walkOn(units, START, settings({ durationMin: 270, samples: 2 }))
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    expect(walk.value.unitsCrossed).toContain('Jezero floor unit')
    expect(walk.value.unitsCrossed).toHaveLength(2)
    // And it does not first walk out over the fan and back, which it samples anyway.
    expect(walk.value.stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · Jezero floor unit', RETURN_STOP_LABEL])
    expect(walk.value.notes.join(' ')).toContain('The walk does not go toward the rim first: the Crater rim unit, Upper etched unit that way do not fit the duration and the energy with the rest')
  })

  it('goes the whole way to the floor once the rim leg is left out', () => {
    // A wall 0.5 km toward the rim; the floor end and the way back from it fit only without the way out toward the rim and back.
    const units = [patch('Crater rim unit', -3, -2.5), patch('Jezero fan 2 unit', -2.5, 2), patch('Jezero floor unit', 2, 6)]
    const line = transectLine(START, units)
    if (line.classification !== 'DERIVED') throw new Error('no line')
    for (const durationMin of [165, 190, 191]) {
      const walk = transectWalk(line.value, profileOf(line.value, (x) => (x < -0.5 ? -2500 + (-0.5 - x) * 1000 : -2500)), units, settings({ durationMin }))
      if (walk.classification !== 'DERIVED') throw new Error('no walk')
      expect(Math.max(...walk.value.path.map(xOf))).toBeCloseTo(xOf(line.value.path[2]), 2)
      expect(walk.value.notes.join(' ')).not.toContain('past the landing site toward the floor, not the whole line')
    }
  })

  it('walks no leg past the landing site that adds nothing', () => {
    const units = [patch('Crater rim unit', -1.2, -0.7), patch('Upper etched unit', -0.7, -0.3), patch('Jezero fan 2 unit', -0.3, 3.5), patch('Jezero floor unit', 3.5, 6)]
    const { walk } = walkOn(units, START, settings({ durationMin: 60 }))
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    const last = walk.value.stops[walk.value.stops.length - 1]
    expect(last.label).toContain('back at the landing site')
    expect(walk.value.notes.join(' ')).not.toContain('The walk ends')
    // The floor is down that leg and an hour does not reach it: the note gives that reason, not "no unit".
    expect(walk.value.notes.join(' ')).not.toContain('that leg would add no unit to sample')
  })

  it('stops on the floor side too where the ground is over the limit, and says so', () => {
    // A wall 600 m east of the start, on the way to the floor.
    const line = transectLine(START, EAST_FLOOR)
    if (line.classification !== 'DERIVED') throw new Error('no line')
    const walk = transectWalk(line.value, profileOf(line.value, (x) => (x > 0.6 ? -2500 + (x - 0.6) * 1000 : -2500)), EAST_FLOOR, settings())
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    expect(Math.max(...walk.value.path.map(xOf))).toBeLessThanOrEqual(0.62)
    expect(walk.value.unitsCrossed).toEqual(['Crater rim unit', 'Upper etched unit', 'Jezero fan 2 unit'])
    const notes = walk.value.notes.join(' ')
    expect(notes).toMatch(/Toward the floor the ground can be walked 0\.\d\d km past the landing site, to where the ground is over the 20° slope limit/)
    // The 600 m of fan left on that side is fan already sampled on the way back from the rim.
    expect(notes).toContain('that leg would add no unit to sample')
    expect(notes).not.toContain('does not fit the duration')
  })

  it('says when the unit at an end has too little ground along the walk for a sample', () => {
    // East of the start: the fan, another unit, then the floor from 4.9 km, of which the 5 km reach leaves 100 m.
    const units = [patch('Crater rim unit', -1.7, -1.2), patch('Jezero fan 2 unit', -1.2, 1), patch('Upper etched unit', 1, 4.9), patch('Jezero floor unit', 4.9, 8)]
    const { walk } = walkOn(units, START, settings({ durationMin: 480, energyKcal: 2000 }))
    if (walk.classification !== 'DERIVED') throw new Error('no walk')
    // The floor end is the last place visited; the walk then comes back.
    expect(walk.value.stops[walk.value.stops.length - 2].label).toContain('Jezero floor unit')
    expect(walk.value.stops[walk.value.stops.length - 1].label).toBe(RETURN_STOP_LABEL)
    expect(walk.value.unitsCrossed).not.toContain('Jezero floor unit')
    expect(walk.value.notes.join(' ')).toContain("No sample on the Jezero floor unit at the walk's end")
  })

  it('renames a stop after the unit the map reads, or drops the name where it reads none', () => {
    const walk = walkOf(lineOf())
    expect(walk.stops[1].label).toBe('Stop 1 · Crater rim unit')
    const reads = [official(unit('Jezero floor unit'), MAP.citation), official(unit('Read unit'), MAP.citation), unavailable<GeologicUnit>('fixture: a contact')]
    const stops = confirmTransectStops(walk.stops, reads)
    expect(stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · Read unit', 'Stop 2 · back at the landing site'])
    expect(confirmTransectStops(walk.stops, [reads[0], reads[2]])[1].label).toBe('Stop 1')
  })

  it('confirms stops and samples by the map\'s read, keeps every one, and counts the units again', () => {
    const walk = walkOf(lineOf())
    const reads = walk.samples.map((_, i) => official(unit(i < 3 ? 'Read unit A' : 'Read unit B', 'Fixture description.'), MAP.citation))
    const confirmed = confirmTransectSamples(walk.samples, reads.slice(0, 5))
    expect(sampledUnits(confirmed)).toEqual(['Read unit A', 'Read unit B'])
    expect(confirmed[5].unit).toEqual({ classification: 'UNAVAILABLE', reason: 'The map was not read at this sample' })
    const stops = confirmTransectStops(walk.stops, [unavailable<GeologicUnit>('fixture: a contact')])
    expect(stops).toHaveLength(walk.stops.length)
    expect(stops[0].unit).toEqual({ classification: 'UNAVAILABLE', reason: 'fixture: a contact' })
    expect(stops[1].unit).toEqual({ classification: 'UNAVAILABLE', reason: 'The map was not read at this stop' })
    expect(stops.map((s) => s.id)).toEqual(walk.stops.map((s) => s.id))
  })
})
