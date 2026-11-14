import {
  isAvailable,
  isShieldingWarning,
  radiationLevel,
  type RadiationLevel,
  unavailable,
  type Classified,
  type Hazard,
  type RadiationHazard,
} from '../../../domain'

/**
 * The radiation warning's maths: which hazards are radiation ones,
 * when the atmosphere overhead is thin enough to warn, and the words. Pure,
 * so a test can hold every place the warning shows to one rule: it is
 * about shielding, never "higher dose", never a number of mSv.
 *
 * The shielding `f` is the column of atmosphere overhead as a fraction of
 * Gale's, where the only surface dose was measured. It comes in
 * from outside; nothing here computes it. The threshold and the words are
 * the domain's (src/domain/radiation.ts), not this file's.
 */

/**
 * No dataset gives a surface dose per coordinate, so radiation per coordinate
 * stays UNAVAILABLE. The one measurement (Curiosity RAD at Gale) is shown
 * beside this field as a reference, never scaled to the point.
 */
export const NO_RADIATION_REASON =
  'No global surface radiation map exists. The one surface measurement is Curiosity RAD at Gale crater, shown as a reference; Perseverance carries no dosimeter, and no scaling by elevation is published, so the Gale value is not scaled to this point'

export const NO_SHIELDING_REASON =
  'No elevation at this point yet. The atmosphere overhead is derived from the elevation against Gale'

export interface RadiationReading {
  /** Always UNAVAILABLE: no dose is ever stated at a point. */
  dose: Classified<number>
  /** The atmosphere overhead, as a fraction of Gale's. */
  shielding: Classified<number>
  /** Under the threshold. False while the shielding is unknown: no warning is guessed. */
  warn: boolean
  /** LOW / MEDIUM / HIGH on the same fraction; null while the shielding is unknown. */
  level: RadiationLevel | null
}

export function readRadiation(shielding: Classified<number> | null): RadiationReading {
  const s =
    shielding === null
      ? unavailable<number>(NO_SHIELDING_REASON)
      : isAvailable(shielding) && !Number.isFinite(shielding.value)
        ? unavailable<number>('The shielding calculation returned no finite value here')
        : shielding
  return {
    dose: unavailable(NO_RADIATION_REASON),
    shielding: s,
    warn: isAvailable(s) && isShieldingWarning(s.value),
    level: isAvailable(s) ? radiationLevel(s.value) : null,
  }
}

/**
 * "0.79 of Gale's". Two decimals: one would read 0.79, which warns, and the 0.80 line as the same.
 * Rounded down, so a value under the line never reads 0.80 beneath its warning. The 1e-9 keeps an
 * exact value whole: 0.29 * 100 is 28.999… in floating point and would floor to 0.28.
 */
export function formatShielding(f: number): string {
  return `${(Math.floor(f * 100 + 1e-9) / 100).toFixed(2)} of Gale's`
}

/** The radiation hazards in a scanned list; none while it is UNAVAILABLE (not yet scanned). */
export function radiationHazards(hazards: Classified<Hazard[]>): RadiationHazard[] {
  return isAvailable(hazards) ? hazards.value.filter((h): h is RadiationHazard => h.kind === 'radiation') : []
}
