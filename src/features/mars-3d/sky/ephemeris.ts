import {
  DEG,
  J2000_JD,
  MARS_DEC_TERMS,
  MARS_PM,
  MARS_PM_TERMS,
  MARS_POLE_DEC,
  MARS_POLE_RA,
  MARS_RA_TERMS,
  OBLIQUITY_J2000_DEG,
  PLANET_ELEMENTS,
  AU_KM,
  MOON_FIT_EPOCH_JD,
  type MoonFit,
  type PlanetId,
} from './skyConstants'

/** A 3-vector as a plain tuple; these functions run a handful of times per update. */
export type Vec3 = [number, number, number]

const COS_EPS = Math.cos(OBLIQUITY_J2000_DEG * DEG)
const SIN_EPS = Math.sin(OBLIQUITY_J2000_DEG * DEG)

/**
 * Heliocentric position of a planet in km, ICRF (J2000 equatorial), by the
 * procedure of JPL's "Approximate Positions of the Planets": elements at
 * time T, Kepler's equation, the orbital plane, the ecliptic, then the
 * equator. `jdTdb` is a Julian Date in TDB (TT is within 2 ms of it).
 */
export function planetPosition(planet: PlanetId, jdTdb: number): Vec3 {
  const T = (jdTdb - J2000_JD) / 36525
  const [el, rate] = PLANET_ELEMENTS[planet]
  const a = el[0] + rate[0] * T
  const e = el[1] + rate[1] * T
  const I = (el[2] + rate[2] * T) * DEG
  const L = el[3] + rate[3] * T
  const varpi = el[4] + rate[4] * T
  const node = (el[5] + rate[5] * T) * DEG
  const omega = varpi * DEG - node
  const M = ((((L - varpi) % 360) + 540) % 360) - 180 // degrees, in [−180, 180)
  const E = solveKepler(M * DEG, e)
  const xp = a * (Math.cos(E) - e)
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const co = Math.cos(omega)
  const so = Math.sin(omega)
  const cn = Math.cos(node)
  const sn = Math.sin(node)
  const ci = Math.cos(I)
  const si = Math.sin(I)
  const x = (co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp
  const y = (co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp
  const z = so * si * xp + co * si * yp
  return [x * AU_KM, (COS_EPS * y - SIN_EPS * z) * AU_KM, (SIN_EPS * y + COS_EPS * z) * AU_KM]
}

/** E − e·sin E = M, radians, to well under a microradian. */
export function solveKepler(M: number, e: number): number {
  let E = M + e * Math.sin(M)
  for (let k = 0; k < 20; k++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E))
    E += dE
    if (Math.abs(dE) < 1e-12) break
  }
  return E
}

/** Mars's pole (RA, Dec) and prime-meridian angle W, degrees, IAU 2015 model. */
export function marsOrientation(jdTdb: number): { ra: number; dec: number; w: number } {
  const d = jdTdb - J2000_JD
  const T = d / 36525
  const angle = (t: readonly [number, number, number, number]) => (t[1] + t[2] * T + t[3] * T * T) * DEG
  let ra = MARS_POLE_RA[0] + MARS_POLE_RA[1] * T
  for (const t of MARS_RA_TERMS) ra += t[0] * Math.sin(angle(t))
  let dec = MARS_POLE_DEC[0] + MARS_POLE_DEC[1] * T
  for (const t of MARS_DEC_TERMS) dec += t[0] * Math.cos(angle(t))
  let w = MARS_PM[0] + MARS_PM[1] * d
  for (const t of MARS_PM_TERMS) w += t[0] * Math.sin(angle(t))
  return { ra, dec, w: ((w % 360) + 360) % 360 }
}

/**
 * ICRF → Mars body-fixed (x at 0°E on the equator, z to the north pole):
 * Rz(W) · Rx(90° − Dec) · Rz(90° + RA), the IAU convention.
 */
export function icrfToMarsFixed(v: Vec3, o: { ra: number; dec: number; w: number }): Vec3 {
  const a = (90 + o.ra) * DEG
  const b = (90 - o.dec) * DEG
  const c = o.w * DEG
  // Rz(a)
  const x1 = Math.cos(a) * v[0] + Math.sin(a) * v[1]
  const y1 = -Math.sin(a) * v[0] + Math.cos(a) * v[1]
  const z1 = v[2]
  // Rx(b)
  const y2 = Math.cos(b) * y1 + Math.sin(b) * z1
  const z2 = -Math.sin(b) * y1 + Math.cos(b) * z1
  // Rz(c)
  return [Math.cos(c) * x1 + Math.sin(c) * y2, -Math.sin(c) * x1 + Math.cos(c) * y2, z2]
}

/** Mars-centred position of Phobos or Deimos, km, ICRF, from its fitted model. */
export function moonPosition(fit: MoonFit, jdTdb: number): Vec3 {
  const t = jdTdb - MOON_FIT_EPOCH_JD
  const node = (fit.node[0] + fit.node[1] * t) * DEG
  const varpi = (fit.periapsis[0] + fit.periapsis[1] * t) * DEG
  const lambda = (fit.meanLongitude[0] + fit.meanLongitude[1] * t) * DEG
  const e = fit.e
  const E = solveKepler((((lambda - varpi) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e)
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))
  const r = fit.aKm * (1 - e * Math.cos(E))
  const u = varpi - node + nu
  const tilt = fit.tiltDeg * DEG
  // In the pole's frame: x on its equator's node on the ICRF equator.
  const px = r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(tilt))
  const py = r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(tilt))
  const pz = r * Math.sin(u) * Math.sin(tilt)
  const pole = unitFromRaDec(fit.poleRaDeg, fit.poleDecDeg)
  const X = normalize(cross([0, 0, 1], pole))
  const Y = cross(pole, X)
  return [
    px * X[0] + py * Y[0] + pz * pole[0],
    px * X[1] + py * Y[1] + pz * pole[1],
    px * X[2] + py * Y[2] + pz * pole[2],
  ]
}

export function unitFromRaDec(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
