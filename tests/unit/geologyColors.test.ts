import { describe, expect, it } from 'vitest'
import { parseLegend } from '../../src/data/adapters/GeologyAdapter'
import { unitColor } from '../../src/features/mars-3d/geologyColors'
import { SIM_3464_LAYER } from '../fixtures/sim3464Legend'
import { SIM_3464_UNIT_NAMES } from '../fixtures/sim3464UnitNames'

// Test fixture only: the map's data here is the recorded service answer.
const MAP = { id: 'fixture', title: 'fixture', scaleDenominator: 1, citation: 'fixture' }
const unit = (color?: string) => ({ symbol: 'X', name: 'fixture', map: MAP, ...(color ? { color } : {}) })

describe('the map\'s published colours', () => {
  it('reads one colour for each of the map\'s 14 units, all different', () => {
    const legend = parseLegend(SIM_3464_LAYER, 'unit')
    expect(legend?.size).toBe(new Set(SIM_3464_UNIT_NAMES.map((u) => u.symbol)).size)
    expect(new Set(legend?.values()).size).toBe(14)
    expect(legend?.get('2')).toBe('#eb4d80')
  })

  it('is null for anything but that renderer, never a guessed colour', () => {
    expect(parseLegend({}, 'unit')).toBeNull()
    expect(parseLegend(SIM_3464_LAYER, 'other')).toBeNull()
    expect(parseLegend({ drawingInfo: { renderer: { field1: 'unit', uniqueValueInfos: [{ value: 'a', symbol: { color: [300, 0, 0] } }] } } }, 'unit')).toBeNull()
  })

  it('draws the unit in the map\'s colour, and grey without one', () => {
    expect(unitColor(unit('#eb4d80')).getHexString()).toBe(unitColor(unit('#eb4d80')).getHexString())
    expect(unitColor(unit('#eb4d80')).equals(unitColor(unit()))).toBe(false)
    expect(unitColor(unit()).equals(unitColor(unit()))).toBe(true)
  })
})
