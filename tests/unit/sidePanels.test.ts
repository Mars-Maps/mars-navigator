import { beforeEach, describe, expect, it } from 'vitest'
import { useMissionStore } from '../../src/state'

const open = () => useMissionStore.getState().openSidePanels
const toggle = useMissionStore.getState().toggleSidePanel
const close = useMissionStore.getState().closeSidePanel

describe('icon-panel sub-panels in the store', () => {
  beforeEach(() => {
    useMissionStore.setState({ openSidePanels: { layers: false, compass: false } })
  })

  it('starts with both closed', () => {
    expect(open()).toEqual({ layers: false, compass: false })
  })

  it('opens the layer menu and the compass together', () => {
    toggle('layers')
    toggle('compass')
    expect(open()).toEqual({ layers: true, compass: true })
  })

  it('closes one without touching the other', () => {
    toggle('layers')
    toggle('compass')
    toggle('layers')
    expect(open()).toEqual({ layers: false, compass: true })
    toggle('compass')
    expect(open()).toEqual({ layers: false, compass: false })
  })

  it('gives a new object on each toggle, so selectors see the change', () => {
    const before = open()
    toggle('compass')
    expect(open()).not.toBe(before)
    expect(before).toEqual({ layers: false, compass: false })
  })

  it('closes only the named panel, and closing twice never reopens it', () => {
    toggle('layers')
    toggle('compass')
    close('compass')
    expect(open()).toEqual({ layers: true, compass: false })
    close('compass')
    expect(open()).toEqual({ layers: true, compass: false })
  })

  it('leaves the state untouched when the panel is already closed', () => {
    const before = useMissionStore.getState()
    close('layers')
    expect(useMissionStore.getState()).toBe(before)
  })
})
