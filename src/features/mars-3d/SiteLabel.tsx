import { useFrame } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import { Vector3, type Mesh } from 'three'
import { useSite } from '../../state'
import { facesCamera } from './cameraMath'
import { PICK_RADIUS } from './overlayLift'
import { coordinateToLocalPoint } from './projection'

/**
 * The site's name on the globe, in every orbit view: a pin and
 * "Jezero crater" pinned to the site's centre. The text is HTML, not a
 * texture, so it stays crisp at any zoom and needs no GPU resource; the
 * scene projects the site each frame and moves the element, hiding it
 * while the site is on the far side of the globe. The element never takes
 * pointer events, so picks and drags reach the globe under it.
 *
 * `SiteLabel` renders the element (outside the Canvas); `SiteLabelTracker`
 * runs inside the Canvas and drives it through the shared ref.
 */
export function SiteLabel({ labelRef }: { labelRef: RefObject<HTMLDivElement | null> }) {
  const site = useSite((s) => s.site)
  if (!site) return null
  return (
    <div
      ref={labelRef}
      data-site-label
      title={site.source}
      className="pointer-events-none absolute left-0 top-0 flex flex-col items-center gap-0.5 text-caption text-ink"
      style={{ visibility: 'hidden' }}
    >
      <span className="rounded-control bg-surface/70 px-1.5 py-0.5 shadow-panel backdrop-blur-glass">{site.name}</span>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
        <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" />
        <circle cx="12" cy="10" r="2" />
      </svg>
    </div>
  )
}

/**
 * Screen position to a hundredth of a pixel. Whole pixels made the label step
 * while the slow demo spin moved the ring under it smoothly; a settled
 * scene still rounds to the same value, so it writes nothing.
 */
export function labelPixel(px: number): number {
  return Math.round(px * 100) / 100
}

export function SiteLabelTracker({
  globe,
  labelRef,
}: {
  globe: RefObject<Mesh | null>
  labelRef: RefObject<HTMLDivElement | null>
}) {
  const centre = useSite((s) => s.site?.centre ?? null)
  // Reused every frame: the world point, a scratch, and what was last
  // written to the element, so a settled scene writes nothing.
  const scratch = useRef({
    world: new Vector3(),
    tmp: new Vector3(),
    el: null as HTMLDivElement | null,
    shown: false,
    x: NaN,
    y: NaN,
  })

  useFrame(({ camera, size }) => {
    const el = labelRef.current
    const mesh = globe.current
    const s = scratch.current
    // The label is unmounted on the surface and mounted again in orbit: a new
    // element starts hidden and unplaced, whatever was written to the last one.
    if (s.el !== el) {
      s.el = el
      s.shown = false
      s.x = NaN
      s.y = NaN
    }
    if (!el || !mesh || !centre) return
    // On the picture, not the mean sphere, so the name stays on its place at the 20 km floor.
    mesh.localToWorld(coordinateToLocalPoint(centre, PICK_RADIUS, s.world))
    const visible = facesCamera(s.world, camera.position, s.tmp)
    if (visible) {
      // The camera moved earlier this frame, and the renderer only refreshes
      // its inverse when it draws: without this the label follows last
      // frame's view, tens of pixels behind during a drag.
      camera.updateMatrixWorld()
      s.tmp.copy(s.world).project(camera)
      const x = labelPixel(((s.tmp.x + 1) / 2) * size.width)
      const y = labelPixel(((1 - s.tmp.y) / 2) * size.height)
      if (x !== s.x || y !== s.y) {
        s.x = x
        s.y = y
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
      }
    }
    if (visible !== s.shown) {
      s.shown = visible
      el.style.visibility = visible ? 'visible' : 'hidden'
    }
  })

  return null
}
