import {
  RADIATION_HAZARD_UNIT,
  SHIELDING_METHOD,
  SHIELDING_WARNING_BASIS,
  SHIELDING_WARNING_FRACTION,
  SHIELDING_WARNING_TEXT,
  columnMassFraction,
  derived,
  isShieldingWarning,
  unavailable,
  type MarsCoordinate,
  type RadiationHazard,
} from '../../domain'
import type { ProfilePoint } from './elevationProfile'

/**
 * The radiation warning along a walk leg: where the leg climbs high
 * enough that the atmosphere overhead is under the warning fraction of
 * Gale's column. A shielding warning, never a dose.
 *
 * Per point, the shell already derives the fraction from the selected
 * point's height (`shieldingFromElevation`); this is the per-leg scan.
 */

const radiationId = (idBase: string, n: number) => `${idBase}-radiation-${n}`

/**
 * Radiation hazards along one leg's samples, heights in metres (not finite
 * for none). Each run of consecutive samples under the warning fraction is one
 * hazard, at the run's highest sample, its magnitude the fraction there, naming
 * the source of that sample's height: two models can differ by enough to decide
 * whether a warning appears (`LayeredElevation`).
 * Each run of samples with no height is one hazard whose magnitude is
 * UNAVAILABLE, "not checked", so a leg with gaps never reads as all clear.
 */
export function legShieldingHazards(
  samples: readonly ProfilePoint[],
  heights: ArrayLike<number>,
  idBase: string,
  sourceAt: (sample: number) => string,
  /** What the samples run along, for the hazard's words: a walk leg, or a route. */
  along = 'the leg',
): RadiationHazard[] {
  type Run = { kind: 'low' | 'gap'; from: number; to: number; top: number }
  const runs: Run[] = []
  for (let i = 0; i < samples.length; i++) {
    const h = heights[i]
    const kind = !Number.isFinite(h) ? 'gap' : isShieldingWarning(columnMassFraction(h)) ? 'low' : null
    const last = runs.at(-1)
    if (kind === null) continue
    if (last !== undefined && last.kind === kind && last.to === i - 1) {
      last.to = i
      if (kind === 'low' && h > heights[last.top]) last.top = i
    } else {
      runs.push({ kind, from: i, to: i, top: i })
    }
  }

  return runs.map((run, n): RadiationHazard => {
    const where =
      run.from === run.to
        ? `at ${describeKm(samples[run.from].distanceKm)} along ${along}`
        : `from ${describeKm(samples[run.from].distanceKm)} to ${describeKm(samples[run.to].distanceKm)} along ${along}`
    const base: Pick<RadiationHazard, 'id' | 'kind' | 'unit'> = {
      id: radiationId(idBase, n + 1),
      kind: 'radiation',
      unit: RADIATION_HAZARD_UNIT,
    }
    if (run.kind === 'gap') {
      return {
        ...base,
        coordinate: samples[run.from].coordinate,
        magnitude: unavailable(`No height ${where}, so the shielding there was not checked`),
      }
    }
    const top = heights[run.top]
    return {
      ...base,
      coordinate: samples[run.top].coordinate,
      magnitude: derived(
        columnMassFraction(top),
        `${SHIELDING_WARNING_TEXT}. Under ${SHIELDING_WARNING_FRACTION} of Gale's column ${where}; this is its highest sample, ${formatMetres(top)} m. ${SHIELDING_WARNING_BASIS}. ${SHIELDING_METHOD}. Heights: ${sourceAt(run.top)}`,
      ),
    }
  })
}

/** A leg whose heights could not be read at all: the shielding is not known, for the read's own reason. */
export function shieldingNotChecked(coordinate: MarsCoordinate, idBase: string, reason: string): RadiationHazard {
  return {
    id: radiationId(idBase, 1),
    kind: 'radiation',
    unit: RADIATION_HAZARD_UNIT,
    coordinate,
    magnitude: unavailable(`The shielding was not checked: ${reason}`),
  }
}

/** "−1500": a true minus, as the domain and the UI write heights. */
function formatMetres(m: number): string {
  const whole = Math.round(m)
  return `${whole < 0 ? '−' : ''}${Math.abs(whole)}`
}

function describeKm(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`
  if (km >= 1) return `${km.toFixed(1)} km`
  return `${(km * 1000).toFixed(0)} m`
}
