import {
  derived,
  official,
  unavailable,
  type Classified,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type MissionSettings,
  type SampleStop,
  type WalkStop,
} from '../../domain'
import type { ElevationProfile } from './elevationProfile'
import { surfaceDistanceKm } from './routeDistance'
import { insideRings, returnStop, tangentPlane, type Xy } from './scienceGoals'
import { walkingKcalPerKm } from './metabolicCost'
import {
  SAMPLE_INSET_KM,
  TRANSECT_COMPOSITION,
  TRANSECT_FLOOR_UNITS,
  TRANSECT_GOAL,
  TRANSECT_REASONS,
  TRANSECT_RIM_UNITS,
  type TransectLine,
} from './transectLine'
import { MIN_SAMPLE_SPACING_M, SAMPLE_MINUTES, fitsSettings, maxSamplesThatFit, placeSamples, walkBudget, type WalkBudget } from './walkBudget'
import { suitedWalkingKmh } from './walkingSpeed'

/**
 * Walk 2 of Plan a walk: the walk along the transect's line
 * (`transectLine.ts`), with a sample on each geologic unit it crosses.
 * Pure: the shell reads the map's units and the heights along the line and
 * asks here.
 *
 * The astronaut walks out to the rim-side end first and samples on the way
 * back, so the samples come in rim-to-floor order. From the floor-side end
 * the walk turns round and comes back along the line to the landing site:
 * it always ends where it began, and that last leg is in the time and the
 * energy the ends are fitted to. It shows where the mapped units change. It
 * says nothing about minerals (`TRANSECT_COMPOSITION`).
 */

/** The step, km, at which the line is tried for a further sample: fine beside the minimum spacing. */
const FILL_STEP_KM = 0.01

const NO_UNIT = 'No unit of the geologic map covers this point'

/** A sample of the transect with the unit under it, by the map's polygons. */
export interface TransectSample {
  sample: SampleStop
  /** The unit the map's polygon gives here; `confirmTransectSamples` replaces it with the map's read of the exact point. */
  unit: Classified<GeologicUnit>
  /** The map's own description of the unit, quoted; UNAVAILABLE where it gives none. */
  description: Classified<string>
}

export interface TransectWalk {
  /** In walking order, every corner of the line walked: the landing site, the rim-side end, the landing site again, the floor end, and the landing site, where the walk ends. */
  stops: WalkStop[]
  /** The line walked, every stop included, in walking order. */
  path: MarsCoordinate[]
  /** The walk's own profile, in walking order, for the budget and the chart. */
  profile: ElevationProfile
  /** Rim to floor, which is the walking order: collected on the way back from the rim-side end. */
  samples: TransectSample[]
  /** The distinct units sampled, rim to floor, by the map's polygons (`sampledUnits`). */
  unitsCrossed: string[]
  /** With the samples placed. */
  budget: WalkBudget
  /** What the walk leaves out and why, each a sentence for the panel; empty when it is the whole transect. */
  notes: string[]
  composition: Classified<string>
}

interface Run {
  unit: GeologicUnit | null
  /** Km along the way back, from its first profile sample to its last. */
  fromKm: number
  toKm: number
}

/** One pair of ends, with what ranks it. */
interface Candidate {
  turn: number
  end: number
  /** Distinct units with room for a sample that the settings leave time for. */
  fit: number
  /** Samples the settings and the time after walking allow. */
  count: number
  /** How many of the transect's two named ends, the rim unit and the floor units, it samples. */
  named: number
}

/**
 * The walk along `line`, fitted to `settings`, from `profile`: the heights
 * along `line.path`, rim side first, every point of the path a sample (as
 * `planProfile` gives it).
 *
 * The walk goes only as far each way as the ground stays within the slope
 * limit and has a height. Within that, both ends are put where the most
 * distinct units can be sampled inside the duration and the energy;
 * between equals, where the settings' whole count of samples fits, then
 * where the rim unit or a floor unit is among those sampled, then farthest
 * out. A leg past the landing site that adds none of these is left out.
 * UNAVAILABLE with the limit that stops it when not even two units can be
 * sampled.
 */
