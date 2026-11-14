import type { MarsDataset } from '../../domain'

/**
 * The single contract between the outside world and this application.
 *
 * Every external format gets its own adapter. Nothing above this layer knows
 * whether data came from a mock array, a JSON file, a CSV or a NASA API — so
 * a new dataset needs only a new adapter.
 */
export interface DataAdapter {
  /** Stable identifier, e.g. 'mock', 'nasa-json'. */
  readonly id: string
  /** Human-readable, for the UI. */
  readonly label: string
  load(): Promise<MarsDataset>
}

/** Thrown when external data cannot be trusted. Never coerce silently. */
export class AdapterValidationError extends Error {
  readonly adapterId: string

  constructor(adapterId: string, message: string) {
    super(`[${adapterId}] ${message}`)
    this.name = 'AdapterValidationError'
    this.adapterId = adapterId
  }
}

/**
 * Thrown when an adapter is asked for something it cannot do yet because a
 * fact about its source has not been verified. Not a data error: the data was
 * never read.
 */
export class AdapterNotImplementedError extends Error {
  readonly adapterId: string

  constructor(adapterId: string, message: string) {
    super(`[${adapterId}] ${message}`)
    this.name = 'AdapterNotImplementedError'
    this.adapterId = adapterId
  }
}
