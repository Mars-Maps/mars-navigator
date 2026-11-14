import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Fog,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type AmbientLight,
  type DirectionalLight,
  type Group,
  type Mesh,
} from 'three'
import type { MarsCoordinate } from '../../../domain'
import { useMissionTimeStore } from '../../../state'
import { skyAt, type SkyBody, type SkyBodyId } from './skyPositions'

/** Where sky bodies are drawn around the camera, metres: inside the camera's far plane. */
const SKY_DISTANCE = 30000
/** Below this many pixels across, a body is drawn as a point so it stays visible. */
const MIN_DISC_PX = 2.5
const UPDATE_MS = 250

/** Display colours, chosen for looks; not measured. */
const BODY_COLORS: Record<SkyBodyId, string> = {
  sun: '#fff7e6',
  phobos: '#a59a90',
  deimos: '#b3a89e',
  mercury: '#b9b2a8',
  venus: '#fff4dc',
  earth: '#9ec9ff',
  jupiter: '#f3e3c4',
  saturn: '#f0d9a0',
  uranus: '#b7e3e8',
  neptune: '#8fa8ff',
}
/**
 * The bodies drawn and labelled: the Sun, Earth, Phobos and Deimos.
 * skyAt still computes the other planets (tested against JPL Horizons);
 * adding an id here brings one back.
 */
const SHOWN: ReadonlySet<SkyBodyId> = new Set(['sun', 'earth', 'phobos', 'deimos'])

/** SIMULATED sky colours by sun altitude: night, twilight, day. */
const NIGHT = new Color('#04050a')
const TWILIGHT = new Color('#2b2433')
const DAY = new Color('#c4a183')
/** If the Sun's position is UNAVAILABLE: a fixed afternoon light, labelled by the caption. */
const FALLBACK_SUN = new Vector3(-0.6, 0.55, 0.35).normalize()

export interface SkyStatus {
  /** Bodies with a DERIVED placement now, and the reasons for any that have none. */
  derived: string[]
  unavailable: { label: string; reason: string }[]
  sunAltitudeDeg: number | null
}

/** What never changes for a body. */
interface Slot {
  body: SkyBody
  /** Moons: radii as fractions of the largest. */
  shape: Vector3
  label: HTMLDivElement
}

/** Where a body is now; rewritten by each update. */
interface Live {
  /** World direction (three: x east, y up, −z north), unit. */
  dir: Vector3
  angularRadius: number
  orient: Matrix4
  visible: boolean
  /** 0–1: how much of the disc faces the Sun (moons and planets). */
  lit: number
  /** In Mars's shadow: no sunlight at all. */
  eclipsed: boolean
}

/**
 * Sky bodies are lit by the Sun wherever it is, whatever the time of day
 * where the walker stands, so they cannot share the ground's light (which
 * dims after sunset). One small shader: Lambert from the true Sun
 * direction, given in view space, and nothing in Mars's shadow.
 */
const BODY_VERTEX = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const BODY_FRAGMENT = `
uniform vec3 uColor;
uniform vec3 uSunView;
uniform float uLit;
varying vec3 vNormal;
void main() {
  float d = max(dot(normalize(vNormal), uSunView), 0.0) * uLit;
  gl_FragColor = vec4(uColor * (0.015 + 0.985 * d), 1.0);
  #include <colorspace_fragment>
}`

const newLive = (): Live => ({ dir: new Vector3(), angularRadius: 0, orient: new Matrix4(), visible: false, lit: 1, eclipsed: false })

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The sky seen from the walker's spot at the mission time: the Sun, Earth,
 * Phobos and Deimos (SHOWN) where they really are (skyAt, DERIVED), each at
 * its true angular size, and the light, sky colour and fog that follow the
 * real Sun. Bodies too small to see at the current zoom are drawn as points
 * so they can be found; labels name them (L toggles).
 *
 * Positions are recomputed four times a second from `observerRef` and the
 * mission clock; the frame loop only places what was computed, allocating
 * nothing. Disposal: geometries, materials and the fog are disposed on
 * unmount, the scene's background and fog restored, labels removed.
 */
