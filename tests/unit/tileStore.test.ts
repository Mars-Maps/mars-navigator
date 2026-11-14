import { describe, expect, it } from 'vitest'
import { derived } from '../../src/domain'
import type { SurfaceDetail, SurfaceTileResult } from '../../src/features/mars-3d/surfaceDetail'
import { tileKey, type TileIndex } from '../../src/features/mars-3d/tilePyramid'
import { RETRY_AFTER_MS, TileStore } from '../../src/features/mars-3d/tileStore'

/** A loader whose promises the test settles by hand. */
function fakeDetail(maxZoom = 7) {
  const pending = new Map<string, { resolve: (r: SurfaceTileResult) => void; signal: AbortSignal }>()
  const order: string[] = []
  const detail: SurfaceDetail = {
    layerId: 'satellite',
    maxZoom,
    loadTile: (zoom, row, col, signal) =>
      new Promise<SurfaceTileResult>((resolve) => {
        const key = tileKey({ zoom, row, col })
        order.push(key)
        pending.set(key, { resolve, signal })
      }),
    resolutionAt: (z) => derived(`z${z}`, 'fixture'),
  }
  const bitmap = (key: string) => {
    const b = { key, closed: false, close: () => void (b.closed = true) }
    return b as unknown as ImageBitmap & { closed: boolean }
  }
  const finish = (key: string) => {
    const p = pending.get(key)!
    const image = bitmap(key)
    p.resolve({ status: 'ready', image })
    pending.delete(key)
    return image
  }
  const fail = (key: string, status: 'empty' | 'error', retryable = false) => {
    const p = pending.get(key)!
    p.resolve(status === 'empty' ? { status } : { status, reason: 'fixture', retryable })
    pending.delete(key)
  }
  return { detail, pending, order, finish, fail }
}

const tile = (zoom: number, row: number, col: number): TileIndex => ({ zoom, row, col })
const tiles = (zoom: number, n: number) => Array.from({ length: n }, (_, i) => tile(zoom, 0, i))