export function transectWalk(
  line: TransectLine,
  profile: ElevationProfile,
  areas: readonly GeologicUnitArea[],
  settings: MissionSettings,
): Classified<TransectWalk> {
  const base = profile.samples
  const start = line.path[line.startIndex]
  // The landing site is a point of the line, so a sample of its profile: found by where it is, not by a distance.
  const iStart = base.findIndex((s) => surfaceDistanceKm(s.coordinate, start) < 1e-6)
  if (base.length < 2 || iStart < 0) return unavailable(TRANSECT_REASONS.noProfile)
  if (settings.samples < 2) return unavailable(TRANSECT_REASONS.fewSamples)

  // How far each way the ground can be walked: up to the first stretch over the limit or without a height.
  const walkable = (i: number) => {
    const a = base[i].elevationMeters
    const b = base[i + 1].elevationMeters
    const run = (base[i + 1].distanceKm - base[i].distanceKm) * 1000
    if (a.classification === 'UNAVAILABLE' || b.classification === 'UNAVAILABLE' || !(run > 0)) return false
    return (Math.atan(Math.abs(b.value - a.value) / run) * 180) / Math.PI <= settings.maxSlopeDeg
  }
  let iOut = iStart
  while (iOut > 0 && walkable(iOut - 1)) iOut--
  let iEnd = iStart
  while (iEnd < base.length - 1 && walkable(iEnd)) iEnd++
  if (iOut === iStart && iEnd === iStart) return unavailable(TRANSECT_REASONS.slope(settings.maxSlopeDeg))

  const plane = tangentPlane(start)
  const flat = areas.map((a) => ({ unit: a.unit, rings: a.rings.map((r) => r.map(plane.project)).filter((r) => r.length >= 3) }))
  const unitUnder = (c: MarsCoordinate) => {
    const p: Xy = plane.project(c)
    return flat.find((a) => insideRings(p, a.rings))?.unit ?? null
  }
  const unitAt = base.map((s) => unitUnder(s.coordinate))

  // What each stretch costs walked toward the floor and toward the rim, summed from the line's rim end, so a
  // pair of ends is costed in one step: the same pace and cost per stretch as `walkBudget`, which then
  // answers for the walk chosen.
  const sums = { floorMin: [0], floorKcal: [0], rimMin: [0], rimKcal: [0] }
  for (let i = 0; i + 1 < base.length; i++) {
    const a = base[i].elevationMeters
    const b = base[i + 1].elevationMeters
    const km = base[i + 1].distanceKm - base[i].distanceKm
    const known = a.classification !== 'UNAVAILABLE' && b.classification !== 'UNAVAILABLE' && km > 0
    // A stretch without a height is never between a pair of ends, so it adds nothing here rather than a NaN.
    const gradient = known ? (b.value - a.value) / (km * 1000) : 0
    const length = known ? km : 0
    sums.floorMin.push(sums.floorMin[i] + (length / suitedWalkingKmh(gradient)) * 60)
    sums.floorKcal.push(sums.floorKcal[i] + length * walkingKcalPerKm(gradient))
    sums.rimMin.push(sums.rimMin[i] + (length / suitedWalkingKmh(-gradient)) * 60)
    sums.rimKcal.push(sums.rimKcal[i] + length * walkingKcalPerKm(-gradient))
  }
  // Out toward the rim to `turn`, back toward the floor to `end`, then toward the rim again from `end` to
  // the landing site: the last is nothing when the walk ends at the landing site (`end` is `iStart`).
  const cost = (turn: number, end: number) => ({
    minutes: sums.rimMin[iStart] - sums.rimMin[turn] + sums.floorMin[end] - sums.floorMin[turn] + sums.rimMin[end] - sums.rimMin[iStart],
    kcal: sums.rimKcal[iStart] - sums.rimKcal[turn] + sums.floorKcal[end] - sums.floorKcal[turn] + sums.rimKcal[end] - sums.rimKcal[iStart],
  })
  const better = (a: Candidate, b: Candidate | null) =>
    b === null || a.fit > b.fit || (a.fit === b.fit && (a.count > b.count || (a.count === b.count && a.named > b.named)))

  const names = (turn: number, end: number) => samplePlaces(unitRuns(base, unitAt, turn, end)).map((r) => r.unit?.name ?? '')
  /** One pair of ends as a candidate; null when it crosses fewer than two units with room for a sample. */
  const rank = (turn: number, end: number): { candidate: Candidate; minutes: number } | null => {
    if (turn === end) return null
    const units = names(turn, end)
    if (units.length < 2) return null
    const { minutes, kcal } = cost(turn, end)
    const room = kcal > settings.energyKcal ? 0 : Math.max(0, Math.floor((settings.durationMin - minutes) / SAMPLE_MINUTES))
    const count = Math.min(room, settings.samples)
    const named = Number(units.some((n) => TRANSECT_RIM_UNITS.includes(n))) + Number(units.some((n) => TRANSECT_FLOOR_UNITS.includes(n)))
    return { candidate: { turn, end, fit: Math.min(count, units.length), count, named }, minutes }
  }

  // Every pair of ends, widest first, so between equals the one farthest out is kept.
  let best: Candidate | null = null
  let shortest: { turn: number; end: number; minutes: number } | null = null
  const widest = samplePlaces(unitRuns(base, unitAt, iOut, iEnd))
  for (let turn = iOut; turn <= iStart; turn++) {
    for (let end = iEnd; end >= iStart; end--) {
      if (turn === end) continue
      const ranked = rank(turn, end)
      // Nearer ends cross no more units than this, so none of them is a transect either.
      if (ranked === null) break
      if (shortest === null || ranked.minutes < shortest.minutes) shortest = { turn, end, minutes: ranked.minutes }
      if (ranked.candidate.fit >= 2 && better(ranked.candidate, best)) best = ranked.candidate
    }
  }
  // A leg that adds nothing to the ranking is not walked: first the way out toward the rim, then the leg past the landing site.
  const leftOut = { rim: false, floor: false }
  if (best !== null && best.turn < iStart && best.end > iStart) {
    const noRimLeg = rank(iStart, best.end)?.candidate
    if (noRimLeg && noRimLeg.fit >= 2 && !better(best, noRimLeg)) {
      best = noRimLeg
      leftOut.rim = true
      // That end was chosen while the walk still paid for the rim leg: without it, the farthest end that ranks as well.
      for (let end = iEnd; end > noRimLeg.end; end--) {
        const farther = rank(iStart, end)?.candidate
        if (farther && farther.fit >= 2 && !better(best, farther)) {
          best = farther
          break
        }
      }
    } else {
      const noFloorLeg = rank(best.turn, iStart)?.candidate
      if (noFloorLeg && noFloorLeg.fit >= 2 && !better(best, noFloorLeg)) {
        best = noFloorLeg
        leftOut.floor = true
      }
    }
  }
  if (best === null) {
    if (shortest === null) return unavailable(TRANSECT_REASONS.oneUnit(widest[0]?.unit?.name ?? null))
    const least = walkBudget(walkProfile(profile, iStart, shortest.turn, shortest.end), 2)
    const broken = fitsSettings(least, settings).breaks.find((b) => b.limit !== 'slope')
    return unavailable(
      broken
        ? `Even the shortest transect over two units, with a sample on each, is over the ${broken.limit} limit by ${broken.over.toFixed(0)} ${broken.limit === 'energy' ? 'kcal' : 'min'}`
        : 'No transect over two units fits the mission settings',
    )
  }

  const { turn, end } = best
  const walk = walkProfile(profile, iStart, turn, end)
  const runs = unitRuns(base, unitAt, turn, end)
  const places = samplePlaces(runs)
  // `walkBudget` has the last word on the room for samples: the sums above only ranked the ends.
  const room = maxSamplesThatFit(walkBudget(walk, 0), settings)
  const count = room.classification === 'UNAVAILABLE' ? 0 : Math.min(room.value, settings.samples)
  if (count < 2) return unavailable('No transect over two units fits the mission settings')
  const outKm = base[iStart].distanceKm - base[turn].distanceKm
  // One per unit first, the widest outcrops kept when there is not room for all.
  const chosen = [...places]
    .sort((a, b) => b.toKm - b.fromKm - (a.toKm - a.fromKm))
    .slice(0, count)
    .map((r) => (r.fromKm + r.toKm) / 2)
  // Each further sample goes where it is farthest from the ones already placed, which spreads them along the line.
  const minKm = MIN_SAMPLE_SPACING_M / 1000
  const windows = runs.filter((r) => r.unit !== null && r.toKm - r.fromKm >= 2 * SAMPLE_INSET_KM)
  while (chosen.length < count) {
    let at = Number.NaN
    let clear = minKm
    for (const w of windows) {
      for (let p = w.fromKm + SAMPLE_INSET_KM; p <= w.toKm - SAMPLE_INSET_KM + 1e-9; p += FILL_STEP_KM) {
        const nearest = Math.min(...chosen.map((c) => Math.abs(c - p)))
        if (nearest > clear) [at, clear] = [p, nearest]
      }
    }
    if (Number.isNaN(at)) break
    chosen.push(at)
  }
  chosen.sort((a, b) => a - b)
  const placed = placeSamples(walk, chosen.length, { maxSlopeDeg: settings.maxSlopeDeg, placesKm: chosen.map((km) => outKm + km) })
  if (placed.classification === 'UNAVAILABLE') return placed

  const samples: TransectSample[] = placed.value.samples.map((sample) => {
    const unit = unitUnder(sample.coordinate)
    return { sample, unit: unit ? official(unit, unit.map.citation) : unavailable(NO_UNIT), description: describe(unit) }
  })
  const unitsCrossed = sampledUnits(samples)

  // Every corner of the line walked is a stop, so the straight legs between stops are the line the samples lie on.
  const stop = (n: number, label: string, coordinate: MarsCoordinate, unit: GeologicUnit | null, why: string): WalkStop => ({
    id: `${TRANSECT_GOAL.id}-${n}`,
    label,
    coordinate,
    unit: unit ? official(unit, unit.map.citation) : unavailable(NO_UNIT),
    reason: derived(why, line.method),
  })
  const stops: WalkStop[] = [stop(1, 'Start', start, unitAt[iStart], 'The landing site, where the walk starts')]
  const add = (name: string, i: number, why: string) =>
    stops.push(stop(stops.length + 1, `Stop ${stops.length} · ${name}`, i === iStart ? start : base[i].coordinate, unitAt[i], why))
  const startOnFloor = line.startUnit !== null && TRANSECT_FLOOR_UNITS.includes(line.startUnit.name)
  if (turn < iStart) {
    add(unitAt[turn]?.name ?? 'rim-side end', turn, 'The rim-side end of the transect: the walk goes out to it first and samples on the way back')
    add(
      'back at the landing site',
      iStart,
      end > iStart
        ? 'The way back passes the landing site and goes on toward the floor'
        : startOnFloor
          ? 'The floor end of the transect, which is the landing site'
          : 'The landing site, where this transect ends',
    )
  }
  if (end > iStart) {
    add(unitAt[end]?.name ?? 'floor end', end, 'The floor-side end of the transect: the walk turns round here and comes back to the landing site')
    stops.push(returnStop(TRANSECT_GOAL, stops.length + 1, stops[0]))
  }

  const limit = `where the ground is over the ${settings.maxSlopeDeg}° slope limit or has no height`
  const tight = 'more does not fit the duration and the energy with a sample on each unit'
  const notes: string[] = []
  if (line.rimOf === null) {
    notes.push(
      line.startIndex === 0
        ? "The landing site stands on an outcrop of the map's crater rim unit, which may be the rim of a smaller crater, not the main crater's own"
        : "The line runs from the nearest outcrop of the map's crater rim unit, which may be the rim of a smaller crater, not the main crater's own",
    )
  }
  if (!line.reachesRim) notes.push(`The crater rim unit is ${line.rimKm.toFixed(1)} km away, farther than the walk reaches, so the transect covers the part toward it that fits`)
  // A leg left out either holds units that do not fit with the rest, or none the walk does not sample anyway.
  const leftOutNote = (side: string, there: readonly string[]) => {
    const more = there.filter((n) => !places.some((r) => r.unit?.name === n))
    return more.length > 0
      ? `The walk does not go ${side}: the ${more.join(', ')} that way ${more.length === 1 ? 'does' : 'do'} not fit the duration and the energy with the rest`
      : `The walk does not go ${side}: that leg would add no unit to sample`
  }
  if (iOut > 0) notes.push(`Toward the rim the ground can be walked ${(base[iStart].distanceKm - base[iOut].distanceKm).toFixed(2)} km from the landing site, to ${limit}`)
  if (leftOut.rim || (turn === iStart && iOut < iStart)) notes.push(leftOutNote('toward the rim first', names(iOut, end)))
  else if (turn > iOut) notes.push(`The transect goes ${outKm.toFixed(2)} km toward the rim, not the whole line: ${tight}`)
  const pastKm = base[end].distanceKm - base[iStart].distanceKm
  if (iEnd < base.length - 1) {
    notes.push(`Toward the floor the ground can be walked ${(base[iEnd].distanceKm - base[iStart].distanceKm).toFixed(2)} km past the landing site, to ${limit}`)
  }
  // Left out by the ranking, or never among the best because going there and coming back does not fit.
  if (leftOut.floor || (end === iStart && iEnd > iStart)) notes.push(leftOutNote('past the landing site toward the floor', names(turn, iEnd)))
  else if (end < iEnd) notes.push(`The transect goes ${pastKm.toFixed(2)} km past the landing site toward the floor, not the whole line: ${tight}`)
  if (line.floor === 'out-of-reach') notes.push('No floor unit is within reach of the landing site, so the transect ends at the landing site')
  if (line.floor === 'toward-rim') notes.push("The nearest floor unit lies on the rim's side of the landing site, so the line is not carried on past the landing site")
  if (samples.length < settings.samples) {
    notes.push(
      samples.length === count
        ? `${samples.length} of the ${settings.samples} samples the settings ask for: the duration left after the walking allows no more`
        : `${samples.length} of the ${settings.samples} samples the settings ask for: the line has no more room ${MIN_SAMPLE_SPACING_M} m from the others and ${SAMPLE_INSET_KM * 1000} m along it from a contact`,
    )
  }
  const unsampled = places.map((r) => r.unit?.name ?? '').filter((name) => !unitsCrossed.includes(name))
  if (unsampled.length > 0) notes.push(`No sample on ${unsampled.join(', ')}: more units lie along the walk than samples are taken, and the widest outcrops come first`)
  for (const i of new Set([turn, end])) {
    const name = unitAt[i]?.name
    if (name && !unitsCrossed.includes(name) && !unsampled.includes(name)) {
      notes.push(`No sample on the ${name} at the walk's end: too little of it lies along the walk for one to stand clear of the contact`)
    }
  }

  return derived(
    {
      stops,
      path: stops.map((s) => s.coordinate),
      profile: walk,
      samples,
      unitsCrossed,
      budget: walkBudget(walk, samples.length),
      notes,
      composition: TRANSECT_COMPOSITION,
    },
    `${line.method}. The walk goes out to the rim-side end and samples on the way back, then comes back along the line to the landing site from its floor-side end: one sample in each unit crossed, ${SAMPLE_INSET_KM * 1000} m or more along the line from where the line crosses a contact, the rest spread along the line, each as far from the others as the line allows; the ends are put where the most units can be sampled with the whole walk, the way back to the landing site included, within the mission settings`,
  )
}

