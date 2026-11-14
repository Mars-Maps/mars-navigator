/**
 * What walking over sloping ground costs a human: the
 * energy cost of walking against gradient measured by Minetti et al.
 * (2002), per kilogram and metre, priced for a stated body mass. An Earth
 * model of unsuited walking by runners; no published correction for
 * a pressure suit or for Mars gravity was found in the sources read, so none
 * is applied, and every figure derived from it says so.
 */

/** The study, as cited on every figure. */
export const MINETTI_SOURCE =
  'Minetti, A. E., Moia, C., Roi, G. S., Susta, D. & Ferretti, G. (2002), "Energy cost of walking and running at extreme uphill and downhill slopes", J Appl Physiol 93:1039–1046, doi 10.1152/japplphysiol.01177.2001: 10 runners on a treadmill at gradients −0.45 to +0.45, Earth gravity, unsuited'

/** The steepest gradient the study measured, either way; the fit is not used beyond it. */
export const MINETTI_GRADIENT_RANGE = 0.45

/**
 * The energy cost of walking, J per kg per metre along the ground, against
 * the gradient `s` (rise over run, uphill positive): the study's fifth-order
 * fit, 2.5 on the level (the study's least measured level cost is 1.64 ± 0.50
 * at 1.0 ± 0.3 m/s; the speed behind the fit is not stated in the sources
 * read), 17.6 at +0.45, and least on a gentle descent, about 0.9 near
 * −0.15, so walking downhill is never free. Gradients beyond the measured
 * range are costed at its edge.
 */
export function walkingCostJPerKgM(s: number): number {
  const i = Math.max(-MINETTI_GRADIENT_RANGE, Math.min(MINETTI_GRADIENT_RANGE, s))
  return 280.5 * i ** 5 - 58.7 * i ** 4 - 76.8 * i ** 3 + 51.9 * i ** 2 + 19.6 * i + 2.5
}

/** The fit's level value, the figure the others are read against. */
export const LEVEL_COST_J_PER_KG_M = walkingCostJPerKgM(0)

/**
 * The body mass the kilocalorie figures are for: the middle of NASA's
 * unsuited crew range, a project choice stated on every figure, with the
 * per-kilogram cost beside it so another mass is one multiplication away.
 * The range was read from the standard's online edition on 2026-11-03 and
 * checked against the Rev C and Rev F PDFs on 2026-11-06, which number the
 * table differently and give the same figures.
 */
export const REFERENCE_MASS = {
  kg: 76.43,
  source:
    'a project choice: the middle of the unsuited crewmember body mass range of NASA-STD-3001 Vol. 2 (42.64–110.22 kg; Appendix E, Table E.5-1 of the online edition read 2026-11-03, Table 45 in the Rev C PDF, Table E.6.1 in the Rev F PDF)',
} as const

export const J_PER_KCAL = 4184

/** Kilocalories per km along the ground at gradient `s`, for the reference mass. */
export function walkingKcalPerKm(s: number): number {
  return (walkingCostJPerKgM(s) * REFERENCE_MASS.kg * 1000) / J_PER_KCAL
}

/**
 * The least the fit gives within `maxGradient`, J/kg/m, on a gentle descent.
 * Found by scanning the fit, which is cheap and needs no calculus to stay
 * right if the coefficients change: a coarse scan of the range, then a fine
 * one over the two coarse steps around its best point, so a scan point sits
 * within about 1e-10 of the true minimum for any curve as smooth as this one.
 */
export function leastWalkingCostJPerKgM(maxGradient: number): number {
  const steps = 2000
  const scan = (from: number, to: number) => {
    let least = Number.POSITIVE_INFINITY
    let at = from
    for (let k = 0; k <= steps; k++) {
      const s = from + ((to - from) * k) / steps
      const cost = walkingCostJPerKgM(s)
      if (cost < least) [least, at] = [cost, s]
    }
    return { least, at }
  }
  const coarse = scan(-maxGradient, maxGradient)
  const step = (2 * maxGradient) / steps
  const fine = scan(Math.max(-maxGradient, coarse.at - step), Math.min(maxGradient, coarse.at + step))
  return Math.min(coarse.least, fine.least)
}

/**
 * The least any step within `maxGradient` can cost per km: the lower bound
 * a search's heuristic needs, the scanned minimum with a margin taken off
 * that keeps the bound under it.
 */
export function leastWalkingKcalPerKm(maxGradient: number): number {
  return (leastWalkingCostJPerKgM(maxGradient) * REFERENCE_MASS.kg * 1000) / J_PER_KCAL - 1e-6
}

/** The derivation, for a DERIVED method. */
export const METABOLIC_COST_METHOD = `Metabolic energy from the slope of each step: the energy cost of walking against gradient of ${MINETTI_SOURCE}, as the study's fitted curve, ${LEVEL_COST_J_PER_KG_M.toFixed(1)} J/kg/m on the level and never below ${leastWalkingCostJPerKgM(MINETTI_GRADIENT_RANGE).toFixed(1)} J/kg/m downhill; the study's least measured level cost is 1.64 ± 0.50 J/kg/m at 1.0 ± 0.3 m/s, so on Earth the fit sits above the study's measured level minimum; for a suited walker at Mars gravity even the direction of the error is not known, and the speed behind the fit is not stated in the sources read. The cost is per metre of ground at the study's walking speeds, not at the pace the duration assumes. For a walker of ${REFERENCE_MASS.kg} kg (${REFERENCE_MASS.source}; scale linearly for another mass). An Earth model of unsuited walking; no published correction for a pressure suit or for Mars gravity is applied, so the figure is not a Mars measurement`
