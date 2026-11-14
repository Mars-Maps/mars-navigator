import { afterEach, describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM, type MarsCoordinate } from '../../src/domain'
import { interiorDiagonal, regionShapes, regionTriangles } from '../../src/features/mars-3d/regionGeometry'
import {
  MEASURE_TOOL_ID,
  nextTerrainPoints,
  TERRAIN_PROFILE_3D_TOOL_ID,
  TERRAIN_PROFILE_TOOL_ID,
  terrainPointLimit,
  toolTakesClicks,
  useTerrainPoints,
} from '../../src/state'
import { at } from './terrain.helpers'

// Fixture coordinates only: a few km apart near Jezero.
const A = at(0, 0)
const B = at(2, 0)
const C = at(2, 2)
const D = at(0, 2)
const E = at(1, 1)

describe('the profile tools take clicks', () => {
  it('Terrain Profile takes two points, Terrain Profile 3D four, other tools none', () => {
    expect(terrainPointLimit(TERRAIN_PROFILE_TOOL_ID)).toBe(2)
    expect(terrainPointLimit(TERRAIN_PROFILE_3D_TOOL_ID)).toBe(4)
    expect(terrainPointLimit(MEASURE_TOOL_ID)).toBeNull()
    expect(terrainPointLimit('flag')).toBeNull()
    expect(terrainPointLimit(null)).toBeNull()
  })

  it('a click sets a point for Measure and the two profile tools, not for others', () => {
    expect(toolTakesClicks(MEASURE_TOOL_ID)).toBe(true)
    expect(toolTakesClicks(TERRAIN_PROFILE_TOOL_ID)).toBe(true)
    expect(toolTakesClicks(TERRAIN_PROFILE_3D_TOOL_ID)).toBe(true)
    expect(toolTakesClicks('flag')).toBe(false)
    expect(toolTakesClicks(null)).toBe(false)
  })

  it('appends up to the limit, then a click past it starts over', () => {
    expect(nextTerrainPoints([], A, 2)).toEqual([A])
    expect(nextTerrainPoints([A], B, 2)).toEqual([A, B])
    expect(nextTerrainPoints([A, B], C, 2)).toEqual([C])
    expect(nextTerrainPoints([A, B, C], D, 4)).toEqual([A, B, C, D])
    expect(nextTerrainPoints([A, B, C, D], E, 4)).toEqual([E])
  })

  it('while a point is being changed, the click moves that one and the others stay', () => {
    expect(nextTerrainPoints([A, B, C, D], E, 4, 1)).toEqual([A, E, C, D])
    expect(nextTerrainPoints([A, B], E, 2, 0)).toEqual([E, B])
    // An index past the points is no point to move: the click appends as usual.
    expect(nextTerrainPoints([A, B], E, 4, 3)).toEqual([A, B, E])
  })
})

describe('the terrain points store', () => {
  afterEach(() => useTerrainPoints.getState().clearTerrainPoints())

  it('adds clicks in order and clears', () => {
    const { addTerrainPoint } = useTerrainPoints.getState()
    addTerrainPoint(A, 4)
    addTerrainPoint(B, 4)
    expect(useTerrainPoints.getState().points).toEqual([A, B])
    useTerrainPoints.getState().clearTerrainPoints()
    expect(useTerrainPoints.getState().points).toEqual([])
  })

  it('leaves an empty store as it is when cleared, so nothing re-renders', () => {
    const before = useTerrainPoints.getState()
    before.clearTerrainPoints()
    expect(useTerrainPoints.getState()).toBe(before)
  })

  it('the pencil arms a move, the same pencil again cancels it, the next click makes it, Clear forgets it', () => {
    const { addTerrainPoint, setReplacing } = useTerrainPoints.getState()
    addTerrainPoint(A, 4)
    addTerrainPoint(B, 4)
    setReplacing(0)
    expect(useTerrainPoints.getState().replacing).toBe(0)
    setReplacing(0)
    expect(useTerrainPoints.getState().replacing).toBeNull()
    setReplacing(1)
    addTerrainPoint(E, 4)
    expect(useTerrainPoints.getState().points).toEqual([A, E])
    expect(useTerrainPoints.getState().replacing).toBeNull()
    setReplacing(1)
    useTerrainPoints.getState().clearTerrainPoints()
    expect(useTerrainPoints.getState()).toMatchObject({ points: [], replacing: null })
  })
})