/** The distinct units the samples stand on, in their order; a sample with no unit names none. */
export function sampledUnits(samples: readonly TransectSample[]): string[] {
  return [...new Set(samples.flatMap((s) => (s.unit.classification === 'UNAVAILABLE' ? [] : [s.unit.value.name])))]
}

/**
 * The samples with the unit the map answers for each exact point,
 * `reads[i]` for `samples[i]`: the polygons that placed them are simplified
 * and may carry no text, so this is where a sample gets the map's own
 * description. A read that gives no unit (a contact, a failed read) leaves
 * the sample in place with that read as its unit: a failed service is no
 * finding about the ground. A sample with no read at all is UNAVAILABLE and
 * says so. Ask `sampledUnits` again afterwards: a read can name another unit.
 */
export function confirmTransectSamples(
  samples: readonly TransectSample[],
  reads: readonly Classified<GeologicUnit>[],
): TransectSample[] {
  return samples.map((s, i) => {
    const read = reads[i] ?? unavailable<GeologicUnit>('The map was not read at this sample')
    return { sample: s.sample, unit: read, description: read.classification === 'UNAVAILABLE' ? unavailable(read.reason) : describe(read.value) }
  })
}

/**
 * The stops with the unit the map answers for each exact point, as
 * `confirmTransectSamples` does for the samples. Every stop stays: each is
 * a corner of the line, and a walk with one dropped is another line. A
 * stop named after the polygon's unit is renamed after the unit read, or
 * loses the name where the read gives none, so label and unit agree.
 */
