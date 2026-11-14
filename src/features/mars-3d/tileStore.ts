import type { SurfaceDetail } from './surfaceDetail'
import { tileKey, type TileIndex } from './tilePyramid'

/**
 * The detail-tile cache behind SurfaceTiles: what is wanted, what
 * is loading, what is ready, and what to draw. An external store for
 * React (subscribe / getSnapshot), with the GPU objects made by an
 * injected factory so the logic runs and tests without WebGL.
 *
 * Rules: tiles are fetched nearest first, at most CONCURRENCY at a time;
 * a tile that leaves the view while loading is aborted and forgotten; a
 * finished tile stays cached up to `cap`, after which the least recently
 * wanted go, each disposed. A layer change is a new store. A retryable
 * error (network, server) is asked for again after a growing delay,
 * RETRY_AFTER_MS per attempt, then given up: when its delay runs out while
 * it is still wanted, or when next wanted after that. An empty row
 * or a permanent error is never asked for again.
 *
 * Until a wanted tile is ready, the nearest coarser tile covering it that
 * is cached and ready is drawn instead, marked `fallback`, so zooming in
 * never opens a hole down to the whole-globe image.
 */

/** Delay before the n-th retry of a failed tile; after the last, the tile is given up. */
export const RETRY_AFTER_MS = [5_000, 20_000, 60_000]
const RETRY_SLACK_MS = 50

/** GPU-side objects for one tile; disposed together. */
export interface TileResources {
  dispose(): void
}

export interface ShownTile<R extends TileResources = TileResources> {
  key: string
  resources: R
  /** A coarser tile standing in for wanted ones still loading; draw it under them. */
  fallback: boolean
}

/** Starts a timer; returns its cancel. Injected so tests control time. */
export type SetTimer = (run: () => void, ms: number) => () => void

