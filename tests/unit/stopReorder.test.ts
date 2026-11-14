import { describe, expect, it } from 'vitest'
import { dropTarget, insertionPoint } from '../../src/features/mission-ui/stopReorder'

describe('insertionPoint', () => {
  it('points above a row from its top half and below it from its bottom half', () => {
    expect(insertionPoint(2, true)).toBe(2)
    expect(insertionPoint(2, false)).toBe(3)
  })
})

describe('dropTarget', () => {
  // Four stops: gaps 0..4.
  it('moves a stop down past the rows between', () => {
    expect(dropTarget(0, 4, 4)).toBe(3) // to the end
    expect(dropTarget(0, 2, 4)).toBe(1) // between rows 1 and 2
  })

  it('moves a stop up', () => {
    expect(dropTarget(3, 0, 4)).toBe(0) // to the start
    expect(dropTarget(3, 2, 4)).toBe(2)
  })

  it('does nothing when dropped just above or below itself', () => {
    expect(dropTarget(1, 1, 4)).toBeNull()
    expect(dropTarget(1, 2, 4)).toBeNull()
  })

  it('ignores indices outside the list', () => {
    expect(dropTarget(-1, 0, 4)).toBeNull()
    expect(dropTarget(4, 0, 4)).toBeNull()
    expect(dropTarget(0, 5, 4)).toBeNull()
    expect(dropTarget(0, -1, 4)).toBeNull()
  })

  it('cannot move the only stop', () => {
    expect(dropTarget(0, 0, 1)).toBeNull()
    expect(dropTarget(0, 1, 1)).toBeNull()
  })
})
