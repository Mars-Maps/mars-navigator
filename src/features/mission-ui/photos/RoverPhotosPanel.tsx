import { useMemo } from 'react'
import type { SurfaceImage } from '../../../domain'
import { useMissionStore, useWalkPlan } from '../../../state'
import { PhotoStrip } from './PhotoStrip'
import { pathPhotos, PHOTOS_NOT_LOADED_REASON, STOP_PHOTO_RADIUS_M, stopPhotos } from './photoStripMath'

/**
 * The Rover photos tool's panel. The shell hands it the photos the
 * stop card's search found near each of the walk's stops, or null
 * with the reason while they are not there, and for each stop whose search
 * found none, why; the panel adds the walk's stops from the walk plan and
 * "go to" from the store's Center view.
 */
export function RoverPhotosPanel({
  images,
  unavailableReason = PHOTOS_NOT_LOADED_REASON,
  stopReasons,
  scope,
  radiusM = STOP_PHOTO_RADIUS_M,
}: {
  /** The photos placed near the walk, or null when they could not be read or placed. */
  images: readonly SurfaceImage[] | null
  /** Why `images` is null. Ignored when it is not. */
  unavailableReason?: string
  /** By stop index: why that stop's search gave no photos, or null when it gave some. */
  stopReasons?: readonly (string | null)[]
  /** Which photos the shell looked for, so the count is never read as every photo near the stops. */
  scope?: string
  /** How far from a stop to look, metres. */
  radiusM?: number
}) {
  const plan = useWalkPlan((s) => s.plan)
  const requestCenter = useMissionStore((s) => s.requestCenter)
  const setActiveTool = useMissionStore((s) => s.setActiveTool)
  const photos = useMemo(() => (images ? pathPhotos(images) : []), [images])
  const stops = useMemo(
    () => stopPhotos(plan?.stops ?? [], images ?? [], radiusM, stopReasons),
    [plan, images, radiusM, stopReasons],
  )
  return (
    <PhotoStrip
      photos={photos}
      stops={stops}
      radiusM={radiusM}
      notReady={images ? undefined : unavailableReason}
      scope={scope}
      onGoTo={(at) => {
        requestCenter(at)
        // The strip opens over the middle of the screen, where the view centres:
        // it closes so nothing covers the place, and the dock gives focus back to
        // its button. Centring keeps the altitude: the place is centred, not zoomed in on.
        setActiveTool(null)
      }}
    />
  )
}
