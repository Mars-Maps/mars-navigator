import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { CanvasTexture, NoColorSpace, Vector3 } from 'three'
import type { MarsCoordinate } from '../../../domain'
import type { GroundImagery } from '../surfaceDetail'
import type { GroundImageryStatus } from './groundStatus'
import {
  blockMeets,
  blockShift,
  blockTiles,
  nearBlock,
  nearUvMap,
  NEAR_RECENTRE_M,
  sameBlock,
  type NearBlock,
} from './nearField'
import { toCoordinate, type PatchFrame } from './surfacePatch'

/** The shader's near-field inputs (groundMaterial.ts); `uNearOn` is 0 while there is none. */
export interface NearUniforms {
  uNear: { value: CanvasTexture }
  uNearU: { value: Vector3 }
  uNearV: { value: Vector3 }
  uNearOn: { value: number }
}

interface Walker {
  /** The patch on screen: its frame, and the near-field mosaic it was built with (groundPatch.ts). */
  active: { frame: PatchFrame; near: GroundImagery | null } | null
  xM: number
  yM: number
}

/**
 * The near-field ground image: the finest mosaic's tiles in a block
 * of about 650 m around the walker, at its finest zoom (HiRISE, 0.32 m/px),
 * for the ground shader to lay over the 40 km patch. The block follows the
 * walker: past NEAR_RECENTRE_M from its centre a new block is centred on
 * them, the tiles the two share are copied across and only the rest are
 * loaded. Outside the mosaic's box nothing loads and the shader is off.
 * The mosaic is the one the patch on screen was built with, so a layer
 * switch reaches the near field with the next patch, as it reaches the
 * ground, and never blends HiRISE into a data layer's colours.
 *
 * Two canvases take turns, so the one on screen is never cleared under the
 * walker. Disposal: loads in flight are aborted on a move and on unmount,
 * every bitmap is closed, and the texture is disposed on unmount.
 */
export function useNearField(
  rig: RefObject<Walker>,
  onStatus: (status: GroundImageryStatus | null) => void,
): NearUniforms {
  // 1 px until a block needs them (startBlock sizes them), so no memory is
  // taken where there is no near field.
  const canvases = useMemo(() => [makeCanvas(1), makeCanvas(1)] as const, [])
  const uniforms = useMemo<NearUniforms>(() => {
    const texture = new CanvasTexture(canvases[0])
    // Grey brightness values, read as they are; premultiplied so the
    // transparent pixels where HiRISE took no image do not darken their edges.
    texture.colorSpace = NoColorSpace
    texture.premultiplyAlpha = true
    return {
      uNear: { value: texture },
      uNearU: { value: new Vector3() },
      uNearV: { value: new Vector3() },
      uNearOn: { value: 0 },
    }
  }, [canvases])
  useEffect(() => () => uniforms.uNear.value.dispose(), [uniforms])

  const state = useRef<NearState>({
    canvases,
    uniforms,
    source: null,
    block: null,
    front: 0,
    drawn: new Map(),
    loads: null,
    frame: null,
    centre: { xM: 0, yM: 0 },
  })
  const report = useRef(onStatus)
  useEffect(() => {
    report.current = onStatus
  }, [onStatus])
  useEffect(() => {
    const s = state.current
    return () => reset(s)
  }, [])

  useFrame(() => {
    const r = rig.current
    const s = state.current
    const source = r.active?.near ?? null
    // A new mosaic, or none (another layer, or outside every near-field source's list), starts over.
    if (source !== s.source) {
      reset(s)
      s.source = source
      if (!source) report.current(null)
    }
    if (!source || !r.active) return
    const frame = r.active.frame
    const moved = s.frame === null || Math.hypot(r.xM - s.centre.xM, r.yM - s.centre.yM) > NEAR_RECENTRE_M
    if (moved) {
      const at = toCoordinate(frame, r.xM / 1000, r.yM / 1000)
      const block = nearBlock(at, source.detail.maxZoom)
      if (!sameBlock(s.block, block)) startBlock(s, block, at, source, report.current)
    }
    // A patch swap changes the frame the shader's metres are in.
    if (moved || s.frame !== frame) fit(s, frame)
  })

  return uniforms
}

interface NearState {
  canvases: readonly [HTMLCanvasElement, HTMLCanvasElement]
  uniforms: NearUniforms
  /** The mosaic the block is drawn from. */
  source: GroundImagery | null
  block: NearBlock | null
  /** Which canvas the texture shows. */
  front: number
  /** Tiles, as "x/y" within the block, settled in the front canvas: true if drawn, false if empty in the mosaic. */
  drawn: Map<string, boolean>
  loads: AbortController | null
  /** The frame the uniforms were fitted to, and the block centre in it. */
  frame: PatchFrame | null
  centre: { xM: number; yM: number }
}