export function SkyDome({
  observerRef,
  labelLayerRef,
  onStatus,
}: {
  observerRef: RefObject<MarsCoordinate | null>
  labelLayerRef: RefObject<HTMLDivElement | null>
  onStatus: (status: SkyStatus) => void
}) {
  const get = useThree((s) => s.get)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const group = useRef<Group>(null)
  const sun = useRef<DirectionalLight>(null)
  const ambient = useRef<AmbientLight>(null)
  const statusKey = useRef('')
  /** The body meshes, by slot index, filled by their JSX refs. */
  const meshes = useRef<(Mesh | null)[]>([])
  const live = useRef<Live[]>([])
  const onStatusRef = useRef(onStatus)
  useEffect(() => {
    onStatusRef.current = onStatus
  }, [onStatus])

  // Built once: one mesh per body, one point per body, shared geometries.
  const built = useMemo(() => {
    const sphere = new SphereGeometry(1, 32, 16)
    const disc = new CircleGeometry(1, 48)
    // Any time inside every model's range: only the list of bodies is used here.
    const bodies = skyAt(Date.UTC(2026, 0, 1), { latitude: 0, longitudeEast: 0 }).filter((b) =>
      SHOWN.has(b.id),
    )
    const materials: (MeshBasicMaterial | ShaderMaterial)[] = []
    // Shared by every body's material: the Sun's direction in view space.
    const sunView = { value: new Vector3(0, 1, 0) }
    const slots: Slot[] = bodies.map((body) => {
      const material =
        body.kind === 'sun'
          ? new MeshBasicMaterial({ color: BODY_COLORS.sun, fog: false, toneMapped: false })
          : new ShaderMaterial({
              uniforms: {
                uColor: { value: new Color(BODY_COLORS[body.id]) },
                uSunView: sunView,
                uLit: { value: 1 },
              },
              vertexShader: BODY_VERTEX,
              fragmentShader: BODY_FRAGMENT,
            })
      materials.push(material)
      const label = document.createElement('div')
      label.textContent = body.label
      label.className =
        'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-control bg-surface/60 px-1 text-micro text-ink'
      label.style.display = 'none'
      const slot: Slot = {
        body,
        shape: new Vector3(1, body.radiiKm[1] / body.radiiKm[0], body.radiiKm[2] / body.radiiKm[0]),
        label,
      }
      return slot
    })
    const pointGeometry = new BufferGeometry()
    pointGeometry.setAttribute('position', new BufferAttribute(new Float32Array(slots.length * 3), 3))
    pointGeometry.setAttribute('color', new BufferAttribute(new Float32Array(slots.length * 4), 4))
    const pointMaterial = new PointsMaterial({
      size: 3,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: AdditiveBlending,
    })
    const points = new Points(pointGeometry, pointMaterial)
    points.frustumCulled = false
    return { sphere, disc, materials, slots, points, pointGeometry, pointMaterial, sunView }
  }, [])

  const fog = useMemo(() => new Fog(DAY.clone(), 1500, 12000), [])
  const background = useMemo(() => DAY.clone(), [])
  const scratch = useMemo(() => ({ v: new Vector3(), x: new Vector3(), y: new Vector3(), z: new Vector3() }), [])

  // Scene background and fog belong to the sky; labels to the overlay.
  useEffect(() => {
    const scene = get().scene
    const previous = { background: scene.background, fog: scene.fog }
    scene.background = background
    scene.fog = fog
    const layer = labelLayerRef.current
    for (const s of built.slots) layer?.append(s.label)
    return () => {
      scene.background = previous.background
      scene.fog = previous.fog
      for (const s of built.slots) s.label.remove()
      built.sphere.dispose()
      built.disc.dispose()
      for (const m of built.materials) m.dispose()
      built.pointGeometry.dispose()
      built.pointMaterial.dispose()
    }
  }, [get, background, fog, built, labelLayerRef])

  // L toggles labels.
  const labels = useRef(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyL' && !(e.target instanceof HTMLInputElement)) labels.current = !labels.current
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const lastUpdate = useRef({ at: -Infinity, utcMs: NaN })
  /** The Sun's world direction from the last update, for the body shader. */
  const sunWorld = useRef(FALLBACK_SUN.clone())
  const sunAlt = useRef<number | null>(null)

  const update = () => {
    const observer = observerRef.current
    if (!observer) return
    const utcMs = useMissionTimeStore.getState().utcMs
    const bodies = skyAt(utcMs, observer)
    const derivedLabels: string[] = []
    const missing: SkyStatus['unavailable'] = []
    let sunDir: Vector3 | null = null
    const lives = live.current
    for (let i = 0; i < built.slots.length; i++) lives[i] ??= newLive()
    for (let i = 0; i < built.slots.length; i++) {
      const s = lives[i]
      const b = bodies.find((x) => x.id === built.slots[i].body.id)
      if (!b || b.placement.classification !== 'DERIVED') {
        s.visible = false
        if (b?.placement.classification === 'UNAVAILABLE') missing.push({ label: b.label, reason: b.placement.reason })
        continue
      }
      const p = b.placement.value
      derivedLabels.push(b.label)
      // Local (east, north, up) → three (x east, y up, −z north).
      s.dir.set(p.direction[0], p.direction[2], -p.direction[1])
      s.angularRadius = p.angularRadius
      s.visible = p.altitudeDeg + p.angularRadius * (180 / Math.PI) > -0.5
      if (b.kind === 'sun') sunDir = s.dir
      s.eclipsed = p.inMarsShadow === true
      if (p.axes) {
        const { x, y, z } = scratch
        x.set(p.axes.toMars[0], p.axes.toMars[2], -p.axes.toMars[1])
        z.set(p.axes.pole[0], p.axes.pole[2], -p.axes.pole[1])
        z.addScaledVector(x, -z.dot(x)).normalize()
        y.crossVectors(z, x)
        s.orient.makeBasis(x, y, z)
      }
    }
    // Lit fraction of each disc: phase angle between the Sun and the observer, seen from the body.
    built.slots.forEach((slot, i) => {
      const s = lives[i]
      s.lit = s.eclipsed ? 0 : sunDir && slot.body.kind !== 'sun' ? (1 - s.dir.dot(sunDir as Vector3)) / 2 : 1
      const material = built.materials[i]
      if (material instanceof ShaderMaterial) material.uniforms.uLit.value = s.eclipsed ? 0 : 1
    })
    sunAlt.current = sunDir ? Math.asin((sunDir as Vector3).y) * (180 / Math.PI) : null

    // Light and sky colour follow the Sun.
    const alt = sunAlt.current
    const light = sun.current
    sunWorld.current.copy(sunDir ?? FALLBACK_SUN)
    if (light) light.position.copy(sunWorld.current).multiplyScalar(10000)
    const day = alt === null ? 1 : smoothstep(-2, 6, alt)
    const dusk = alt === null ? 1 : smoothstep(-14, -2, alt)
    if (light) light.intensity = 3.2 * (alt === null ? 1 : smoothstep(-1, 5, alt))
    if (ambient.current) ambient.current.intensity = 0.06 + 0.39 * day
    background.copy(NIGHT).lerp(TWILIGHT, dusk).lerp(DAY, day)
    fog.color.copy(background)

    const key = `${derivedLabels.join()}|${missing.map((m) => m.label).join()}|${alt === null ? 'none' : Math.round(alt)}`
    if (key !== statusKey.current) {
      statusKey.current = key
      onStatusRef.current({ derived: derivedLabels, unavailable: missing, sunAltitudeDeg: alt })
    }
  }

  useFrame(() => {
    const now = performance.now()
    const utcMs = useMissionTimeStore.getState().utcMs
    const last = lastUpdate.current
    if (now - last.at > UPDATE_MS || utcMs !== last.utcMs) {
      last.at = now
      last.utcMs = utcMs
      update()
    }

    const g = group.current
    if (!g) return
    g.position.copy(camera.position)
    built.sunView.value.copy(sunWorld.current).transformDirection(camera.matrixWorldInverse)
    const fov = (camera instanceof PerspectiveCamera ? camera.fov : 70) * (Math.PI / 180)
    const pxPerRad = size.height / fov
    const alt = sunAlt.current
    const night = alt === null ? 0 : 1 - smoothstep(-6, 3, alt)
    const positions = built.pointGeometry.getAttribute('position') as BufferAttribute
    const colors = built.pointGeometry.getAttribute('color') as BufferAttribute
    const layer = labelLayerRef.current
    const { v } = scratch

    built.slots.forEach((slot, i) => {
      const s = live.current[i]
      if (!s) return
      const mesh = meshes.current[i]
      const discPx = 2 * s.angularRadius * pxPerRad
      const asDisc = s.visible && (slot.body.kind === 'sun' || discPx >= MIN_DISC_PX)
      if (mesh) {
        mesh.visible = asDisc
        if (asDisc) {
          mesh.position.copy(s.dir).multiplyScalar(SKY_DISTANCE)
          const r = SKY_DISTANCE * Math.tan(s.angularRadius)
          if (slot.body.kind === 'sun') {
            mesh.scale.setScalar(r)
            mesh.lookAt(g.position)
          } else if (slot.body.kind === 'moon') {
            mesh.quaternion.setFromRotationMatrix(s.orient)
            mesh.scale.copy(slot.shape).multiplyScalar(r)
          } else {
            mesh.scale.setScalar(r)
          }
        }
      }
      // The point stands in for a disc too small to see; dimmer in daylight and when mostly unlit.
      const asPoint = s.visible && !asDisc
      v.copy(s.dir).multiplyScalar(SKY_DISTANCE)
      positions.setXYZ(i, v.x, v.y, v.z)
      const col = BODY_COLORS_RGB[slot.body.id]
      const alpha = asPoint ? (0.25 + 0.75 * s.lit) * (0.15 + 0.85 * night) : 0
      colors.setXYZW(i, col[0], col[1], col[2], alpha)

      // Label: projected into the overlay, hidden below the horizon or behind the camera.
      if (layer) {
        v.add(g.position).project(camera)
        const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
        const show = labels.current && s.visible && onScreen
        slot.label.style.display = show ? 'block' : 'none'
        if (show) {
          const x = (v.x * 0.5 + 0.5) * size.width
          const y = (-v.y * 0.5 + 0.5) * size.height
          slot.label.style.transform = `translate(${x + 8}px, ${y - 8}px)`
        }
      }
    })
    positions.needsUpdate = true
    colors.needsUpdate = true
  })

  return (
    <>
      <ambientLight ref={ambient} intensity={0.45} />
      <directionalLight ref={sun} intensity={3.2} />
      <group ref={group}>
        {built.slots.map((s, i) => (
          <mesh
            key={s.body.id}
            ref={(m) => {
              meshes.current[i] = m
            }}
            geometry={s.body.kind === 'sun' ? built.disc : built.sphere}
            material={built.materials[i]}
            renderOrder={-1}
            visible={false}
          />
        ))}
        <primitive object={built.points} renderOrder={-1} />
      </group>
    </>
  )
}

/** BODY_COLORS as linear RGB triples, so the frame loop never parses a colour. */
const BODY_COLORS_RGB = Object.fromEntries(
  Object.entries(BODY_COLORS).map(([id, hex]) => {
    const c = new Color(hex)
    return [id, [c.r, c.g, c.b] as const]
  }),
) as Record<SkyBodyId, readonly [number, number, number]>
