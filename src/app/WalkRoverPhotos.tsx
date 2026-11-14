import { RoverPhotosPanel } from '../features/mission-ui/photos/RoverPhotosPanel'
import { STOP_PHOTO_RADIUS_M } from '../features/mission-ui/photos/photoStripMath'
import { useWalkPhotos, walkPhotosScope } from './useWalkPhotos'

/**
 * The Rover photos tool with its photos. Mounted only while the tool
 * is open, so the stops' search runs only then.
 */
export function WalkRoverPhotos() {
  const { images, reason, stopReasons } = useWalkPhotos(STOP_PHOTO_RADIUS_M)
  return (
    <RoverPhotosPanel
      images={images}
      unavailableReason={reason}
      stopReasons={stopReasons}
      scope={walkPhotosScope(undefined, undefined, STOP_PHOTO_RADIUS_M)}
      radiusM={STOP_PHOTO_RADIUS_M}
    />
  )
}
