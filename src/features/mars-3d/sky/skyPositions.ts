import {
  derived,
  MARS_MEAN_RADIUS_KM,
  unavailable,
  type Classified,
  type MarsCoordinate,
} from '../../../domain'
import { mars24Steps } from '../../../domain/mars24'
import {
  icrfToMarsFixed,
  marsOrientation,
  moonPosition,
  planetPosition,
  sub,
  unitFromRaDec,
  type Vec3,
} from './ephemeris'
import {
  DEG,
  DEIMOS_FIT,
  DEIMOS_RADII_KM,
  MARS_ORIENTATION_SOURCE,
  MOON_FIT_METHOD,
  MOON_FIT_VALID_JD,
  PHOBOS_FIT,
  PHOBOS_RADII_KM,
  PLANET_ELEMENTS_SOURCE,
  PLANET_ELEMENTS_VALID_JD,
  PLANET_RADIUS_KM,
  RADII_SOURCE,
  SUN_RADIUS_KM,
  type MoonFit,
  type PlanetId,
} from './skyConstants'

export type SkyBodyId = 'sun' | 'phobos' | 'deimos' | Exclude<PlanetId, 'mars'>

/** Where one body is in the observer's sky. Local frame: x east, y north, z up. */
export interface SkyPlacement {
  /** Unit vector from the observer to the body. */
  direction: Vec3
  distanceKm: number
  /** Half the body's apparent width, radians (its largest radius for a moon). */
  angularRadius: number
  altitudeDeg: number
  /** Clockwise from north, 0–360. */
  azimuthDeg: number
  /** Moons only: unit vectors towards Mars's centre (long axis) and along the orbit pole (short axis). */
  axes?: { toMars: Vec3; pole: Vec3 }
  /** Moons only: inside Mars's shadow (eclipsed), by a cylindrical shadow of the mean radius. */
  inMarsShadow?: boolean
}

export interface SkyBody {
  id: SkyBodyId
  label: string
  kind: 'sun' | 'moon' | 'planet'
  /** Radii in km, for drawing at true angular size: [long, mid, short] for moons. */
  radiiKm: readonly [number, number, number]
  placement: Classified<SkyPlacement>
}

const PLANETS: [Exclude<PlanetId, 'mars'>, string][] = [
  ['mercury', 'Mercury'],
  ['venus', 'Venus'],
  ['earth', 'Earth'],
  ['jupiter', 'Jupiter'],
  ['saturn', 'Saturn'],
  ['uranus', 'Uranus'],
  ['neptune', 'Neptune'],
]

const PLANET_METHOD =
  `Mars-centred position from ${PLANET_ELEMENTS_SOURCE}; Mars orientation ${MARS_ORIENTATION_SOURCE}; ` +
  `sizes ${RADII_SOURCE}; geometric, light-time ignored (under 0.01° here)`
const MOON_METHOD = `${MOON_FIT_METHOD}; Mars orientation ${MARS_ORIENTATION_SOURCE}; sizes ${RADII_SOURCE}`

/**
 * The Sun, Phobos, Deimos and the planets as seen from `observer` on the
 * Mars mean sphere at `utcMs`. Every placement is DERIVED with its method,
 * or UNAVAILABLE with the reason: planets outside 1800–2050, moons outside
 * the 2024–2030 fit. Topocentric, so Phobos's large parallax is included.
 */
