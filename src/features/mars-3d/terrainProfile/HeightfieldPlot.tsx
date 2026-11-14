import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { MarsCoordinate } from '../../../domain'
import type { TerrainSurface } from '../../route-analysis/terrainProfileGrid'
import { ROUTE_TRAIL_COLOR } from '../pinColors'
import {
  cameraStart,
  frameSegments,
  heightfieldArrays,
  plotAnchors,
  verticalExaggeration,
  type Anchor,
  type HeightfieldArrays,
} from './plotGeometry'
import { ribbon, routeLines, type RibbonArrays } from './routeLine'

const FOV_DEG = 40
/** The frame's and ticks' colour: the line-strong token's value, readable on the canvas dark. */
const FRAME_COLOR = 0x9a9ea8
/** The route's ribbon: this share of the box's longer side wide, in the globe's trail colour, on a darker fringe this much wider so it reads on every colour of the ramp. */
const ROUTE_WIDTH_SHARE = 0.014
const ROUTE_FRINGE = 1.5
const ROUTE_FRINGE_COLOR = 0x1f2228

type LabelRefs = RefObject<(HTMLSpanElement | null)[]>

/**
 * The Terrain Profile 3D plot: the ground between four clicked corners as a
 * heightfield in its own small canvas on a transparent box over the globe
 * (the shell's movable box sets its height through `--plot-h`; 15 rem
 * without one), with the box's frame, ticks in km
 * east and north of the first corner and metres up, the corners numbered,
 * (the ramp: dark blue lowest to red highest, `HEIGHT_RAMP`) and the
 * vertical exaggeration printed. Drag orbits, the wheel zooms;
 * the camera never goes under the floor. Holes in the heights are gaps in
 * the mesh, never a dip. While a route is followed, `route` is its path and
 * the plot draws it where it crosses the box, on the ground as a ribbon in
 * the globe's trail colour over a dark fringe (`routeLines`, `ribbon`); a
 * new path, as when another strategy is picked, replaces the ribbon and the
 * camera stays put.
 *
 * Labels are DOM text over the canvas, placed each frame by projecting
 * their anchors (`Projector`), so they stay crisp at any zoom. The canvas
 * renders on demand: a frame only when the controls move or the surface
 * changes.
 *
 * Disposal: the heightfield's, the frame's and the route ribbons' geometries are built outside
 * JSX and disposed when replaced and on unmount; both materials are
 * JSX-declared, so React Three Fiber disposes them; OrbitControls is
 * disposed with its listeners; the renderer goes with the Canvas.
 */
export function HeightfieldPlot({ surface, route = null }: { surface: TerrainSurface; route?: readonly MarsCoordinate[] | null }) {
  const exaggeration = useMemo(
    () => verticalExaggeration(surface.grid.sizeKm, surface.rangeM.max - surface.rangeM.min),
    [surface],
  )
  const arrays = useMemo(() => heightfieldArrays(surface, exaggeration), [surface, exaggeration])
  const frame = useMemo(() => frameSegments(surface, arrays.heightKm), [surface, arrays])
  const anchors = useMemo(() => plotAnchors(surface, exaggeration, arrays.heightKm), [surface, exaggeration, arrays])
  const start = useMemo(() => cameraStart(surface, arrays.heightKm, FOV_DEG), [surface, arrays])
  const routeRibbons = useMemo(() => {
    const lines = route !== null && route.length > 1 ? routeLines(surface, route, exaggeration) : []
    if (lines.length === 0) return null
    const width = ROUTE_WIDTH_SHARE * Math.max(surface.grid.sizeKm.x, surface.grid.sizeKm.y)
    return { line: ribbon(lines, width), fringe: ribbon(lines, width * ROUTE_FRINGE, width * 0.25) }
  }, [surface, route, exaggeration])
  const routeDrawn = routeRibbons !== null
  // The box, not the surface: a refinement of the heights keeps the camera where the user left it.
  const boxKey = surface.grid.cornersKm.map((c) => `${c.x},${c.y}`).join(';')
  const labels = useRef<(HTMLSpanElement | null)[]>([])

  return (
    <figure
      role="img"
      aria-label={`Surface plot of the ground between the four corners${routeDrawn ? ' with the route across it' : ''}, vertical exaggeration ×${exaggeration}`}
      className="relative h-(--plot-h,15rem) w-full select-none overflow-hidden rounded-control border border-line/60"
      data-exaggeration={exaggeration}
      data-route={routeDrawn ? '' : undefined}
    >
      <Canvas frameloop="demand" gl={{ alpha: true, antialias: true }} dpr={[1, 2]} camera={{ fov: FOV_DEG }}>
        <Controls start={start} boxKey={boxKey} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[start.position[0], start.position[1] * 2, -start.position[2]]} intensity={1.2} />
        <Heightfield arrays={arrays} />
        <Segments positions={frame} color={FRAME_COLOR} />
        {routeRibbons && <Ribbon arrays={routeRibbons.fringe} color={ROUTE_FRINGE_COLOR} />}
        {routeRibbons && <Ribbon arrays={routeRibbons.line} color={ROUTE_TRAIL_COLOR} />}
        <Projector anchors={anchors} labels={labels} />
      </Canvas>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {anchors.map((a, i) => (
          <Label key={`${a.kind} ${a.text} ${i}`} anchor={a} ref={(el) => { labels.current[i] = el }} />
        ))}
      </div>
      <figcaption className="pointer-events-none absolute left-2 right-2 top-1.5 text-caption text-ink-muted [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
        Vertical exaggeration ×{exaggeration} · drag to orbit, scroll to zoom
      </figcaption>
    </figure>
  )
}

