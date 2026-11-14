import { describe, expect, it } from 'vitest'
import { derived } from '../../src/domain'
import type { GroundImagery } from '../../src/features/mars-3d/surfaceDetail'
import { GROUND_SPACING_M } from '../../src/features/mars-3d/surfaceView/groundPatch'
import { loadingLine, readyStatus, reliefNote, withLoaded, type GroundImageryStatus } from '../../src/features/mars-3d/surfaceView/groundStatus'

function mosaic(id: string, total: number): GroundImageryStatus {
  const imagery: GroundImagery = {
    detail: { layerId: id, maxZoom: 11, loadTile: async () => ({ status: 'empty' }), resolutionAt: () => derived('fixture', 'fixture') },
    tilePx: 256,
    coverage: null,
    classification: 'OFFICIAL',
    label: id,
    credit: 'fixture',
    caveat: 'fixture',
    licence: 'fixture',
  }
  return { imagery, zoom: 11, total, loaded: null }
}

describe('withLoaded', () => {
  it('settles one mosaic and leaves the others loading', () => {
    const ground = [mosaic('ctx', 40), mosaic('jezero-ctx', 120)]
    const first = withLoaded(ground, 0, 38)
    expect(first.map((g) => g.loaded)).toEqual([38, null])
    // The input is not changed: the caption state is replaced, never mutated.
    expect(ground.map((g) => g.loaded)).toEqual([null, null])
  })

  it('reaches the same state whichever mosaic settles first', () => {
    const ground = [mosaic('ctx', 40), mosaic('jezero-ctx', 120)]
    const a = withLoaded(withLoaded(ground, 1, 120), 0, 40)
    const b = withLoaded(withLoaded(ground, 0, 40), 1, 120)
    expect(a).toEqual(b)
    expect(a.map((g) => g.loaded)).toEqual([40, 120])
  })
})

describe('reliefNote', () => {
  it('states the mesh spacing the ground is actually drawn at', () => {
    expect(GROUND_SPACING_M).toBe(125)
    expect(reliefNote(GROUND_SPACING_M)).toContain('one point every 125 m')
  })

  it('says the photographs carry shapes the ground does not', () => {
    const note = reliefNote(GROUND_SPACING_M)
    expect(note).toMatch(/shadows in the photographs, not in the ground/)
    expect(note).toMatch(/cells of the height model named below/)
  })
})

describe('loadingLine', () => {
  const heights = { classification: 'OFFICIAL', text: 'fixture' } as const

  it('says the ground is loading while the heights are', () => {
    expect(loadingLine({ kind: 'loading' })).toBe('Loading the ground…')
  })

  it('says the pictures are loading once the heights are in and a mosaic has not settled', () => {
    const ground = [mosaic('ctx', 40), mosaic('jezero-ctx', 120)]
    expect(loadingLine(readyStatus(heights, ground, null))).toBe('Loading the pictures…')
    // One settled is not enough: the other still leaves the ground dark where it covers.
    expect(loadingLine(readyStatus(heights, withLoaded(ground, 0, 40), null))).toBe('Loading the pictures…')
  })

  it('says nothing once every mosaic has settled, even if some tiles did not draw', () => {
    const ground = withLoaded(withLoaded([mosaic('ctx', 40), mosaic('jezero-ctx', 120)], 0, 40), 1, 0)
    expect(loadingLine(readyStatus(heights, ground, null))).toBeNull()
  })

  it('says nothing with no ground mosaics (the layer alone, drawn at once), at the edge, or when unavailable', () => {
    expect(loadingLine(readyStatus(heights, [], null))).toBeNull()
    expect(loadingLine(readyStatus(heights, [], 'no heights there'))).toBeNull()
    expect(loadingLine({ kind: 'unavailable', reason: 'fixture' })).toBeNull()
  })
})
