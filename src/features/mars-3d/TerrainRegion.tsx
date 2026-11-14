import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, type Group } from 'three'
import { terrainPointLimit, useMissionStore, useTerrainPoints, useUnitHover } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { TERRAIN_POINT_COLOR } from './pinColors'
import { regionShapes, regionTriangles } from './regionGeometry'
import { greatCirclePath } from './routeGeometry'
import { useOverlayLift } from './useOverlayLift'

/** The fill just above the grid (1.001) and under the pins; the outline above the fill. */
const FILL_LIFT = 1.0025
const LINE_LIFT = 1.003
const FILL_OPACITY = 0.3

/** Neither answers a pick: clicks reach the globe underneath and set the next point. */
function noRaycast() {}

/**
 * What the profile tools draw on the globe while they take clicks:
 * the Terrain Profile's line from A to B, and the Terrain Profile
 * 3D's region. The region grows with the clicks: an outline through the
 * corners set so far that follows the cursor to the next one, and once
 * three corners are set a translucent fill between them and the cursor,
 * so the user sees the sector before the fourth click; with four corners
 * the outline closes and the fill stays. Mount inside the globe mesh.
 *
 * The line, the mesh and their materials are created once and disposed on
 * unmount; the geometries are replaced, and the old ones disposed, whenever
 * the points or the followed cursor change.
 */
export function TerrainRegion() {
  const points = useTerrainPoints((s) => s.points)
  const replacing = useTerrainPoints((s) => s.replacing)
  const tool = useMissionStore((s) => s.activeToolId)
  // The fine cursor (`useUnitHover`, three decimals, written while a profile
  // tool is active): the preview ends where the click lands, not at the
  // readout's one decimal. Read only while the cursor changes the shapes, so
  // a finished region, or another tool, costs no rebuild per move.
  const limit = terrainPointLimit(tool)
  const follows = limit !== null && (points.length < limit || (replacing !== null && replacing < points.length))
  const hover = useUnitHover((s) => (follows ? s.at : null))
  const groupRef = useRef<Group>(null)
  const lineRef = useRef<Line<BufferGeometry, LineBasicMaterial> | null>(null)
  const fillRef = useRef<Mesh<BufferGeometry, MeshBasicMaterial> | null>(null)
  // Each at its own lift, so the outline stays above the fill at every altitude.
  useOverlayLift(lineRef, LINE_LIFT)
  useOverlayLift(fillRef, FILL_LIFT)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: TERRAIN_POINT_COLOR }))
    line.raycast = noRaycast
    line.renderOrder = 2
    const fill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ color: TERRAIN_POINT_COLOR, transparent: true, opacity: FILL_OPACITY, depthWrite: false, side: DoubleSide }),
    )
    fill.raycast = noRaycast
    fill.renderOrder = 1
    lineRef.current = line
    fillRef.current = fill
    group.add(fill, line)
    return () => {
      group.remove(fill, line)
      line.geometry.dispose()
      line.material.dispose()
      fill.geometry.dispose()
      fill.material.dispose()
      lineRef.current = null
      fillRef.current = null
    }
  }, [])

  useEffect(() => {
    const line = lineRef.current
    const fill = fillRef.current
    if (!line || !fill) return
    const { outline, region } = regionShapes(tool, points, hover, replacing)
    const lineGeometry = new BufferGeometry()
    if (outline.length >= 2) lineGeometry.setAttribute('position', new BufferAttribute(greatCirclePath(outline, GLOBE_RADIUS * LINE_LIFT), 3))
    const fillGeometry = new BufferGeometry()
    if (region) fillGeometry.setAttribute('position', new BufferAttribute(regionTriangles(region, GLOBE_RADIUS * FILL_LIFT), 3))
    const oldLine = line.geometry
    const oldFill = fill.geometry
    line.geometry = lineGeometry
    fill.geometry = fillGeometry
    oldLine.dispose()
    oldFill.dispose()
  }, [tool, points, hover, replacing])

  return <group ref={groupRef} />
}
