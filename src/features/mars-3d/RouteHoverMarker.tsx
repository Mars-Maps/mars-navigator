import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Vector3,
  type Group,
} from 'three'
import type { MarsCoordinate } from '../../domain'
import { useRouteHover } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { ROUTE_LIFT } from './overlayLift'
import { coordinateToLocalPoint } from './projection'

/** As the route's dots (RouteOverlay), so the marker sits on the line. */
const LIFT = ROUTE_LIFT
/** Across, in CSS pixels: larger than the route's dots, so it reads against them. */
const MARKER_PX = 14
/** The sprite's own size; drawn smaller, so its edge stays smooth. */
const TEXTURE_PX = 64
/** Over the trail (2) and the pins (3), so it is never buried. */
const RENDER_ORDER = 4

/** The marker never answers a pick: right-click reaches the globe underneath. */
function noRaycast() {}

/** A white dot with a dark rim, as the route's dots are, readable on every layer. */
function createMarkerTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_PX
  canvas.height = TEXTURE_PX
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const c = TEXTURE_PX / 2
    ctx.beginPath()
    ctx.arc(c, c, c * 0.72, 0, Math.PI * 2)
    ctx.lineWidth = c * 0.32
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Puts the marker at `coordinate`, or hides it for null. Writes the one vertex
 * in place, so moving along the chart allocates nothing but the scratch the
 * caller keeps. The vertex is what the renderer draws, so it needs no matrix.
 */
export function placeRouteHoverMarker(
  marker: Points<BufferGeometry>,
  coordinate: MarsCoordinate | null,
  scratch: Vector3,
): void {
  marker.visible = coordinate !== null
  if (coordinate === null) return
  coordinateToLocalPoint(coordinate, GLOBE_RADIUS * LIFT, scratch)
  const position = marker.geometry.getAttribute('position') as BufferAttribute
  position.setXYZ(0, scratch.x, scratch.y, scratch.z)
  position.needsUpdate = true
}

/**
 * The point of the route under the navigation elevation chart's pointer:
 * one marker on the route line, so the chart and
 * the line are read together. Mount inside the globe mesh, as RouteOverlay
 * does. The store's own subscription moves it, so the chart's pointer causes
 * no React render here. The chart clears the point when the pointer leaves and
 * when it unmounts, which ending navigation does, and null draws nothing. Depth
 * testing against the globe hides it over the horizon. One geometry, material
 * and texture, created once and disposed on unmount.
 */
export function RouteHoverMarker() {
  const groupRef = useRef<Group>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    const texture = createMarkerTexture()
    const material = new PointsMaterial({
      map: texture,
      size: MARKER_PX,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
    })
    const marker = new Points(geometry, material)
    marker.raycast = noRaycast
    marker.renderOrder = RENDER_ORDER
    marker.frustumCulled = false
    group.add(marker)

    const scratch = new Vector3()
    const place = (coordinate: MarsCoordinate | null) => placeRouteHoverMarker(marker, coordinate, scratch)
    place(useRouteHover.getState().hoveredRoutePoint?.coordinate ?? null)
    const unsubscribe = useRouteHover.subscribe((s) => place(s.hoveredRoutePoint?.coordinate ?? null))
    return () => {
      unsubscribe()
      group.remove(marker)
      geometry.dispose()
      material.dispose()
      texture.dispose()
    }
  }, [])

  return <group ref={groupRef} />
}
