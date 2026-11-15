import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  type Group,
} from 'three'
import { throttleTrailing } from '../../lib/throttle'
import { useMissionStore } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { OUTLINE_FALLBACK, OUTLINE_TOKEN, tokenColor } from './designTokens'
import { ROUTE_LIFT } from './overlayLift'
import { coordinateToLocalPoint } from './projection'
import { drawnHazards, hazardPointName } from './hazardPointNames'
import { nearestOnScreen } from './traverseGeometry'

/** Across, in CSS pixels: larger than the route's dots, smaller than a pin's head. */
const POINT_PX = 13
/** The dot's red. */
const HAZARD_RED = 0xe5352b
/** Over the trail (2) and the pins (3), under the chart's hover marker (4). */
const RENDER_ORDER = 3.5
/** How near the pointer must be to a point to name it, CSS px. */
const HOVER_PX = 10
/** The pointer is read at most this often. */
const HOVER_INTERVAL_MS = 50
/** The label sits this far above its point, CSS px. */
const LABEL_RISE_PX = 12

/** The points never answer a pick: clicks and right-clicks reach the globe underneath. */
function noRaycast() {}

const vertexShader = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 normal = normalize(mat3(modelMatrix) * position);
    if (dot(normal, normalize(cameraPosition - world.xyz)) <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = uSize * uPixelRatio;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRing;
  uniform vec3 uRim;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float edge = 1.0 - smoothstep(0.88, 1.0, r);
    vec3 color = r > 0.8 ? uRim : r > 0.55 ? uRing : uColor;
    gl_FragColor = vec4(color, edge);
    #include <colorspace_fragment>
  }