/** One label over the canvas, moved by the Projector; its own offset keeps it clear of the frame line. Shadowed: the box is transparent, so the ground is behind it. */
function Label({ anchor, ref }: { anchor: Anchor; ref: (el: HTMLSpanElement | null) => void }) {
  // Past the tick mark's end; the two height labels lean apart so flat ground never stacks them.
  const offset = {
    x: 'translate(-50%, 0.1rem)',
    y: 'translate(0.2rem, -50%)',
    zlow: 'translate(calc(-100% - 0.2rem), -20%)',
    zhigh: 'translate(calc(-100% - 0.2rem), -80%)',
    corner: 'translate(-50%, -50%)',
    axis: 'translate(-50%, -2.2rem)',
  }[anchor.kind]
  return (
    <span ref={ref} className="absolute left-0 top-0 whitespace-nowrap" style={{ visibility: 'hidden' }}>
      <span
        className={
          anchor.kind === 'corner'
            ? 'flex size-5 items-center justify-center rounded-full bg-accent text-[0.65rem] font-semibold text-canvas shadow-panel'
            : anchor.kind === 'axis'
              ? 'block text-caption italic text-ink-subtle [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]'
              : 'block text-caption tabular-nums text-ink-muted [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]'
        }
        style={{ transform: offset, display: anchor.kind === 'corner' ? undefined : 'block' }}
      >
        {anchor.text}
      </span>
    </span>
  )
}

/** The heightfield mesh. Geometry built once per surface and disposed when replaced or on unmount. */
function Heightfield({ arrays }: { arrays: HeightfieldArrays }) {
  const invalidate = useThree((s) => s.invalidate)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(arrays.positions, 3))
    g.setAttribute('color', new BufferAttribute(arrays.colors, 3))
    g.setIndex(new BufferAttribute(arrays.indices, 1))
    g.computeVertexNormals()
    return g
  }, [arrays])
  useEffect(() => {
    invalidate()
    return () => geometry.dispose()
  }, [geometry, invalidate])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} side={DoubleSide} />
    </mesh>
  )
}

/**
 * Line segments in plot space: the box's frame and tick marks, and the
 * route's line. Geometry built once per array, a frame asked for when it
 * changes (the canvas renders on demand), and disposed when replaced or on
 * unmount.
 */
function Segments({ positions, color }: { positions: Float32Array; color: number }) {
  const invalidate = useThree((s) => s.invalidate)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    return g
  }, [positions])
  useEffect(() => {
    invalidate()
    return () => geometry.dispose()
  }, [geometry, invalidate])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  )
}

/**
 * The camera at its start for this box and OrbitControls on the canvas:
 * orbit and zoom, no pan, never under the floor. Near and far follow the
 * plot's size, since a box can be hundreds of metres or tens of km across.
 * Set up once per box (`boxKey`), so a refinement of the heights does not
 * snap the view back; the start is read through a ref for that reason.
 */
function Controls({ start, boxKey }: { start: ReturnType<typeof cameraStart>; boxKey: string }) {
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  const invalidate = useThree((s) => s.invalidate)
  const startRef = useRef(start)
  // Declared first, so the set-up below reads the start of this render.
  useEffect(() => {
    startRef.current = start
  }, [start])
  useEffect(() => {
    const start = startRef.current
    const target = new Vector3(...start.target)
    camera.position.set(...start.position)
    const distance = camera.position.distanceTo(target)
    // Assigned through Object.assign: the lint's immutability rule reads a plain `camera.near =` as a mutated hook value.
    Object.assign(camera, { near: distance / 200, far: distance * 20 })
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    const controls = new OrbitControls(camera, domElement)
    controls.target.copy(target)
    controls.enablePan = false
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    controls.minDistance = distance / 4
    controls.maxDistance = distance * 3
    const onChange = () => invalidate()
    controls.addEventListener('change', onChange)
    controls.update()
    invalidate()
    return () => {
      controls.removeEventListener('change', onChange)
      controls.dispose()
    }
  }, [camera, domElement, invalidate, boxKey])
  return null
}

/** A flat ribbon on the ground, unlit so its colour is exact: the route's line and its fringe. Geometry built once per arrays and disposed when replaced or on unmount. */
function Ribbon({ arrays, color }: { arrays: RibbonArrays; color: number }) {
  const invalidate = useThree((s) => s.invalidate)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(arrays.positions, 3))
    g.setIndex(new BufferAttribute(arrays.indices, 1))
    return g
  }, [arrays])
  useEffect(() => {
    invalidate()
    return () => geometry.dispose()
  }, [geometry, invalidate])
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} side={DoubleSide} />
    </mesh>
  )
}

/** Places the DOM labels each rendered frame by projecting their anchors; a label behind the camera is hidden. */
function Projector({ anchors, labels }: { anchors: Anchor[]; labels: LabelRefs }) {
  const v = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    anchors.forEach((a, i) => {
      const el = labels.current[i]
      if (!el) return
      v.set(a.x, a.y, a.z).project(camera)
      const behind = v.z > 1
      el.style.visibility = behind ? 'hidden' : 'visible'
      if (!behind) el.style.transform = `translate(${(((v.x + 1) / 2) * size.width).toFixed(1)}px, ${(((1 - v.y) / 2) * size.height).toFixed(1)}px)`
    })
  })
  return null
}
