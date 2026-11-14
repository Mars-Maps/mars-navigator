import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Raycaster, Vector2, Vector3, type Mesh } from 'three'
import type { MarsCoordinate } from '../../../domain'
import { GLOBE_RADIUS } from '../constants'
import { overlayLift, pickCoordinate, ROUTE_LIFT } from '../overlayLift'
import { coordinateToLocalPoint } from '../projection'
import type { ScreenPoint } from './snapToRoute'

/** Turns a screen point into the surface coordinate under it, or null off the globe. */
export type GlobePicker = (clientX: number, clientY: number) => MarsCoordinate | null
/** The reverse: where a surface coordinate is on the screen, or null on the globe's far side. */
export type GlobeProjector = (c: MarsCoordinate) => ScreenPoint | null

/**
 * Mounted inside the globe's Canvas: fills `pickerRef` with a function the
 * walker widget (outside the Canvas) calls on drop, and `projectorRef`
 * with its reverse, for snapping the drop to the route's line.
 * Scratch objects are made once; a pick allocates only its result.
 */
export function DropPicker({
  globe,
  pickerRef,
  projectorRef,
}: {
  globe: RefObject<Mesh | null>
  pickerRef: RefObject<GlobePicker | null>
  projectorRef?: RefObject<GlobeProjector | null>
}) {
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  useEffect(() => {
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const world = new Vector3()
    const centre = new Vector3()
    const toCamera = new Vector3()
    pickerRef.current = (clientX, clientY) => {
      const mesh = globe.current
      if (!mesh) return null
      const rect = domElement.getBoundingClientRect()
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return pickCoordinate(raycaster.ray, mesh, world)
    }
    if (projectorRef) {
      projectorRef.current = (c) => {
        const mesh = globe.current
        if (!mesh) return null
        // At the route line's own lift for this altitude, so the snap measures to the line as drawn.
        const lift = overlayLift(ROUTE_LIFT, camera.position.length() - GLOBE_RADIUS)
        mesh.localToWorld(coordinateToLocalPoint(c, GLOBE_RADIUS * lift, world))
        // Facing away from the camera: behind the globe, as the route's own shader hides its dots.
        mesh.getWorldPosition(centre)
        toCamera.copy(camera.position).sub(world)
        if (centre.subVectors(world, centre).dot(toCamera) <= 0) return null
        world.project(camera)
        const rect = domElement.getBoundingClientRect()
        return { x: rect.left + ((world.x + 1) / 2) * rect.width, y: rect.top + ((1 - world.y) / 2) * rect.height }
      }
    }
    return () => {
      pickerRef.current = null
      if (projectorRef) projectorRef.current = null
    }
  }, [camera, domElement, globe, pickerRef, projectorRef])
  return null
}

/**
 * The little walker, like Google Earth's: drag it from the corner onto any
 * point of the globe to stand on the surface there. `onDrop` gets the
 * coordinate under the drop and the screen point, so the host can snap it
 * to the route's line; `hint` is the second line of the text.
 */
export function WalkerWidget({
  pickerRef,
  onDrop,
  hint = 'Drag the walker onto Mars to stand there. Zoom in first to pick a precise spot.',
}: {
  pickerRef: RefObject<GlobePicker | null>
  onDrop: (at: MarsCoordinate, screen: ScreenPoint) => void
  hint?: string
}) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const noteTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(noteTimer.current), [])

  const flash = (text: string) => {
    setNote(text)
    window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNote(null), 3500)
  }

  return (
    <>
      <div data-keep-clear="" className="pointer-events-auto absolute right-4 bottom-14 flex w-56 flex-col gap-2 rounded-panel border border-line/60 bg-surface/70 p-3 text-caption text-ink-muted shadow-panel backdrop-blur-glass">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Drag the walker onto the globe to stand there"
            className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control border border-simulated/60 bg-surface-raised text-simulated active:cursor-grabbing"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag({ x: e.clientX, y: e.clientY })
            }}
            // The pointer capture, not `drag`, says whether a drag is on: state from
            // the press may not have rendered yet when a quick flick is released.
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) setDrag({ x: e.clientX, y: e.clientY })
            }}
            onPointerUp={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
              setDrag(null)
              const at = pickerRef.current?.(e.clientX, e.clientY) ?? null
              if (!at) return flash('Drop the walker on the globe, not the sky.')
              onDrop(at, { x: e.clientX, y: e.clientY })
            }}
            onPointerCancel={() => setDrag(null)}
          >
            <WalkerIcon />
          </button>
          <p>
            <span className="text-ink">Surface view</span>
            <br />
            {hint}
          </p>
        </div>
        {note && <p className="text-simulated">{note}</p>}
      </div>
      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full text-simulated drop-shadow"
          style={{ left: drag.x, top: drag.y }}
        >
          <WalkerIcon size={36} />
        </div>
      )}
    </>
  )
}

function WalkerIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="4.5" r="2.5" />
      <path d="M8.5 9.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V15h-1.5l-.5 7h-3l-.5-7H8.5z" />
    </svg>
  )
}