export function confirmTransectStops(stops: readonly WalkStop[], reads: readonly Classified<GeologicUnit>[]): WalkStop[] {
  return stops.map((s, i) => {
    const unit = reads[i] ?? unavailable<GeologicUnit>('The map was not read at this stop')
    const was = s.unit.classification === 'UNAVAILABLE' ? null : s.unit.value.name
    const named = was !== null && s.label.endsWith(` · ${was}`)
    const head = named ? s.label.slice(0, -` · ${was}`.length) : s.label
    const label = !named ? s.label : unit.classification === 'UNAVAILABLE' ? head : `${head} · ${unit.value.name}`
    return { ...s, label, unit }
  })
}

function describe(unit: GeologicUnit | null): Classified<string> {
  if (unit === null) return unavailable(NO_UNIT)
  if (!unit.description) return unavailable(`${unit.map.id} gives no description of the ${unit.name} here`)
  return official(`${unit.name}: "${unit.description}"`, unit.map.citation)
}

/** The walk's profile: out from the landing site to `turn`, back along the line to `end`, and from there back to the landing site. */
function walkProfile(profile: ElevationProfile, iStart: number, turn: number, end: number): ElevationProfile {
  const base = profile.samples
  const order: number[] = []
  for (let i = iStart; i > turn; i--) order.push(i)
  for (let i = turn; i <= end; i++) order.push(i)
  for (let i = end - 1; i >= iStart; i--) order.push(i)
  let km = 0
  const samples = order.map((i, n) => {
    if (n > 0) km += Math.abs(base[i].distanceKm - base[order[n - 1]].distanceKm)
    return { ...base[i], distanceKm: km }
  })
  return { samples, totalDistanceKm: km }
}