function makeFactory() {
  const disposed: string[] = []
  const make = (t: TileIndex) => ({
    key: tileKey(t),
    dispose() {
      disposed.push(tileKey(t))
    },
  })
  return { make, disposed }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('TileStore', () => {
  it('loads nearest first, no more than the concurrency at once', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 2)
    store.update({ zoom: 4, tiles: tiles(4, 5) })
    expect(f.order).toEqual(['4/0/0', '4/0/1'])
    expect(store.loading).toBe(2)
    f.finish('4/0/0')
    await tick()
    expect(f.order).toEqual(['4/0/0', '4/0/1', '4/0/2'])
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['4/0/0'])
  })

  it('shows only wanted ready tiles, in wanted order, and keeps the snapshot stable', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 6)
    let notified = 0
    store.subscribe(() => notified++)
    store.update({ zoom: 4, tiles: tiles(4, 3) })
    const before = store.getSnapshot()
    f.finish('4/0/2')
    f.finish('4/0/0')
    await tick()
    const snap = store.getSnapshot()
    expect(snap.map((s) => s.key)).toEqual(['4/0/0', '4/0/2'])
    expect(notified).toBe(2)
    expect(snap).not.toBe(before)
    // Nothing changed: the same array comes back.
    expect(store.getSnapshot()).toBe(snap)
  })

  it('aborts and forgets a loading tile that leaves the view; a late result is closed', async () => {
    const f = fakeDetail()
    const { make, disposed } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 6)
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1)] })
    const p = f.pending.get('4/0/1')!
    store.update({ zoom: 4, tiles: [tile(4, 0, 0)] })
    expect(p.signal.aborted).toBe(true)
    expect(store.size).toBe(1)
    const image = f.finish('4/0/1')
    await tick()
    expect(image.closed).toBe(true)
    expect(disposed).toEqual([])
    expect(store.getSnapshot()).toEqual([])
  })

  it('keeps a finished tile that leaves the view, and shows it again without reloading', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 6)
    store.update({ zoom: 4, tiles: [tile(4, 0, 0)] })
    f.finish('4/0/0')
    await tick()
    store.update(null)
    expect(store.getSnapshot()).toEqual([])
    store.update({ zoom: 4, tiles: [tile(4, 0, 0)] })
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['4/0/0'])
    expect(f.order).toEqual(['4/0/0'])
  })

  it('records empty and error tiles so they are not asked for again', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 6)
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1)] })
    f.fail('4/0/0', 'empty')
    f.fail('4/0/1', 'error')
    await tick()
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1)] })
    expect(f.order).toEqual(['4/0/0', '4/0/1'])
    expect(store.getSnapshot()).toEqual([])
  })

  it('a throwing factory records an error, closes the bitmap and frees the slot', async () => {
    const f = fakeDetail()
    const make = (t: TileIndex) => {
      if (tileKey(t) === '4/0/0') throw new Error('no GPU')
      return { key: tileKey(t), dispose() {} }
    }
    const store = new TileStore(f.detail, make, 256, 1)
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1)] })
    const bad = f.finish('4/0/0')
    await tick()
    expect(bad.closed).toBe(true)
    expect(store.loading).toBe(1)
    expect(f.order).toEqual(['4/0/0', '4/0/1'])
    f.finish('4/0/1')
    await tick()
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['4/0/1'])
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1)] })
    expect(f.order).toEqual(['4/0/0', '4/0/1'])
  })

  it('asks again for a retryable error once its delay has passed, with a growing delay', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    let clock = 1_000_000
    const store = new TileStore(f.detail, make, 256, 6, () => clock)
    const want = () => store.update({ zoom: 4, tiles: [tile(4, 0, 0)] })
    want()
    f.fail('4/0/0', 'error', true)
    await tick()
    want()
    expect(f.order).toEqual(['4/0/0'])
    clock += RETRY_AFTER_MS[0]
    want()
    expect(f.order).toEqual(['4/0/0', '4/0/0'])
    f.fail('4/0/0', 'error', true)
    await tick()
    clock += RETRY_AFTER_MS[0]
    want()
    expect(f.order).toHaveLength(2)
    clock += RETRY_AFTER_MS[1] - RETRY_AFTER_MS[0]
    want()
    expect(f.order).toHaveLength(3)
    f.finish('4/0/0')
    await tick()
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['4/0/0'])
  })

  it('gives up after the last delay, and never retries a permanent error or an empty row', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    let clock = 0
    const store = new TileStore(f.detail, make, 256, 6, () => clock)
    const want = () => store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1), tile(4, 0, 2)] })
    want()
    f.fail('4/0/0', 'error', true)
    f.fail('4/0/1', 'error', false)
    f.fail('4/0/2', 'empty')
    await tick()
    for (const delay of RETRY_AFTER_MS) {
      clock += delay
      want()
      f.fail('4/0/0', 'error', true)
      await tick()
    }
    expect(f.order.filter((k) => k === '4/0/0')).toHaveLength(RETRY_AFTER_MS.length + 1)
    clock += 10 * 60_000
    want()
    expect(f.order).toHaveLength(RETRY_AFTER_MS.length + 3)
  })

  it('evicts the least recently wanted finished tiles past the cap, disposing them', async () => {
    const f = fakeDetail()
    const { make, disposed } = makeFactory()
    const store = new TileStore(f.detail, make, 3, 10)
    store.update({ zoom: 4, tiles: tiles(4, 3) })
    for (const k of ['4/0/0', '4/0/1', '4/0/2']) f.finish(k)
    await tick()
    // Two new tiles wanted; 0 is still wanted, 1 and 2 are not.
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 1, 0), tile(4, 1, 1)] })
    expect(store.size).toBeLessThanOrEqual(3)
    expect(disposed.sort()).toEqual(['4/0/1', '4/0/2'])
  })

  it('dispose frees everything and ignores later updates', async () => {
    const f = fakeDetail()
    const { make, disposed } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 6)
    store.update({ zoom: 4, tiles: tiles(4, 2) })
    const loading = f.pending.get('4/0/1')!
    const image = f.finish('4/0/0')
    await tick()
    store.dispose()
    expect(disposed).toEqual(['4/0/0'])
    expect(image.closed).toBe(true)
    expect(loading.signal.aborted).toBe(true)
    expect(store.size).toBe(0)
    store.update({ zoom: 4, tiles: tiles(4, 2) })
    expect(f.order).toEqual(['4/0/0', '4/0/1'])
  })

  it('activate after dispose loads again, as StrictMode re-runs the effect', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 6)
    store.update({ zoom: 4, tiles: tiles(4, 1) })
    const stale = f.pending.get('4/0/0')!
    store.dispose()
    store.activate()
    store.update({ zoom: 4, tiles: tiles(4, 1) })
    expect(f.order).toEqual(['4/0/0', '4/0/0'])

    // The load from before the dispose settles late: it is not ours.
    const staleImage = { closed: false, close: () => void (staleImage.closed = true) }
    stale.resolve({ status: 'ready', image: staleImage as unknown as ImageBitmap })
    await tick()
    expect(staleImage.closed).toBe(true)
    expect(store.getSnapshot()).toEqual([])

    f.finish('4/0/0')
    await tick()
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['4/0/0'])
    expect(store.loading).toBe(0)
  })

  it('draws the nearest ready coarser tile under wanted tiles still loading', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 10)
    store.update({ zoom: 4, tiles: [tile(4, 2, 3)] })
    f.finish('4/2/3')
    await tick()
    // Zoom in: the four children of 4/2/3 are wanted; the parent stands in.
    const children = [tile(5, 4, 6), tile(5, 4, 7), tile(5, 5, 6), tile(5, 5, 7)]
    store.update({ zoom: 5, tiles: children })
    expect(store.getSnapshot()).toEqual([expect.objectContaining({ key: '4/2/3', fallback: true })])
    f.finish('5/4/6')
    await tick()
    expect(store.getSnapshot().map((s) => [s.key, s.fallback])).toEqual([
      ['5/4/6', false],
      ['4/2/3', true],
    ])
    for (const k of ['5/4/7', '5/5/6', '5/5/7']) f.finish(k)
    await tick()
    expect(store.getSnapshot().every((s) => !s.fallback)).toBe(true)
    expect(store.getSnapshot()).toHaveLength(4)
  })

  it('keeps a stand-in past the cap until the tiles it covers arrive', async () => {
    const f = fakeDetail()
    const { make, disposed } = makeFactory()
    const store = new TileStore(f.detail, make, 4, 10)
    store.update({ zoom: 4, tiles: [tile(4, 2, 3)] })
    f.finish('4/2/3')
    await tick()
    // Zoom in: the parent plus its four loading children is one over the cap.
    const children = [tile(5, 4, 6), tile(5, 4, 7), tile(5, 5, 6), tile(5, 5, 7)]
    store.update({ zoom: 5, tiles: children })
    expect(disposed).toEqual([])
    expect(store.getSnapshot()).toEqual([expect.objectContaining({ key: '4/2/3', fallback: true })])
    for (const k of ['5/4/6', '5/4/7', '5/5/6']) f.finish(k)
    await tick()
    expect(store.getSnapshot().map((s) => [s.key, s.fallback])).toEqual([
      ['5/4/6', false],
      ['5/4/7', false],
      ['5/5/6', false],
      ['4/2/3', true],
    ])
    f.finish('5/5/7')
    await tick()
    // No longer standing in, the parent is the one to go at the next update.
    store.update({ zoom: 5, tiles: children })
    expect(disposed).toEqual(['4/2/3'])
    expect(store.getSnapshot().every((s) => !s.fallback)).toBe(true)
  })

  it('looks past a missing parent to a coarser ancestor, and not at all for an empty row', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    const store = new TileStore(f.detail, make, 256, 10)
    store.update({ zoom: 3, tiles: [tile(3, 1, 1)] })
    f.finish('3/1/1')
    await tick()
    store.update({ zoom: 5, tiles: [tile(5, 4, 4), tile(5, 7, 7)] })
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['3/1/1'])
    f.fail('5/4/4', 'empty')
    await tick()
    // 5/7/7 still loading keeps the stand-in; the empty one asks for none.
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['3/1/1'])
    f.fail('5/7/7', 'empty')
    await tick()
    expect(store.getSnapshot()).toEqual([])
  })

  it('retries a failed tile when its delay runs out, with no new update', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    let clock = 0
    const timers: { run: () => void; at: number; cancelled: boolean }[] = []
    const setTimer = (run: () => void, ms: number) => {
      const t = { run, at: clock + ms, cancelled: false }
      timers.push(t)
      return () => void (t.cancelled = true)
    }
    const store = new TileStore(f.detail, make, 256, 6, () => clock, setTimer)
    store.update({ zoom: 4, tiles: [tile(4, 0, 0)] })
    f.fail('4/0/0', 'error', true)
    await tick()
    expect(timers).toHaveLength(1)
    clock = timers[0].at
    timers[0].run()
    expect(f.order).toEqual(['4/0/0', '4/0/0'])
    f.finish('4/0/0')
    await tick()
    expect(store.getSnapshot().map((s) => s.key)).toEqual(['4/0/0'])
  })

  it('does not retry a tile that left the view, and dispose cancels pending retries', async () => {
    const f = fakeDetail()
    const { make } = makeFactory()
    let clock = 0
    const timers: { run: () => void; at: number; cancelled: boolean }[] = []
    const setTimer = (run: () => void, ms: number) => {
      const t = { run, at: clock + ms, cancelled: false }
      timers.push(t)
      return () => void (t.cancelled = true)
    }
    const store = new TileStore(f.detail, make, 256, 6, () => clock, setTimer)
    store.update({ zoom: 4, tiles: [tile(4, 0, 0), tile(4, 0, 1)] })
    f.fail('4/0/0', 'error', true)
    f.fail('4/0/1', 'error', true)
    await tick()
    store.update({ zoom: 4, tiles: [tile(4, 0, 1)] })
    clock = timers[0].at
    timers[0].run()
    expect(f.order.filter((k) => k === '4/0/0')).toHaveLength(1)
    store.dispose()
    expect(timers[1].cancelled).toBe(true)
  })
})
