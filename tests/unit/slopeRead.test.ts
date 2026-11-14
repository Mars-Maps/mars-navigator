import { describe, expect, it } from 'vitest'
import { official, unavailable, type Classified, type MarsCoordinate } from '../../src/domain'
import type { HeightModel, SourcedHeights } from '../../src/data/adapters/LayeredElevation'
import { initialSpacingKm, NO_SLOPE_NEAR_POLE_REASON } from '../../src/features/route-analysis/pointSlope'
import { readSlope, SLOPE_DID_NOT_SETTLE_REASON, type SlopeHeights } from '../../src/app/slopeRead'

// Test fixtures only: an invented chain, never shown in the app.
const MODELS: HeightModel[] = [
  { label: 'fixture fine site model', source: 'fixture fine site model', cellKm: 0.02, site: true },
  { label: 'fixture global model', source: 'fixture global model', cellKm: 0.2, site: false },
]
const JEZERO: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const never = new AbortController().signal

/** A chain whose reads answer, in order, from the model at each index of `answers`; the last repeats. */
function chain(answers: readonly (number | 'fail')[], cellKm = MODELS[0].cellKm) {
  const spacings: number[] = []
  const fake: SlopeHeights = {
    cellKmAlong: () => cellKm,
    noDataReason: 'fixture: no model has data here',
    elevationsAt: async (points): Promise<Classified<SourcedHeights>> => {
      // Centre to east neighbour, in km: the spacing this read was asked at.
      const dLon = points[11] - points[9]
      spacings.push(dLon)
      const k = answers[Math.min(spacings.length - 1, answers.length - 1)]
      if (k === 'fail') return unavailable('fixture: the model could not be read')
      const heights = new Float32Array(9).fill(-2500)
      heights[5] = -2490 // a rise to the east, so a slope is never 0 by accident
      return official({ heights, sourceIndex: new Uint8Array(9).fill(k), sources: MODELS }, 'fixture chain')
    },
  }
  return { fake, spacings }
}

describe('readSlope', () => {
  it('reads once when the finest model answers at the spacing set for it', async () => {
    const { fake, spacings } = chain([0])
    const slope = await readSlope(JEZERO, never, fake)
    expect(spacings).toHaveLength(1)
    expect(slope.classification).toBe('DERIVED')
    expect(slope.classification === 'DERIVED' && slope.method).toContain('fixture fine site model')
  })

  it('reads again wider when a coarser model answered, then settles', async () => {
    const { fake, spacings } = chain([1])
    const slope = await readSlope(JEZERO, never, fake)
    expect(spacings).toHaveLength(2)
    expect(spacings[1]).toBeGreaterThan(spacings[0])
    expect(slope.classification).toBe('DERIVED')
    expect(slope.classification === 'DERIVED' && slope.method).toContain('400 m apart')
    expect(slope.classification === 'DERIVED' && slope.method).toContain('fixture global model')
  })

  it('gives up, UNAVAILABLE, after one wider read per model if the answers never settle', async () => {
    // A chain that always answers from a model coarser than the spacing it was asked at:
    // impossible in practice, so the loop must still end on its own.
    let reads = 0
    const unsettled: SlopeHeights = {
      ...chain([1]).fake,
      elevationsAt: async (points) => {
        reads++
        const kmPerDegLat = (3389.5 * Math.PI) / 180
        const askedKm = (points[2] - points[8]) * kmPerDegLat
        return official(
          {
            heights: new Float32Array(9).fill(-2500),
            sourceIndex: new Uint8Array(9).fill(1),
            sources: [MODELS[0], { ...MODELS[1], cellKm: askedKm * 10 }],
          },
          'fixture chain',
        )
      },
    }
    expect(await readSlope(JEZERO, never, unsettled)).toEqual({
      classification: 'UNAVAILABLE',
      reason: SLOPE_DID_NOT_SETTLE_REASON,
    })
    expect(reads).toBe(MODELS.length + 1)
  })

  it("passes the chain's own failure through, and refuses a point near a pole without reading", async () => {
    expect(await readSlope(JEZERO, never, chain(['fail']).fake)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'fixture: the model could not be read',
    })
    const { fake, spacings } = chain([0])
    expect(await readSlope({ latitude: 88, longitudeEast: 10 }, never, fake)).toEqual({
      classification: 'UNAVAILABLE',
      reason: NO_SLOPE_NEAR_POLE_REASON,
    })
    expect(spacings).toHaveLength(0)
  })

  it('starts at two cells of the finest model whose grid holds the point', async () => {
    const { fake, spacings } = chain([0], 0.2)
    await readSlope(JEZERO, never, fake)
    const kmPerDegLon = ((3389.5 * Math.PI) / 180) * Math.cos((JEZERO.latitude * Math.PI) / 180)
    expect(spacings[0] * kmPerDegLon).toBeCloseTo(initialSpacingKm(0.2), 6)
  })
})
