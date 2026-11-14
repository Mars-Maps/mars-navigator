/**
 * Scientific honesty is a hard rule in this project:
 * a value must always say where it came from, and "we do not know" must be
 * representable. These types make that impossible to forget — you cannot read
 * a number without first dealing with the case where it does not exist.
 */

export type DataClassification =
  /** Directly from an official source dataset. */
  | 'OFFICIAL'
  /** Calculated from other data. Must state the method. */
  | 'DERIVED'
  /** Invented for development or demonstration. Must be visibly labeled. */
  | 'SIMULATED'
  /** Genuinely not known. Never substitute 0, null-as-zero or a guess. */
  | 'UNAVAILABLE'

export type Classified<T> =
  | { classification: 'OFFICIAL'; value: T; source: string }
  | { classification: 'SIMULATED'; value: T; source: string }
  | { classification: 'DERIVED'; value: T; method: string }
  | { classification: 'UNAVAILABLE'; reason: string }

/** Narrows to the cases that actually carry a value. */
export function isAvailable<T>(
  v: Classified<T>,
): v is Extract<Classified<T>, { value: T }> {
  return v.classification !== 'UNAVAILABLE'
}

/** For display. Never returns a fabricated number. */
export function valueOr<T, F>(v: Classified<T>, fallback: F): T | F {
  return isAvailable(v) ? v.value : fallback
}

export const official = <T>(value: T, source: string): Classified<T> => ({
  classification: 'OFFICIAL',
  value,
  source,
})

export const simulated = <T>(value: T, source: string): Classified<T> => ({
  classification: 'SIMULATED',
  value,
  source,
})

export const derived = <T>(value: T, method: string): Classified<T> => ({
  classification: 'DERIVED',
  value,
  method,
})

export const unavailable = <T>(reason: string): Classified<T> => ({
  classification: 'UNAVAILABLE',
  reason,
})
