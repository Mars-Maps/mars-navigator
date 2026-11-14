import { describe, expect, it } from 'vitest'
import { useMissionStore } from '../../src/state'

describe('sun shading toggle', () => {
  it('is on when the app starts', () => {
    expect(useMissionStore.getInitialState().sunShading).toBe(true)
  })

  it('flips each time the menu item is used', () => {
    useMissionStore.setState({ sunShading: true })
    useMissionStore.getState().toggleSunShading()
    expect(useMissionStore.getState().sunShading).toBe(false)
    useMissionStore.getState().toggleSunShading()
    expect(useMissionStore.getState().sunShading).toBe(true)
  })
})
