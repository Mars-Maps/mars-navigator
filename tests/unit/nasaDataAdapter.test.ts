import { describe, expect, it } from 'vitest'
import {
  AdapterNotImplementedError,
  AdapterValidationError,
  type DataAdapter,
} from '../../src/data/adapters/DataAdapter'
import {
  DATASET_FACTS,
  NASADataAdapter,
  readCoordinate,
  readOfficialNumber,
  unknownFacts,
  type DatasetFacts,
} from '../../src/data/adapters/NASADataAdapter'

// Test-only facts. They describe no real dataset.
const KNOWN: DatasetFacts = {
  ...DATASET_FACTS,
  longitudeConvention: 'east-180',
  missingValueMarkers: [null, -9999],
}

describe('NASADataAdapter', () => {
  it('is a DataAdapter constructed with no arguments, so the swap is one line', () => {
    const adapter: DataAdapter = new NASADataAdapter()
    expect(adapter.id).toBe('nasa')
  })

  it('rejects load() with a not-implemented error naming every unverified fact', async () => {
    const error = await new NASADataAdapter().load().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AdapterNotImplementedError)
    const message = (error as Error).message
    for (const fact of unknownFacts(DATASET_FACTS)) {
      expect(message).toContain(fact)
    }
  })

  it('starts with every fact unknown', () => {
    expect(unknownFacts(DATASET_FACTS)).toEqual(Object.keys(DATASET_FACTS))
    expect(unknownFacts(DATASET_FACTS)).toHaveLength(13)
  })
})

describe('readCoordinate', () => {
  it('refuses to run before the longitude convention is verified', () => {
    expect(() => readCoordinate(DATASET_FACTS, 'r1', 0, 0)).toThrow(AdapterNotImplementedError)
  })

  it('converts with the verified convention', () => {
    expect(readCoordinate(KNOWN, 'r1', 4.5, -137.4).longitudeEast).toBeCloseTo(222.6, 9)
  })

  it.each([
    ['out-of-range longitude', 4.5, 200],
    ['out-of-range latitude', 91, 0],
    ['numeric string', '4.5', 0],
    ['missing', undefined, 0],
    ['NaN', Number.NaN, 0],
  ])('rejects a %s, never coerces', (_label, lat, lon) => {
    expect(() => readCoordinate(KNOWN, 'r1', lat, lon)).toThrow(AdapterValidationError)
  })
})

describe('readOfficialNumber', () => {
  it('refuses to run before the missing-value encoding is verified', () => {
    expect(() => readOfficialNumber(DATASET_FACTS, 'r1', 'f', 1, 's')).toThrow(
      AdapterNotImplementedError,
    )
  })

  it.each([null, -9999, undefined])('turns missing marker %s into UNAVAILABLE, not 0', (raw) => {
    expect(readOfficialNumber(KNOWN, 'r1', 'f', raw, 's').classification).toBe('UNAVAILABLE')
  })

  it('keeps 0 as a real value when 0 is not a missing marker', () => {
    expect(readOfficialNumber(KNOWN, 'r1', 'f', 0, 's')).toEqual({
      classification: 'OFFICIAL',
      value: 0,
      source: 's',
    })
  })

  it.each(['12', '', Number.POSITIVE_INFINITY, {}])('rejects %s rather than coercing', (raw) => {
    expect(() => readOfficialNumber(KNOWN, 'r1', 'f', raw, 's')).toThrow(AdapterValidationError)
  })
})
