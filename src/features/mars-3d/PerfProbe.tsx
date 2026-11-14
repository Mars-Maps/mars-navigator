import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useMissionStore } from '../../state'
import { FrameSampler } from './frameStats'
import { collectTextures } from './perfReport'
import { perfTestRoute } from './perfRoute'

/** Overlay text refresh, so the probe's own DOM writes stay out of the frame budget. */
const REFRESH_MS = 250
/** After a remount, time for textures and detail tiles to load before memory is read. */
const SETTLE_MS = 1500
const CYCLE_COUNT = 20

interface Ui {
  root: HTMLDivElement
  text: HTMLPreElement
  status: HTMLDivElement
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.className =
    'rounded border border-line-strong bg-surface-raised px-2 py-1 text-ink hover:border-accent'
  b.addEventListener('click', onClick)
  return b
}

/**
 * Lets the panel be dragged by `handle`, kept inside the window. A
 * double-click on the handle puts it back in its corner. The listeners go
 * with the elements when the panel is removed.
 */
function makeDraggable(panel: HTMLDivElement, handle: HTMLElement) {
  let offsetX = 0
  let offsetY = 0
  handle.addEventListener('pointerdown', (e) => {
    // Otherwise the drag also selects text across the page.
    e.preventDefault()
    const rect = panel.getBoundingClientRect()
    offsetX = e.clientX - rect.left
    offsetY = e.clientY - rect.top
    handle.setPointerCapture(e.pointerId)
  })
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return
    const maxX = window.innerWidth - panel.offsetWidth
    const maxY = window.innerHeight - panel.offsetHeight
    panel.style.left = `${Math.max(0, Math.min(maxX, e.clientX - offsetX))}px`
    panel.style.top = `${Math.max(0, Math.min(maxY, e.clientY - offsetY))}px`
    // Inline left/top replace the class's right/bottom anchoring.
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  })
  handle.addEventListener('dblclick', () => {
    panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = ''
  })
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Performance probe, mounted by MarsGlobe only under `?perf`. Takes
 * over rendering (useFrame priority 1) so it can time `gl.render` and read
 * `renderer.info` for the frame just drawn; the image is the same as R3F's
 * own render. Shows draw calls, triangles, points, GPU geometries,
 * textures and programs, frame interval and render CPU time in a fixed
 * overlay, written by textContent a few times a second, never through
 * React state.
 *
 * Buttons: load the SIMULATED 50-point test route (perfRoute.ts) into the
 * draft; print a texture-size table; unmount and remount the scene
 * CYCLE_COUNT times through `setSceneMounted`, logging `renderer.info.memory`
 * after each unmount and each settled remount. Everything is removed on
 * unmount and a running cycle stops.
 */