/** Stops every load and forgets the block; the shader is off until the next. */
function reset(s: NearState) {
  s.loads?.abort()
  s.loads = null
  s.block = null
  s.frame = null
  s.drawn.clear()
  s.uniforms.uNearOn.value = 0
}

/** Fits the shader's texture mapping to `frame`, the active patch's. */
function fit(s: NearState, frame: PatchFrame) {
  s.frame = frame
  if (!s.block) return
  const map = nearUvMap(frame, s.block.bounds)
  s.uniforms.uNearU.value.set(...map.u)
  s.uniforms.uNearV.value.set(...map.v)
  s.centre = map.centre
}

/**
 * Moves the near field to `block`: the tiles it shares with the last one
 * are copied across in the back canvas, which then goes on screen, and the
 * rest load into it, nearest first.
 */
function startBlock(
  s: NearState,
  block: NearBlock,
  at: MarsCoordinate,
  source: GroundImagery,
  onStatus: (status: GroundImageryStatus | null) => void,
) {
  s.loads?.abort()
  s.loads = null
  const prev = s.block
  s.block = block
  if (!blockMeets(block, source.coverage)) {
    s.drawn.clear()
    s.uniforms.uNearOn.value = 0
    onStatus(null)
    return
  }
  // Draw into the back canvas: the shared tiles first, copied from the front.
  const front = s.canvases[s.front]
  const back = s.canvases[1 - s.front]
  const ctx = back.getContext('2d')
  if (!ctx) {
    s.uniforms.uNearOn.value = 0
    onStatus(null)
    return
  }
  const tilePx = source.tilePx
  const size = tilePx * block.n
  // Setting the size clears the canvas; a front of another size holds nothing to keep.
  if (back.width !== size) back.width = back.height = size
  else ctx.clearRect(0, 0, size, size)
  // The front holds tiles only while `drawn` names some: after a block outside the box it is stale.
  const shift = prev && s.drawn.size > 0 && front.width === size ? blockShift(prev, block) : null
  const kept = new Map<string, boolean>()
  if (shift) {
    ctx.drawImage(front, -shift.dx * tilePx, -shift.dy * tilePx)
    for (const [key, drew] of s.drawn) {
      const [x, y] = key.split('/').map(Number)
      const nx = x - shift.dx
      const ny = y - shift.dy
      if (nx >= 0 && ny >= 0 && nx < block.n && ny < block.n) kept.set(`${nx}/${ny}`, drew)
    }
  }
  s.front = 1 - s.front
  s.drawn = kept
  const texture = s.uniforms.uNear.value
  // The GPU's storage is allocated once per size: a new size needs a new one.
  if (front.width !== size) texture.dispose()
  texture.image = back
  texture.needsUpdate = true
  s.uniforms.uNearOn.value = 1

  const tiles = blockTiles(block, source.coverage, at)
  const missing = tiles.filter((t) => !kept.has(`${t.x}/${t.y}`))
  const status = { imagery: source, zoom: block.zoom, total: tiles.length }
  // Settled: no row when every tile is a gap in the footprint, since nothing of it shows.
  const settled = () => (drewAny(s.drawn) || s.drawn.size < tiles.length ? { ...status, loaded: s.drawn.size } : null)
  if (missing.length === 0) {
    onStatus(settled())
    return
  }
  onStatus({ ...status, loaded: null })

  const controller = new AbortController()
  s.loads = controller
  const signal = controller.signal
  // Tiles landing in one frame share one upload.
  let queued = false
  const upload = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      if (!signal.aborted) texture.needsUpdate = true
    })
  }
  void Promise.all(
    missing.map(({ tile, x, y }) =>
      source.detail.loadTile(tile.zoom, tile.row, tile.col, signal).then((result) => {
        // A gap in the footprint: nothing to draw, and nothing failed.
        if (result.status === 'empty') {
          if (!signal.aborted) s.drawn.set(`${x}/${y}`, false)
          return
        }
        if (result.status !== 'ready') return
        if (!signal.aborted) {
          ctx.drawImage(result.image, x * tilePx, y * tilePx, tilePx, tilePx)
          s.drawn.set(`${x}/${y}`, true)
          upload()
        }
        result.image.close()
      }),
    ),
  ).then(() => {
    if (!signal.aborted) onStatus(settled())
  })
}

function drewAny(drawn: Map<string, boolean>): boolean {
  for (const drew of drawn.values()) if (drew) return true
  return false
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}
