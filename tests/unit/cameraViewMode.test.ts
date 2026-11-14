import { beforeEach, describe, expect, it } from 'vitest'
import { unavailable } from '../../src/domain'
import { useMissionStore } from '../../src/state'

const store = useMissionStore
const view = (altitudeKm: number) => ({
  altitudeKm,
  target: { latitude: 0, longitudeEast: 0 },
  headingDeg: unavailable<number>('not under test'),
})

describe('setCameraView', () => {
  beforeEach(() => {
    store.setState({ viewMode: 'welcome', introDismissed: false, camera: null })
  })

  it('stores the view', () => {
    const v = view(7000)
    store.getState().setCameraView(v)
    expect(store.getState().camera).toEqual(v)
  })

  it('never changes the mode by altitude: the shell decides', () => {
    store.getState().setCameraView(view(1500))
    expect(store.getState().viewMode).toBe('welcome')
    store.setState({ viewMode: 'close-up', introDismissed: true })
    store.getState().setCameraView(view(25000))
    expect(store.getState().viewMode).toBe('close-up')
    expect(store.getState().introDismissed).toBe(true)
  })

  it('leaves navigation alone whatever the altitude', () => {
    store.setState({ viewMode: 'navigation', introDismissed: true })
    store.getState().setCameraView(view(100))
    store.getState().setCameraView(view(25000))
    expect(store.getState().viewMode).toBe('navigation')
    expect(store.getState().introDismissed).toBe(true)
  })
})
