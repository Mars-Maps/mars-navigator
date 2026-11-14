import { describe, expect, it } from 'vitest'
import { stepPage } from '../../src/features/mission-ui/pageStep'

describe('stepPage', () => {
  it('steps forward and back inside the range', () => {
    expect(stepPage(0, 1, 6)).toBe(1)
    expect(stepPage(3, -1, 6)).toBe(2)
  })

  it('wraps at both ends', () => {
    expect(stepPage(5, 1, 6)).toBe(0)
    expect(stepPage(0, -1, 6)).toBe(5)
  })

  it('wraps steps longer than the range', () => {
    expect(stepPage(2, 13, 6)).toBe(3)
    expect(stepPage(2, -13, 6)).toBe(1)
  })

  it('stays on the only page, and gives page 0 when there are none', () => {
    expect(stepPage(0, 1, 1)).toBe(0)
    expect(stepPage(0, -1, 1)).toBe(0)
    expect(stepPage(0, 1, 0)).toBe(0)
  })
})
