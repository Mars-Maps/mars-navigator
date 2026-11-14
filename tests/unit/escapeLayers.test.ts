import { describe, expect, it } from 'vitest'
import { createEscapeLayers, type EscapeEvent } from '../../src/lib/escapeLayers'

const press = (key = 'Escape', defaultPrevented = false): EscapeEvent => {
  const e = {
    key,
    defaultPrevented,
    preventDefault() {
      e.defaultPrevented = true
    },
  }
  return e
}

/**
 * Stands in for a component: opening pushes a layer, closing removes it,
 * as `useEscapeLayer` does when its `active` flag flips.
 */
const opener = (layers: ReturnType<typeof createEscapeLayers>, closed: string[]) => {
  const open = new Map<string, () => void>()
  const close = (name: string) => {
    open.get(name)?.()
    open.delete(name)
    closed.push(name)
  }
  return (name: string) => {
    open.set(name, layers.push(() => close(name)))
  }
}

describe('escape layers', () => {
  it('closes only the most recently opened layer per press', () => {
    const layers = createEscapeLayers()
    const closed: string[] = []
    const open = opener(layers, closed)
    open('tool')
    open('sub-panel')

    layers.handle(press())
    expect(closed).toEqual(['sub-panel'])
    layers.handle(press())
    expect(closed).toEqual(['sub-panel', 'tool'])
    expect(layers.size).toBe(0)
  })

  it('closes the time menu first when the sub-panel was opened before it', () => {
    const layers = createEscapeLayers()
    const closed: string[] = []
    const open = opener(layers, closed)
    open('sub-panel')
    open('time menu')

    layers.handle(press())
    expect(closed).toEqual(['time menu'])
    layers.handle(press())
    expect(closed).toEqual(['time menu', 'sub-panel'])
  })

  it('closes the sub-panel first when it was opened after the time menu', () => {
    const layers = createEscapeLayers()
    const closed: string[] = []
    const open = opener(layers, closed)
    open('time menu')
    open('sub-panel')

    layers.handle(press())
    expect(closed).toEqual(['sub-panel'])
  })

  // Standing on the surface is a layer from entry to exit.
  it('closes the time menu before leaving the surface when it was opened while standing', () => {
    const layers = createEscapeLayers()
    const closed: string[] = []
    const open = opener(layers, closed)
    open('surface')
    open('time menu')

    layers.handle(press())
    expect(closed).toEqual(['time menu'])
    layers.handle(press())
    expect(closed).toEqual(['time menu', 'surface'])
    expect(layers.size).toBe(0)
  })

  it('leaves the surface first, and only that, when the time menu was open before entering', () => {
    const layers = createEscapeLayers()
    const closed: string[] = []
    const open = opener(layers, closed)
    open('time menu')
    open('surface')

    layers.handle(press())
    expect(closed).toEqual(['surface'])
    expect(layers.size).toBe(1)
  })

  it('skips a layer removed from the middle', () => {
    const layers = createEscapeLayers()
    const calls: string[] = []
    layers.push(() => calls.push('a'))
    const removeB = layers.push(() => calls.push('b'))
    const removeC = layers.push(() => calls.push('c'))
    removeB()
    removeC()

    layers.handle(press())
    expect(calls).toEqual(['a'])
  })

  it('puts a layer back on top when it opens again', () => {
    const layers = createEscapeLayers()
    const calls: string[] = []
    const removeA = layers.push(() => calls.push('a'))
    layers.push(() => calls.push('b'))
    removeA()
    layers.push(() => calls.push('a'))

    layers.handle(press())
    expect(calls).toEqual(['a'])
  })

  it('removes only its own entry when the same callback is pushed twice', () => {
    const layers = createEscapeLayers()
    const cb = () => undefined
    const first = layers.push(cb)
    layers.push(cb)
    first()
    first()
    expect(layers.size).toBe(1)
  })

  it('marks the press handled when it closes a layer', () => {
    const layers = createEscapeLayers()
    layers.push(() => undefined)
    const e = press()
    expect(layers.handle(e)).toBe(true)
    expect(e.defaultPrevented).toBe(true)
  })

  it('leaves a press something else already handled', () => {
    const layers = createEscapeLayers()
    let calls = 0
    layers.push(() => calls++)
    expect(layers.handle(press('Escape', true))).toBe(false)
    expect(calls).toBe(0)
  })

  it('ignores other keys', () => {
    const layers = createEscapeLayers()
    let calls = 0
    layers.push(() => calls++)
    const e = press('Enter')
    expect(layers.handle(e)).toBe(false)
    expect(e.defaultPrevented).toBe(false)
    expect(calls).toBe(0)
  })

  it('does nothing, and does not mark the press, with no layer open', () => {
    const layers = createEscapeLayers()
    const e = press()
    expect(layers.handle(e)).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })
})
