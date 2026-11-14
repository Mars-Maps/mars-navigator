import { beforeEach, describe, expect, it } from 'vitest'
import { useMissionStore } from '../../src/state'

const store = useMissionStore

describe('introDismissed', () => {
  beforeEach(() => {
    store.setState({ viewMode: 'welcome', introDismissed: false })
  })

  it('starts visible and is hidden by dismissIntro', () => {
    expect(store.getState().introDismissed).toBe(false)
    store.getState().dismissIntro()
    expect(store.getState().introDismissed).toBe(true)
  })

  it('comes back when the view returns to welcome', () => {
    store.getState().dismissIntro()
    store.getState().setViewMode('close-up')
    expect(store.getState().introDismissed).toBe(true)
    store.getState().setViewMode('welcome')
    expect(store.getState().introDismissed).toBe(false)
  })

  it('stays dismissed when welcome is set again from welcome', () => {
    store.getState().dismissIntro()
    store.getState().setViewMode('welcome')
    expect(store.getState().introDismissed).toBe(true)
  })

  it('stays dismissed when a move to welcome is not allowed', () => {
    store.setState({ viewMode: 'navigation', introDismissed: true })
    store.getState().setViewMode('welcome')
    expect(store.getState().viewMode).toBe('navigation')
    expect(store.getState().introDismissed).toBe(true)
  })
})
