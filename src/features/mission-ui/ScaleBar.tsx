import { useEffect, useState } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { useMissionStore } from '../../state'
import { formatLength, kmPerPixel, niceLength } from './scaleBarMath'

/** The slot is w-40 (160 px); the bar leaves room for its end ticks. */
const MAX_BAR_PX = 120

const NOT_SETTLED = 'The camera has not reported a settled position yet'
const METHOD =
  'Derived from the camera altitude, the field of view and the window height, at the centre of the view looking straight down. Not exact towards the edge of the globe.'

interface ScaleBarProps {
  /** Vertical field of view of the scene camera, degrees. The shell passes the scene's own value. */
  fovDeg: number
}

/**
 * The bottom-left scale bar: a length in km for the current camera
 * altitude. Reads `camera` from the store, which the scene writes only when
 * the camera settles, so the bar updates after a zoom ends, not during it.
 * Until the camera has settled once it says so instead of drawing a bar,
 * never a length of zero.
 */
export function ScaleBar({ fovDeg }: ScaleBarProps) {
  const camera = useMissionStore((s) => s.camera)
  const heightPx = useViewportHeight()

  const length = niceLength(
    camera === null ? null : kmPerPixel(camera.altitudeKm, fovDeg, heightPx),
    MAX_BAR_PX,
  )

  return (
    // Not a live region: the length changes on every camera stop, and a
    // screen reader re-announcing it each time would be noise.
    <div className="rounded-control border border-line/60 bg-surface/80 px-2 py-1 text-caption text-ink backdrop-blur-glass">
      {length === null ? (
        <div className="flex items-center gap-1.5">
          <span className="text-ink-muted">Scale unavailable</span>
          <ClassificationBadge classification="UNAVAILABLE" detail={NOT_SETTLED} />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 tabular-nums">
            <span>{formatLength(length.km)}</span>
            <ClassificationBadge classification="DERIVED" detail={METHOD} />
          </div>
          <div
            aria-hidden="true"
            className="mt-1 h-1.5 border-x border-b border-ink"
            style={{ width: length.widthPx }}
          />
        </>
      )}
    </div>
  )
}

/** The scene fills the window, so its height in pixels is the window's. */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}
