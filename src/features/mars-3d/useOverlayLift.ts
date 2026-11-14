import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import type { Object3D } from 'three'
import { GLOBE_RADIUS } from './constants'
import { overlayScale } from './overlayLift'

/**
 * Keeps an overlay at its lift for the camera's altitude: its
 * geometry is built once at `nominal` and the object is scaled about the
 * globe's centre, so nothing is rebuilt as the camera moves. Sprites sized
 * in pixels keep their size. The frame loop writes one number, and only
 * when it changes.
 */
export function useOverlayLift(ref: RefObject<Object3D | null>, nominal: number): void {
  useFrame(({ camera }) => {
    const object = ref.current
    if (!object) return
    const scale = overlayScale(nominal, camera.position.length() - GLOBE_RADIUS)
    if (object.scale.x !== scale) object.scale.setScalar(scale)
  })
}