describe('regionShapes: what the globe draws while a profile tool takes clicks', () => {
  it('Terrain Profile: the line from A to the cursor, then from A to B', () => {
    expect(regionShapes(TERRAIN_PROFILE_TOOL_ID, [], E)).toEqual({ outline: [], region: null })
    expect(regionShapes(TERRAIN_PROFILE_TOOL_ID, [A], E)).toEqual({ outline: [A, E], region: null })
    expect(regionShapes(TERRAIN_PROFILE_TOOL_ID, [A], null)).toEqual({ outline: [], region: null })
    expect(regionShapes(TERRAIN_PROFILE_TOOL_ID, [A, B], E)).toEqual({ outline: [A, B], region: null })
  })

  it('Terrain Profile 3D: the outline follows the cursor; with three corners the sector to the cursor is filled; four close it', () => {
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [], E)).toEqual({ outline: [], region: null })
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A], E)).toEqual({ outline: [A, E], region: null })
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A, B], E)).toEqual({ outline: [A, B, E], region: null })
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A, B, C], null)).toEqual({ outline: [A, B, C], region: null })
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A, B, C], E)).toEqual({ outline: [A, B, C, E, A], region: [A, B, C, E] })
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A, B, C, D], E)).toEqual({ outline: [A, B, C, D, A], region: [A, B, C, D] })
  })

  it('while a point is being moved the cursor stands in for it, and is not also the next point', () => {
    expect(regionShapes(TERRAIN_PROFILE_TOOL_ID, [A, B], E, 1)).toEqual({ outline: [A, E], region: null })
    expect(regionShapes(TERRAIN_PROFILE_TOOL_ID, [A, B], null, 1)).toEqual({ outline: [A, B], region: null })
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A, B, C, D], E, 0)).toEqual({ outline: [E, B, C, D, E], region: [E, B, C, D] })
    // Three corners, moving the second: the cursor replaces it, no fourth is previewed.
    expect(regionShapes(TERRAIN_PROFILE_3D_TOOL_ID, [A, B, C], E, 1)).toEqual({ outline: [A, E, C], region: null })
  })

  it('draws nothing for other tools', () => {
    expect(regionShapes(MEASURE_TOOL_ID, [A, B, C], E)).toEqual({ outline: [], region: null })
    expect(regionShapes(null, [A, B, C, D], E)).toEqual({ outline: [], region: null })
  })
})

describe('regionGeometry', () => {
  const R = 1

  it('picks the interior diagonal: either for a convex square, the one past the notch for an arrowhead', () => {
    expect(interiorDiagonal([A, B, C, D])).toEqual([0, 2])
    // An arrowhead: corner 1 points back inside, so the diagonal 0–2 runs outside and 1–3 inside.
    const arrow: MarsCoordinate[] = [at(0, 0), at(0.5, 1), at(0, 2), at(2, 1)]
    expect(interiorDiagonal(arrow)).toEqual([1, 3])
    const arrow2: MarsCoordinate[] = [at(0.5, 1), at(0, 2), at(2, 1), at(0, 0)]
    expect(interiorDiagonal(arrow2)).toEqual([0, 2])
    // A region around the pole: the east axis is still defined, and a convex square there is split either way.
    const polar: MarsCoordinate[] = [
      { latitude: 89.5, longitudeEast: 0 },
      { latitude: 89.5, longitudeEast: 90 },
      { latitude: 89.5, longitudeEast: 180 },
      { latitude: 89.5, longitudeEast: 270 },
    ]
    expect(interiorDiagonal(polar)).toEqual([0, 2])
    expect(regionTriangles(polar, 1).every(Number.isFinite)).toBe(true)
  })

  it('fills three corners with one subdivided triangle and four with two, every vertex on the sphere', () => {
    // A few km across: one triangle is already within a metre of the sphere.
    const tri = regionTriangles([A, B, C], R)
    expect(tri.length).toBe(9)
    for (let i = 0; i < tri.length; i += 3) expect(Math.hypot(tri[i], tri[i + 1], tri[i + 2])).toBeCloseTo(R, 6)
    const quad = regionTriangles([A, B, C, D], R)
    expect(quad.length).toBe(2 * tri.length)
    expect(regionTriangles([A, B], R)).toHaveLength(0)
  })

  it('subdivides finer for a bigger region, within the cap', () => {
    const small = regionTriangles([A, B, C], R).length / 9
    const big = regionTriangles([{ latitude: 0, longitudeEast: 0 }, { latitude: 0, longitudeEast: 20 }, { latitude: 20, longitudeEast: 0 }], R).length / 9
    expect(big).toBeGreaterThan(small)
    expect(big).toBe(24 * 24)
    expect(MARS_MEAN_RADIUS_KM).toBeGreaterThan(0)
  })
})
