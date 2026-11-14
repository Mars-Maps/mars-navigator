import { describe, expect, it } from 'vitest'
import { focusAfterClose } from '../../src/features/mission-ui/tools/dockFocus'

describe('focusAfterClose', () => {
  it("gives focus back to the closed tool's button when the panel closed with focus inside it", () => {
    expect(focusAfterClose('rover-photos', null, true)).toBe('rover-photos')
  })

  it('leaves focus alone when it was outside the panel, as when the dock button closes it', () => {
    expect(focusAfterClose('rover-photos', null, false)).toBeNull()
  })

  it('leaves focus alone when another tool opens, or one opens from none', () => {
    expect(focusAfterClose('rover-photos', 'terrain-profile', true)).toBeNull()
    expect(focusAfterClose(null, 'rover-photos', true)).toBeNull()
  })
})
