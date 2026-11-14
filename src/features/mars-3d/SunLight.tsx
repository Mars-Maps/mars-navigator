import { useCallback, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { AmbientLight, DirectionalLight } from 'three'
import { isAvailable } from '../../domain'
import { useMissionStore, useMissionTime } from '../../state'
import {
  NEUTRAL_INTENSITY,
  SUN_DISTANCE,
  ambientIntensity,
  shadingTarget,
  stepShading,
  sunDirection,
  sunIntensity,
} from './sunMath'

/**
 * Sun lighting and the day/night terminator. Mount inside the globe
 * mesh: the directional light sits over the Mars24 subsolar point for the
 * mission time, so the terminator moves with the time slider and stays
 * attached to the surface through the tilt and the demonstration spin. It
 * aims at the mesh origin, the globe's centre.
 *
 * The position is set when the mission time changes, into the light's own
 * vector, and the time store re-renders only this component. When the sun
 * position is UNAVAILABLE the globe gets even, neutral light instead and the
 * surface caption says so.
 *
 * Shading shows in every globe mode.
 * The right-click menu's "Hide sun shading" fades
 * the two lights to even light so the dark side can be read, and "Show sun
 * shading" brings it back. The fade writes the existing lights'
 * intensities in the frame loop and allocates nothing. The callback refs
 * set the starting intensities, so a light created while shading is hidden
 * (the sun coming back from UNAVAILABLE, or the scene remounting under the
 * ?perf probe) starts at the current shading instead of Three's default of 1.
 *
 * No shadows: the renderer never enables its shadow map;
 * a lone sphere has nothing to cast one onto. Lights are JSX, so React
 * Three Fiber removes them on unmount; they hold no GPU resources.
 */
export function SunLight() {
  const { solar } = useMissionTime()
  const target = useMissionStore((s) => shadingTarget(s.sunShading))
  const light = useRef<DirectionalLight>(null)
  const ambient = useRef<AmbientLight>(null)
  const shading = useRef(target)

  // A light starts at the current shading, not Three's default intensity of 1.
  const attachAmbient = useCallback((node: AmbientLight | null) => {
    ambient.current = node
    if (node) node.intensity = ambientIntensity(shading.current)
  }, [])
  const attachSun = useCallback((node: DirectionalLight | null) => {
    light.current = node
    if (node) node.intensity = sunIntensity(shading.current)
  }, [])

  useLayoutEffect(() => {
    if (!light.current || !isAvailable(solar)) return
    sunDirection(solar.value, light.current.position).multiplyScalar(SUN_DISTANCE)
  }, [solar])

  useFrame((_, delta) => {
    if (!light.current || !ambient.current || shading.current === target) return
    shading.current = stepShading(shading.current, target, delta)
    ambient.current.intensity = ambientIntensity(shading.current)
    light.current.intensity = sunIntensity(shading.current)
  })

  if (!isAvailable(solar)) return <ambientLight intensity={NEUTRAL_INTENSITY} />
  return (
    <>
      <ambientLight ref={attachAmbient} />
      <directionalLight ref={attachSun} />
    </>
  )
}