const realTimer: SetTimer = (run, ms) => {
  const id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

type Entry<R extends TileResources> =
  | { status: 'loading'; tile: TileIndex; controller: AbortController; wanted: number; attempts: number }
  | { status: 'ready'; tile: TileIndex; resources: R; image: ImageBitmap; lastWanted: number; wanted: number }
  | { status: 'empty'; tile: TileIndex; wanted: number }
  /** `retryAt` is a clock reading, or Infinity when the tile is given up. */
  | { status: 'error'; tile: TileIndex; wanted: number; attempts: number; retryAt: number }

export interface Wanted {
  zoom: number
  tiles: TileIndex[]
}

const EMPTY: ShownTile<never>[] = []

export class TileStore<R extends TileResources = TileResources> {
  private readonly entries = new Map<string, Entry<R>>()
  private queue: TileIndex[] = []
  private inFlight = 0
  private generation = 0
  private wantedKeys: string[] = []
  private wantedTiles: TileIndex[] = []
  private lastWanted: Wanted | null = null
  private readonly timers = new Set<() => void>()
  private snapshot: ShownTile<R>[] = EMPTY
  private listeners = new Set<() => void>()
  private disposed = false
  private readonly detail: SurfaceDetail
  private readonly make: (tile: TileIndex, image: ImageBitmap) => R
  private readonly cap: number
  private readonly concurrency: number
  private readonly now: () => number
  private readonly setTimer: SetTimer
  /** Attempts so far for a tile about to be queued again. */
  private readonly retries = new Map<string, number>()

  constructor(
    detail: SurfaceDetail,
    make: (tile: TileIndex, image: ImageBitmap) => R,
    cap = 256,
    concurrency = 6,
    now: () => number = Date.now,
    setTimer: SetTimer = realTimer,
  ) {
    this.detail = detail
    this.make = make
    this.cap = cap
    this.concurrency = concurrency
    this.now = now
    this.setTimer = setTimer
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The ready tiles among the wanted ones; the same array until something changes. */
  getSnapshot = (): ShownTile<R>[] => this.snapshot

  /** For tests and diagnostics. */
  get size(): number {
    return this.entries.size
  }
  get loading(): number {
    return this.inFlight
  }

  /** The view changed: `wanted` is the new set, nearest first, or null for none. */
  update(wanted: Wanted | null): void {
    if (this.disposed) return
    const gen = ++this.generation
    const keys = wanted ? wanted.tiles.map(tileKey) : []
    const wantedSet = new Set(keys)
    for (const [key, e] of this.entries) {
      if (e.status === 'loading' && !wantedSet.has(key)) {
        e.controller.abort()
        this.entries.delete(key)
      }
    }
    this.queue = []
    this.retries.clear()
    if (wanted) {
      const now = this.now()
      for (const tile of wanted.tiles) {
        const key = tileKey(tile)
        const e = this.entries.get(key)
        if (e?.status === 'error' && e.retryAt <= now) {
          // Its delay has passed: ask again, remembering how often we have.
          this.entries.delete(key)
          this.retries.set(key, e.attempts)
          this.queue.push(tile)
        } else if (e) {
          e.wanted = gen
          if (e.status === 'ready') e.lastWanted = gen
        } else {
          this.queue.push(tile)
        }
      }
    }
    this.wantedKeys = keys
    this.wantedTiles = wanted ? wanted.tiles : []
    this.lastWanted = wanted
    this.evict(gen)
    this.publish()
    this.pump()
  }

  /**
   * Accepts updates again after `dispose`, starting empty. For React
   * StrictMode, which disposes and re-runs an effect on the same store.
   * A load still settling from before is not ours and is dropped.
   */
  activate(): void {
    this.disposed = false
  }

  dispose(): void {
    this.disposed = true
    for (const cancel of this.timers) cancel()
    this.timers.clear()
    for (const e of this.entries.values()) disposeEntry(e)
    this.entries.clear()
    this.queue = []
    this.wantedKeys = []
    this.wantedTiles = []
    this.lastWanted = null
    this.publish()
    this.listeners.clear()
  }

  private pump(): void {
    while (!this.disposed && this.inFlight < this.concurrency && this.queue.length > 0) {
      const tile = this.queue.shift()!
      const key = tileKey(tile)
      const controller = new AbortController()
      const gen = this.generation
      const attempts = this.retries.get(key) ?? 0
      this.retries.delete(key)
      this.entries.set(key, { status: 'loading', tile, controller, wanted: gen, attempts })
      this.inFlight++
      this.detail.loadTile(tile.zoom, tile.row, tile.col, controller.signal).then((result) => {
        this.inFlight--
        const current = this.entries.get(key)
        const stillOurs =
          !this.disposed && current?.status === 'loading' && current.controller === controller
        if (!stillOurs) {
          if (result.status === 'ready') result.image.close()
          this.pump()
          return
        }
        if (result.status === 'ready') {
          // A throwing factory must not wedge the slot: the tile becomes an
          // error entry, the bitmap is closed, and the queue keeps moving.
          let resources: R | null = null
          try {
            resources = this.make(tile, result.image)
          } catch {
            result.image.close()
          }
          if (resources) {
            this.entries.set(key, {
              status: 'ready',
              tile,
              resources,
              image: result.image,
              lastWanted: current.wanted,
              wanted: current.wanted,
            })
            this.publish()
          } else {
            // A GPU-side failure is not the network's: do not retry.
            this.entries.set(key, { status: 'error', tile, wanted: current.wanted, attempts: 0, retryAt: Infinity })
          }
        } else if (result.status === 'empty') {
          this.entries.set(key, { status: 'empty', tile, wanted: current.wanted })
        } else {
          const attempts = current.attempts + 1
          const delay = RETRY_AFTER_MS[attempts - 1]
          const retryAt = result.retryable && delay !== undefined ? this.now() + delay : Infinity
          this.entries.set(key, { status: 'error', tile, wanted: current.wanted, attempts, retryAt })
          if (retryAt !== Infinity) this.retryLater(key, delay!)
        }
        // A stand-in may no longer be needed, or the empty row needs none.
        if (result.status !== 'ready') this.publish()
        this.pump()
      })
    }
  }

  /**
   * Asks again for `key` once its delay has run out, if it is still wanted:
   * a settled view sends no update, so without this a failed tile stayed
   * missing until the camera moved.
   */
  private retryLater(key: string, delayMs: number): void {
    const cancel = this.setTimer(() => {
      this.timers.delete(cancel)
      if (this.disposed || !this.wantedKeys.includes(key)) return
      this.update(this.lastWanted)
      // A timer may fire a little early; the slack keeps the retry due by then.
    }, delayMs + RETRY_SLACK_MS)
    this.timers.add(cancel)
  }

  /** The nearest coarser ready tile covering `tile`, if one is cached. */
  private readyAncestor(tile: TileIndex): { key: string; resources: R } | null {
    for (let up = 1; up <= tile.zoom; up++) {
      const key = tileKey({ zoom: tile.zoom - up, row: tile.row >> up, col: tile.col >> up })
      const e = this.entries.get(key)
      if (e?.status === 'ready') return { key, resources: e.resources }
    }
    return null
  }

  /** The ready coarser tiles standing in for wanted ones not yet ready, each once, in wanted order. */
  private standIns(): { key: string; resources: R }[] {
    const found: { key: string; resources: R }[] = []
    const seen = new Set<string>()
    this.wantedKeys.forEach((key, i) => {
      const status = this.entries.get(key)?.status
      // Nothing to wait for in an empty row.
      if (status === 'ready' || status === 'empty') return
      const parent = this.readyAncestor(this.wantedTiles[i])
      if (parent && !seen.has(parent.key)) {
        seen.add(parent.key)
        found.push(parent)
      }
    })
    return found
  }

  private publish(): void {
    const next: ShownTile<R>[] = []
    for (const key of this.wantedKeys) {
      const e = this.entries.get(key)
      if (e?.status === 'ready') next.push({ key, resources: e.resources, fallback: false })
    }
    for (const parent of this.standIns()) next.push({ ...parent, fallback: true })
    if (sameKeys(next, this.snapshot)) return
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  /**
   * Drops the least recently wanted finished tiles until the cache, with
   * the tiles about to be queued counted in, fits the cap. A stand-in is
   * on screen though not wanted, so it is kept, and the cache may run over
   * the cap until the tiles it covers arrive.
   */
  private evict(gen: number): void {
    const over = () => this.entries.size + this.queue.length > this.cap
    if (!over()) return
    const shown = new Set(this.standIns().map((s) => s.key))
    const candidates = [...this.entries.entries()].filter(
      ([key, e]) => e.wanted !== gen && e.status !== 'loading' && !shown.has(key),
    )
    candidates.sort(([, a], [, b]) => lastWanted(a) - lastWanted(b))
    for (const [key, e] of candidates) {
      if (!over()) break
      disposeEntry(e)
      this.entries.delete(key)
    }
  }
}

function lastWanted<R extends TileResources>(e: Entry<R>): number {
  return e.status === 'ready' ? e.lastWanted : e.wanted
}

function disposeEntry<R extends TileResources>(e: Entry<R>): void {
  if (e.status === 'loading') e.controller.abort()
  if (e.status === 'ready') {
    e.resources.dispose()
    e.image.close()
  }
}

function sameKeys<R extends TileResources>(a: ShownTile<R>[], b: ShownTile<R>[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].resources !== b[i].resources || a[i].fallback !== b[i].fallback) {
      return false
    }
  }
  return true
}
