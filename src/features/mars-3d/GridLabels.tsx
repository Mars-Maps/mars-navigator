import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Vector3, type Mesh } from 'three'
import type { MarsCoordinate } from '../../domain'
import { useMissionStore } from '../../state'
import { CAMERA_FOV_DEG, GLOBE_RADIUS } from './constants'
import type { GridLabelBridge } from './gridLabelBridge'
import { emptyGridLabelView, gridLabels, planGridLabels, sameLabelledLines, type GridLabel } from './gridLabelPlan'
import { coordinateToLocalPoint, localPointToCoordinate } from './projection'
import { labelPixel } from './SiteLabel'

/** Labels sit on the lines, which are lifted this much (CoordinateGrid). */
const LIFT = 1.001
/** A label this close to the canvas edge would be cut off, CSS pixels. */
const EDGE_PX = 16
/** Labels this near the horizon lie along the limb on top of each other: cosine of the view angle. */
const MIN_FACING = 0.15

/**
 * The coordinate grid's degree numbers, while the grid is on: HTML
 * text over the canvas, as the site's name is (SiteLabel), so it stays crisp
 * at any zoom and needs no GPU resource. The scene moves each element every
 * frame through the bridge; React renders here only when the set of
 * labelled lines changes. The elements never take pointer events.
 */
export function GridLabels({ bridge }: { bridge: GridLabelBridge }) {
  const visible = useMissionStore((s) => s.gridVisible)
  const [labels, setLabels] = useState<readonly GridLabel[]>([])

  useEffect(() => bridge.connect(setLabels), [bridge])

  if (!visible) return null
  return (
    <div aria-hidden="true">
      {labels.map(({ key, text }) => (
        <div
          key={key}
          ref={(el) => (el ? bridge.attach(key, el) : undefined)}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-caption tabular-nums text-ink [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]"
          style={{ visibility: 'hidden' }}
        >
          {text}
        </div>
      ))}
    </div>
  )
}

/** Per-element memory of what was last written, so a settled scene writes nothing. */
interface Written {
  el: HTMLDivElement | null
  /** Null until written: an element that moved place in the set may already be showing. */
  shown: boolean | null
  x: number
  y: number
}

/** Runs inside the Canvas and places the GridLabels elements each frame. */
export function GridLabelTracker({
  globe,
  bridge,
}: {
  globe: RefObject<Mesh | null>
  bridge: GridLabelBridge
}) {
  const visible = useMissionStore((s) => s.gridVisible)
  // Reused every frame: nothing here is allocated once the scene settles.
  const scratch = useRef({
    camLocal: new Vector3(),
    world: new Vector3(),
    toCamera: new Vector3(),
    point: { latitude: 0, longitudeEast: 0 } as MarsCoordinate,
    cam: { centre: { latitude: 0, longitudeEast: 0 }, distanceRadii: 0, widthPx: 0, heightPx: 0, fovDeg: CAMERA_FOV_DEG },
    view: emptyGridLabelView(),
    labelled: emptyGridLabelView(),
    written: [] as Written[],
  })

  useFrame(({ camera, size }) => {
    const mesh = globe.current
    const s = scratch.current
    if (!visible || !mesh || !bridge.connected) return

    // The point under the camera, in the globe's own (spinning, tilted) frame.
    mesh.worldToLocal(s.camLocal.copy(camera.position))
    const distance = s.camLocal.length()
    localPointToCoordinate(s.camLocal, distance, s.cam.centre)
    s.cam.distanceRadii = distance / GLOBE_RADIUS
    s.cam.widthPx = size.width
    s.cam.heightPx = size.height
    planGridLabels(s.cam, s.view)

    if (!sameLabelledLines(s.view, s.labelled) || bridge.needsLabels) {
      Object.assign(s.labelled, s.view)
      bridge.publish(gridLabels(s.view))
    }

    // As SiteLabel: the camera moved earlier this frame.
    camera.updateMatrixWorld()
    const labels = bridge.labels
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]
      const el = bridge.element(label.key)
      let w = s.written[i]
      if (!w) w = s.written[i] = { el: null, shown: null, x: NaN, y: NaN }
      if (w.el !== el) {
        w.el = el
        w.shown = null
        w.x = NaN
        w.y = NaN
      }
      if (!el) continue

      if (label.kind === 'latitude') {
        s.point.latitude = label.deg
        s.point.longitudeEast = s.view.lonAnchor
      } else {
        s.point.latitude = s.view.latAnchor
        s.point.longitudeEast = label.deg
      }
      mesh.localToWorld(coordinateToLocalPoint(s.point, GLOBE_RADIUS * LIFT, s.world))
      s.toCamera.copy(camera.position).sub(s.world)
      // The globe is centred at the world origin, so the point is its own normal.
      const facing = s.toCamera.dot(s.world) / (s.toCamera.length() * s.world.length())
      let shown = facing > MIN_FACING
      if (shown) {
        s.toCamera.copy(s.world).project(camera)
        const x = labelPixel(((s.toCamera.x + 1) / 2) * size.width)
        const y = labelPixel(((1 - s.toCamera.y) / 2) * size.height)
        shown = x > EDGE_PX && x < size.width - EDGE_PX && y > EDGE_PX && y < size.height - EDGE_PX
        if (shown && (x !== w.x || y !== w.y)) {
          w.x = x
          w.y = y
          // Latitude: centred just above its parallel. Longitude: just right of its meridian.
          el.style.transform =
            label.kind === 'latitude'
              ? `translate(${x}px, ${y}px) translate(-50%, -100%)`
              : `translate(${x}px, ${y}px) translate(3px, -50%)`
        }
      }
      if (shown !== w.shown) {
        w.shown = shown
        el.style.visibility = shown ? 'visible' : 'hidden'
      }
    }
  })

  return null
}