/** The stretches of one unit along the way back from `turn` to `end`, by the unit under each profile sample. */
function unitRuns(base: ElevationProfile['samples'], unitAt: readonly (GeologicUnit | null)[], turn: number, end: number): Run[] {
  const runs: Run[] = []
  for (let i = turn; i <= end; i++) {
    const km = base[i].distanceKm - base[turn].distanceKm
    const last = runs[runs.length - 1]
    if (last && last.unit?.name === unitAt[i]?.name) last.toKm = km
    else runs.push({ unit: unitAt[i], fromKm: km, toKm: km })
  }
  return runs
}

/**
 * Where a sample can go for each distinct unit: its widest stretch, if that
 * leaves room to stand `SAMPLE_INSET_KM` from both ends. The line crosses a
 * contact between the last sample of one stretch and the first of the
 * next, so the inset from a stretch's own ends keeps a sample that far
 * along the line from the crossing. Rim to floor.
 */
function samplePlaces(runs: readonly Run[]): Run[] {
  const widest = new Map<string, Run>()
  for (const r of runs) {
    if (r.unit === null || r.toKm - r.fromKm < 2 * SAMPLE_INSET_KM) continue
    const had = widest.get(r.unit.name)
    if (!had || r.toKm - r.fromKm > had.toKm - had.fromKm) widest.set(r.unit.name, r)
  }
  return [...widest.values()].sort((a, b) => a.fromKm - b.fromKm)
}
