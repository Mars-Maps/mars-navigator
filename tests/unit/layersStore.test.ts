import { beforeEach, describe, expect, it } from 'vitest'
import type { MapLayer } from '../../src/domain'
import { useMissionStore } from '../../src/state'

// Test fixtures only: invented provenance, never shown in the app.
const FIXTURE: MapLayer[] = [
  {
    id: 'satellite',
    label: 'Fixture satellite',
    classification: 'SIMULATED',
    source: 'test fixture',
    provider: 'fixture provider',
    licence: 'test fixture',
    caveat: 'Colourized, not true colour',
    previewUrl: null,
    legend: { kind: 'none', reason: 'fixture: no legend' },
  },
  {
    id: 'elevation',
    label: 'Fixture elevation',
    classification: 'SIMULATED',
    source: 'test fixture',
    provider: 'fixture provider',
    licence: 'test fixture',
    caveat: null,
    previewUrl: null,
    legend: { kind: 'none', reason: 'fixture: no legend' },
  },
]

describe('layers in the store', () => {
  beforeEach(() => {
    useMissionStore.setState({ layers: [], activeLayerId: 'satellite' })
  })

  it('starts empty, so a menu can say the layers are not loaded', () => {
    expect(useMissionStore.getState().layers).toEqual([])
  })

  it('setLayers replaces the list and leaves the active layer alone', () => {
    const { setLayers, setActiveLayer } = useMissionStore.getState()
    setActiveLayer('thermal')
    setLayers(FIXTURE)
    expect(useMissionStore.getState().layers).toBe(FIXTURE)
    expect(useMissionStore.getState().activeLayerId).toBe('thermal')
    setLayers([])
    expect(useMissionStore.getState().layers).toEqual([])
  })
})