export function PerfProbe({ setSceneMounted }: { setSceneMounted: (mounted: boolean) => void }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const ui = useRef<Ui | null>(null)
  const frames = useRef(new FrameSampler())
  const renders = useRef(new FrameSampler())
  const last = useRef({ frameAt: 0, refreshAt: 0 })

  useEffect(() => {
    let cancelled = false
    let cycling = false

    const root = document.createElement('div')
    root.className =
      'fixed right-2 bottom-2 z-[1000] w-72 rounded-md border border-line bg-surface/95 p-2 font-mono text-[11px] text-ink-muted'
    const title = document.createElement('div')
    title.className = 'mb-1 cursor-move touch-none select-none text-ink'
    title.textContent = 'Performance probe (?perf)'
    title.title = 'Drag to move · double-click to return to the corner'
    makeDraggable(root, title)
    const text = document.createElement('pre')
    text.className = 'whitespace-pre'
    const status = document.createElement('div')
    status.className = 'mt-1 text-simulated'
    const buttons = document.createElement('div')
    buttons.className = 'mt-2 flex flex-wrap gap-1'

    const loadRoute = () => {
      const route = perfTestRoute()
      const s = useMissionStore.getState()
      s.clearRoute()
      s.setDeparture(route.departure)
      for (const stop of route.stops) s.addStop(stop)
      s.setDestination(route.destination)
      frames.current.reset()
      renders.current.reset()
      status.textContent = `Test route: ${route.stops.length + 2} SIMULATED waypoints`
    }

    const report = () => {
      const r = gl.info.render
      const rows = collectTextures(scene)
      const total = rows.reduce((sum, row) => sum + row.estimatedBytes, 0)
      console.info('[perf] draw calls %d, triangles %d, points %d, lines %d', r.calls, r.triangles, r.points, r.lines)
      console.info('[perf] gpu memory', { ...gl.info.memory, programs: gl.info.programs?.length ?? 0 })
      console.table(rows)
      const bySize: Record<string, number> = {}
      for (const row of rows) bySize[`${row.width}×${row.height}`] = (bySize[`${row.width}×${row.height}`] ?? 0) + 1
      console.info(`[perf] textures by size ${JSON.stringify(bySize)}`)
      console.info('[perf] %d textures in the scene graph, ≈ %s MB', rows.length, (total / 2 ** 20).toFixed(1))
      status.textContent = 'Report printed to the console'
    }

    const memory = () => ({
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
    })

    const cycle = async () => {
      if (cycling) return
      cycling = true
      const rows: Record<string, number>[] = []
      const before = memory()
      for (let i = 1; i <= CYCLE_COUNT && !cancelled; i++) {
        status.textContent = `Cycle ${i} / ${CYCLE_COUNT}`
        setSceneMounted(false)
        for (let f = 0; f < 3; f++) await nextFrame()
        const off = memory()
        setSceneMounted(true)
        await wait(SETTLE_MS)
        const on = memory()
        rows.push({
          cycle: i,
          geometriesOff: off.geometries,
          texturesOff: off.textures,
          programsOff: off.programs,
          geometriesOn: on.geometries,
          texturesOn: on.textures,
          programsOn: on.programs,
        })
      }
      cycling = false
      if (cancelled) return
      console.info('[perf] before cycling', before)
      console.table(rows)
      // Plain text as well: a copied console.table loses its columns.
      console.info(`[perf] cycle rows ${JSON.stringify(rows)}`)
      const first = rows[0]
      const lastRow = rows[rows.length - 1]
      const grew =
        lastRow.geometriesOff > first.geometriesOff || lastRow.texturesOff > first.texturesOff
      status.textContent = grew
        ? `Cycled ${CYCLE_COUNT}×: unmounted memory GREW (see console)`
        : `Cycled ${CYCLE_COUNT}×: no growth while unmounted (see console)`
    }

    buttons.append(button('Load test route', loadRoute), button('Report', report), button(`Cycle ${CYCLE_COUNT}×`, cycle))
    root.append(title, text, status, buttons)
    document.body.append(root)
    ui.current = { root, text, status }

    return () => {
      cancelled = true
      root.remove()
      ui.current = null
      // A cycle stopped half way must not leave the scene unmounted.
      setSceneMounted(true)
    }
  }, [gl, scene, setSceneMounted])

  useFrame((state) => {
    const now = performance.now()
    const t = last.current
    if (t.frameAt > 0) frames.current.record(now - t.frameAt)
    t.frameAt = now
    state.gl.render(state.scene, state.camera)
    renders.current.record(performance.now() - now)

    const u = ui.current
    if (!u || now - t.refreshAt < REFRESH_MS) return
    t.refreshAt = now
    const r = state.gl.info.render
    const m = state.gl.info.memory
    const f = frames.current.summary()
    const c = renders.current.summary()
    u.text.textContent = [
      `canvas    ${state.size.width}×${state.size.height} @ dpr ${state.viewport.dpr}`,
      `calls     ${r.calls}`,
      `triangles ${r.triangles}   points ${r.points}   lines ${r.lines}`,
      `gpu       ${m.geometries} geometries, ${m.textures} textures, ${state.gl.info.programs?.length ?? 0} programs`,
      f ? `frame     ${f.meanMs.toFixed(2)} ms mean, ${f.p95Ms.toFixed(2)} p95, ${f.maxMs.toFixed(1)} max (${f.fps.toFixed(0)} fps)` : 'frame     —',
      c ? `render    ${c.meanMs.toFixed(2)} ms CPU mean, ${c.p95Ms.toFixed(2)} p95` : 'render    —',
    ].join('\n')
  }, 1)

  return null
}
