import {
  official,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MarsDataset,
} from '../../domain'
import { toMarsCoordinate, type LongitudeConvention } from './coordinates'
import {
  AdapterNotImplementedError,
  AdapterValidationError,
  type DataAdapter,
} from './DataAdapter'

const ADAPTER_ID = 'nasa'

/**
 * What must be known about an official dataset before this adapter can read
 * it. Every entry is null until a person has checked it against the
 * dataset's documentation. Fill in only verified facts; a null is honest, a
 * guess is not.
 *
 * Deliberately absent: any field name, column name or file shape from the
 * dataset. Those are unknown and are not guessed here.
 */
export interface DatasetFacts {
  /** Where it comes from and how: download URL or API endpoint. */
  source: string | null
  /** File format(s), e.g. as stated by the dataset documentation. */
  format: string | null
  /** Total size, to decide whether it can be committed or must be fetched. */
  size: string | null
  /** Coordinate system / reference frame (planetocentric? IAU 2000?). */
  referenceFrame: string | null
  /** Latitude convention; coordinates.ts assumes planetocentric. */
  latitudeConvention: string | null
  /** How longitude is written. The coordinate step refuses to run without it. */
  longitudeConvention: LongitudeConvention | null
  /** Units for every numeric field, as the documentation states them. */
  units: string | null
  /** Sol, Earth UTC, mission elapsed time, or a mix. */
  timeRepresentation: string | null
  /** Mission / rover / instrument identifiers present. */
  identifiers: string | null
  /** Whether elevation is present, and against which datum. */
  elevation: string | null
  /**
   * The exact raw values that mean "missing" (null, -9999, '', …). An absent
   * key is always treated as missing. The value step refuses to run without it.
   */
  missingValueMarkers: readonly unknown[] | null
  /** Scientific limitations or caveats NASA states. */
  caveats: string | null
  /** Licence, and whether the data may be committed to the repo. */
  licence: string | null
}

/** Nothing is known yet. Edit this with a source for each fact. */
export const DATASET_FACTS: DatasetFacts = {
  source: null,
  format: null,
  size: null,
  referenceFrame: null,
  latitudeConvention: null,
  longitudeConvention: null,
  units: null,
  timeRepresentation: null,
  identifiers: null,
  elevation: null,
  missingValueMarkers: null,
  caveats: null,
  licence: null,
}

/** The facts still null, in checklist order. */
export function unknownFacts(facts: DatasetFacts): (keyof DatasetFacts)[] {
  return (Object.keys(facts) as (keyof DatasetFacts)[]).filter((key) => facts[key] === null)
}

/**
 * Validation step: a source latitude/longitude → MarsCoordinate in the
 * project convention. Rejects, never wraps or clamps. Refuses to run until
 * the longitude convention is verified, rather than defaulting to one.
 */
export function readCoordinate(
  facts: DatasetFacts,
  recordId: string,
  latitude: unknown,
  longitude: unknown,
): MarsCoordinate {
  if (facts.longitudeConvention === null) {
    throw new AdapterNotImplementedError(
      ADAPTER_ID,
      'Longitude convention not verified yet',
    )
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new AdapterValidationError(
      ADAPTER_ID,
      `Record ${recordId}: coordinate is not numeric (lat=${String(latitude)}, lon=${String(longitude)})`,
    )
  }
  const result = toMarsCoordinate(latitude, longitude, facts.longitudeConvention)
  if (!result.ok) {
    throw new AdapterValidationError(
      ADAPTER_ID,
      `Record ${recordId} has an invalid coordinate (${result.reason}): lat=${latitude}, lon=${longitude}`,
    )
  }
  return result.coordinate
}

/**
 * Validation step: one raw numeric value → Classified<number>. A missing
 * marker becomes UNAVAILABLE — never 0, never interpolated. Anything else that
 * is not a finite number is rejected: a numeric string is not coerced.
 * Refuses to run until the missing-value encoding is verified.
 */
export function readOfficialNumber(
  facts: DatasetFacts,
  recordId: string,
  field: string,
  raw: unknown,
  source: string,
): Classified<number> {
  if (facts.missingValueMarkers === null) {
    throw new AdapterNotImplementedError(
      ADAPTER_ID,
      'Missing-value encoding not verified yet',
    )
  }
  if (raw === undefined || facts.missingValueMarkers.some((marker) => Object.is(marker, raw))) {
    return unavailable(`Missing in the source record (${field})`)
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new AdapterValidationError(
      ADAPTER_ID,
      `Record ${recordId}: ${field} is not a finite number (${String(raw)})`,
    )
  }
  return official(raw, source)
}

/**
 * The adapter the official NASA dataset will fill, behind the same interface
 * as MockDataAdapter, so swapping it in at the composition root
 * (src/app/App.tsx) is one line. Until the facts above are verified it reads
 * nothing and says so: `load()` rejects with the list of what is unknown.
 */
export class NASADataAdapter implements DataAdapter {
  readonly id = ADAPTER_ID
  readonly label = 'NASA dataset (not released yet)'

  private readonly facts: DatasetFacts

  constructor(facts: DatasetFacts = DATASET_FACTS) {
    this.facts = facts
  }

  async load(): Promise<MarsDataset> {
    const unknown = unknownFacts(this.facts)
    throw new AdapterNotImplementedError(
      ADAPTER_ID,
      'Not implemented: no official dataset has been wired to this adapter. ' +
        (unknown.length > 0
          ? `Unverified facts: ${unknown.join(', ')}.`
          : 'All facts verified; the parser is not written yet.'),
    )
  }
}