export function skyAt(utcMs: number, observer: MarsCoordinate): SkyBody[] {
  const jd = mars24Steps(utcMs).jdTt
  const orientation = marsOrientation(jd)
  const planetsValid = jd >= PLANET_ELEMENTS_VALID_JD[0] && jd < PLANET_ELEMENTS_VALID_JD[1]
  const moonsValid = jd >= MOON_FIT_VALID_JD[0] && jd < MOON_FIT_VALID_JD[1]

  const lat = observer.latitude * DEG
  const lon = observer.longitudeEast * DEG
  const up: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
  const east: Vec3 = [-Math.sin(lon), Math.cos(lon), 0]
  const north: Vec3 = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)]
  const site: Vec3 = [up[0] * MARS_MEAN_RADIUS_KM, up[1] * MARS_MEAN_RADIUS_KM, up[2] * MARS_MEAN_RADIUS_KM]
  const local = (fixed: Vec3): Vec3 => [dot(fixed, east), dot(fixed, north), dot(fixed, up)]

  /** From a Mars-centred ICRF position (km) to a placement in the local sky. */
  const place = (icrf: Vec3, radiusKm: number): SkyPlacement => {
    const rel = local(sub(icrfToMarsFixed(icrf, orientation), site))
    const distanceKm = Math.hypot(rel[0], rel[1], rel[2])
    const direction: Vec3 = [rel[0] / distanceKm, rel[1] / distanceKm, rel[2] / distanceKm]
    return {
      direction,
      distanceKm,
      angularRadius: Math.asin(Math.min(1, radiusKm / distanceKm)),
      altitudeDeg: Math.asin(direction[2]) / DEG,
      azimuthDeg: ((Math.atan2(direction[0], direction[1]) / DEG) % 360 + 360) % 360,
    }
  }

  const bodies: SkyBody[] = []
  const planetGone = unavailable<SkyPlacement>(
    'Planet positions use JPL elements fitted for 1800–2050; this time is outside that range',
  )
  const mars = planetsValid ? planetPosition('mars', jd) : null

  bodies.push({
    id: 'sun',
    label: 'Sun',
    kind: 'sun',
    radiiKm: [SUN_RADIUS_KM, SUN_RADIUS_KM, SUN_RADIUS_KM],
    placement: mars
      ? derived(place([-mars[0], -mars[1], -mars[2]], SUN_RADIUS_KM), PLANET_METHOD)
      : planetGone,
  })

  const moon = (id: 'phobos' | 'deimos', label: string, fit: MoonFit, radii: readonly [number, number, number]) => {
    if (!moonsValid) {
      bodies.push({
        id,
        label,
        kind: 'moon',
        radiiKm: radii,
        placement: unavailable(
          'Moon positions come from a fit to JPL Horizons for 2024–2030; this time is outside it',
        ),
      })
      return
    }
    const pos = moonPosition(fit, jd)
    const p = place(pos, radii[0])
    if (mars) {
      // Mars's shadow points away from the Sun, i.e. along +mars (heliocentric).
      const len = Math.hypot(mars[0], mars[1], mars[2])
      const along = (pos[0] * mars[0] + pos[1] * mars[1] + pos[2] * mars[2]) / len
      const off = Math.hypot(
        pos[0] - (along * mars[0]) / len,
        pos[1] - (along * mars[1]) / len,
        pos[2] - (along * mars[2]) / len,
      )
      p.inMarsShadow = along > 0 && off < MARS_MEAN_RADIUS_KM
    }
    const toMarsFixed = icrfToMarsFixed([-pos[0], -pos[1], -pos[2]], orientation)
    const poleFixed = icrfToMarsFixed(unitFromRaDec(fit.poleRaDeg, fit.poleDecDeg), orientation)
    const toMars = local(toMarsFixed)
    const len = Math.hypot(toMars[0], toMars[1], toMars[2])
    p.axes = { toMars: [toMars[0] / len, toMars[1] / len, toMars[2] / len], pole: local(poleFixed) }
    bodies.push({ id, label, kind: 'moon', radiiKm: radii, placement: derived(p, MOON_METHOD) })
  }
  moon('phobos', 'Phobos', PHOBOS_FIT, PHOBOS_RADII_KM)
  moon('deimos', 'Deimos', DEIMOS_FIT, DEIMOS_RADII_KM)

  for (const [id, label] of PLANETS) {
    const r = PLANET_RADIUS_KM[id]
    let placement: Classified<SkyPlacement> = planetGone
    if (mars) {
      const p = planetPosition(id, jd)
      placement = derived(place([p[0] - mars[0], p[1] - mars[1], p[2] - mars[2]], r), PLANET_METHOD)
    }
    bodies.push({ id, label, kind: 'planet', radiiKm: [r, r, r], placement })
  }
  return bodies
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
