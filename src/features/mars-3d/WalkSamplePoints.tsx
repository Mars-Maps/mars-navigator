import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Points, PointsMaterial, Vector3, type Group } from 'three'
import { throttleTrailing } from '../../lib/throttle'
import { useLandingSite, useWalkPlan } from '../../state'
import { GLOBE_RADIUS } from './constants'
import { ROUTE_LIFT } from './overlayLift'
import { coordinateToLocalPoint } from './projection'
import { nearestOnScreen } from './traverseGeometry'
import { createDotTexture, hexCss } from './walkDots'
import { SAMPLE_GREEN, samplePointNames, walkPlanGeometry } from './walkPlanGeometry'

/**
 * Across, in CSS pixels: bigger than a stop's dot (5), smaller than a
 * hazard's red point (13) with its white ring, so a sample and a hazard
 * close together are told apart by size as well as colour. 11, not 9, for
 * the heavy dark rim: the green inside stays as large as before.
 */
const SAMPLE_PX = 11
/** A ring round the landing site, larger than anything on the walk. */
const LANDING_PX = 15
/** Over the walk's lines and stop dots (3), under the hazard points (3.5). */
const SAMPLE_RENDER_ORDER = 3.2
const LANDING_RENDER_ORDER = 3.1
/** How near the pointer must be to a sample to name it, CSS px. */
const HOVER_PX = 10
const HOVER_INTERVAL_MS = 50
/** The label sits this far above its point, CSS px. */
const LABEL_RISE_PX = 10

function noRaycast() {}

type Dots = Points<BufferGeometry, PointsMaterial>

function dots(fill: string, px: number, order: number, hollow = false, heavyRim = false): Dots {
  const p = new Points(
    new BufferGeometry(),
    new PointsMaterial({ map: createDotTexture(fill, hollow, heavyRim), size: px, sizeAttenuation: false, transparent: true, depthWrite: false }),
  )
  p.raycast = noRaycast
  p.renderOrder = order
  p.frustumCulled = false
  p.visible = false
  return p
}

function setPositions(p: Dots, positions: Float32Array) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const previous = p.geometry
  p.geometry = geometry
  previous.dispose()
  p.visible = positions.length > 0
}

/**
 * The selected walk's samples as green points at the plan's own
 * coordinates, and the landing site as a ring. Under the pointer a
 * sample names itself: its number, its minutes, the unit where it is at a
 * stop, and its place. The label is for the pointer only; the Plan a walk
 * panel lists the same samples in words.
 *
 * Mount inside WalkPlanOverlay's group, at the route's lift. The materials,
 * textures and current geometries are disposed on unmount; a geometry is
 * replaced, and the old one disposed, when the plan or the site changes.
 */
export function WalkSamplePoints() {
  const plan = useWalkPlan((s) => s.plan)
  const landing = useLandingSite((s) => s.landingSite)
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  const groupRef = useRef<Group>(null)
  const hideLabel = useRef<(() => void) | null>(null)
  const rig = useRef<{ samples: Dots; landing: Dots; names: string[]; local: Float32Array } | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const samples = dots(hexCss(SAMPLE_GREEN), SAMPLE_PX, SAMPLE_RENDER_ORDER, false, true)
    const site = dots('#ffffff', LANDING_PX, LANDING_RENDER_ORDER, true)
    group.add(samples, site)
    rig.current = { samples, landing: site, names: [], local: new Float32Array(0) }
    return () => {
      group.remove(samples, site)
      for (const p of [samples, site]) {
        p.geometry.dispose()
        p.material.map?.dispose()
        p.material.dispose()
      }
      rig.current = null
    }
  }, [])

  useEffect(() => {
    const r = rig.current
    if (!r) return
    const { samples } = walkPlanGeometry(plan, GLOBE_RADIUS * ROUTE_LIFT)
    setPositions(r.samples, samples)
    r.names = samplePointNames(plan)
    r.local = samples
    hideLabel.current?.()
  }, [plan])

  useEffect(() => {
    const r = rig.current
    if (!r) return
    const at = new Float32Array(landing ? 3 : 0)
    if (landing) coordinateToLocalPoint(landing, GLOBE_RADIUS * ROUTE_LIFT, new Vector3()).toArray(at)
    setPositions(r.landing, at)
  }, [landing])

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
      group.updateWorldMatrix(true, false)
      for (let i = 0; i < n; i++) {
        world.fromArray(r.local, i * 3).applyMatrix4(group.matrixWorld)
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

  return <group ref={groupRef} />
}