`

/**
 * A red dot with a white ring and a dark rim, readable on every layer. Drawn without depth testing, as the route's dots and pins are
 * (the route sits a few km over tiles the depth buffer cannot tell from
 * it close up); the shader hides the points over the horizon instead.
 */
function createHazardMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSize: { value: POINT_PX },
      uPixelRatio: { value: 1 },
      uColor: { value: new Color(HAZARD_RED) },
      uRing: { value: new Color(0xffffff) },
      uRim: { value: new Color(tokenColor(OUTLINE_TOKEN, OUTLINE_FALLBACK)) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}

/**
 * The followed route's hazards as red points on its line: one point
 * per hazard that was found, at the hazard's own coordinate: for a run of
 * steep ground the middle of its steepest stretch, for a stretch under the
 * radiation line its highest place, for what the map marks the place of the
 * mark (a crater's own, up to 100 m beside the line).
 * DERIVED, as the Hazards panel's row for it. A route not yet scanned, a
 * kind that was not scanned and ground that was not checked draw nothing;
 * the panel says those in words.
 *
 * Under the pointer a point names its hazard: the panel's word for the kind, its figure and its place. The
 * label is one element this component adds beside the canvas and removes
 * on unmount; it is for the pointer only, since the panel's rows carry the
 * same words for a keyboard and a screen reader.
 *
 * Mount inside RouteOverlay's group, which keeps its children at the
 * route's lift for the camera's altitude, so the points sit on the
 * line. The shader hides them over the horizon. One material, created
 * once and disposed on unmount with the current geometry; the geometry
 * is replaced, and the old one disposed, when the hazards change.
 */
export function RouteHazardPoints() {
  const hazards = useMissionStore((s) => (s.viewMode === 'navigation' ? s.activeRoute?.hazards : null))
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  const groupRef = useRef<Group>(null)
  /** Hides the hover label; set while the label exists. */
  const hideLabel = useRef<(() => void) | null>(null)
  const rig = useRef<{ points: Points<BufferGeometry, ShaderMaterial>; names: string[]; local: Float32Array } | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const geometry = new BufferGeometry()
    const material = createHazardMaterial()
    const points = new Points(geometry, material)
    points.raycast = noRaycast
    points.renderOrder = RENDER_ORDER
    points.frustumCulled = false
    points.visible = false
    group.add(points)
    rig.current = { points, names: [], local: new Float32Array(0) }
    return () => {
      group.remove(points)
      // The geometry current at unmount: it is replaced when the hazards change.
      points.geometry.dispose()
      material.dispose()
      rig.current = null
    }
  }, [])

  useEffect(() => {
    const r = rig.current
    if (!r) return
    const list = drawnHazards(hazards)
    const local = new Float32Array(list.length * 3)
    const p = new Vector3()
    list.forEach((h, i) => coordinateToLocalPoint(h.coordinate, GLOBE_RADIUS * ROUTE_LIFT, p).toArray(local, i * 3))
    // A new geometry, the old one disposed, so no buffer is left behind (as RouteOverlay does).
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(local, 3))
    const previous = r.points.geometry
    r.points.geometry = geometry
    previous.dispose()
    r.points.visible = list.length > 0
    r.names = list.map(hazardPointName)
    r.local = local
    // The label named a point of the old list; it returns with the pointer's next move.
    hideLabel.current?.()
  }, [hazards])

  useEffect(() => {
    const group = groupRef.current
    const host = domElement.parentElement
    if (!group || !host) return
    const label = document.createElement('div')
    label.className =
      'pointer-events-none absolute left-0 top-0 z-10 hidden max-w-xs rounded-control bg-surface/90 px-1.5 py-0.5 text-caption text-ink shadow-panel backdrop-blur-glass'
    host.appendChild(label)
    let screen = new Float32Array(0)
    const world = new Vector3()
    const toCamera = new Vector3()
    const hide = () => label.classList.add('hidden')
    hideLabel.current = hide
    const pick = throttleTrailing((clientX: number, clientY: number) => {
      const r = rig.current
      const n = r ? r.names.length : 0
      if (!r || n === 0) return hide()
      if (screen.length < n * 2) screen = new Float32Array(n * 2)
      const rect = domElement.getBoundingClientRect()
      // The group is scaled to the route's drawn lift, so its matrix puts each point where it is drawn.
      group.updateWorldMatrix(true, false)
      for (let i = 0; i < n; i++) {
        world.fromArray(r.local, i * 3).applyMatrix4(group.matrixWorld)
        // Behind the globe when the surface faces away from the camera.
        toCamera.copy(camera.position).sub(world)
        if (toCamera.dot(world) <= 0) {
          screen[i * 2] = NaN
          screen[i * 2 + 1] = NaN
          continue
        }
        world.project(camera)
        screen[i * 2] = ((world.x + 1) / 2) * rect.width
        screen[i * 2 + 1] = ((1 - world.y) / 2) * rect.height
      }
      const i = nearestOnScreen(screen, n, clientX - rect.left, clientY - rect.top, HOVER_PX)
      if (i === null) return hide()
      label.textContent = r.names[i]
      label.style.transform = `translate(${Math.round(screen[i * 2])}px, ${Math.round(screen[i * 2 + 1] - LABEL_RISE_PX)}px) translate(-50%, -100%)`
      label.classList.remove('hidden')
    }, HOVER_INTERVAL_MS)
    const onMove = (e: PointerEvent) => pick(e.clientX, e.clientY)
    const onLeave = () => pick(NaN, NaN)
    domElement.addEventListener('pointermove', onMove)
    domElement.addEventListener('pointerleave', onLeave)
    // A zoom moves the point from under a still pointer; the label would stay where it was.
    domElement.addEventListener('wheel', hide, { passive: true })
    return () => {
      domElement.removeEventListener('pointermove', onMove)
      domElement.removeEventListener('pointerleave', onLeave)
      domElement.removeEventListener('wheel', hide)
      hideLabel.current = null
      pick.cancel()
      label.remove()
    }
  }, [camera, domElement])

  useFrame((state) => {
    const r = rig.current
    if (r) r.points.material.uniforms.uPixelRatio.value = state.viewport.dpr
  })

  return <group ref={groupRef} />
}
