import { describe, expect, it } from 'vitest'
import { focusToReturn, type FocusReturnTarget } from '../../src/lib/useReturnFocus'

// Stand-ins for the page's elements; the rule only compares and asks the popup.
const target = (isConnected = true): FocusReturnTarget => ({ isConnected, focus: () => {} })
const BODY = { name: 'body' }
const ITEM = { name: 'chooser item' }
const OTHER = { name: 'another field' }
const inPopup = (n: unknown) => n === ITEM

describe('focusToReturn', () => {
  it('gives focus back to the opener while it is still in the popup', () => {
    const opener = target()
    expect(focusToReturn(opener, ITEM, BODY, inPopup)).toBe(opener)
  })

  it('gives it back once the focused item is removed and focus has fallen to the body', () => {
    const opener = target()
    expect(focusToReturn(opener, BODY, BODY, inPopup)).toBe(opener)
    expect(focusToReturn(opener, null, BODY, inPopup)).toBe(opener)
  })

  it('leaves focus on another control a click moved it to', () => {
    expect(focusToReturn(target(), OTHER, BODY, inPopup)).toBeNull()
  })

  it('gives nothing to an opener that has left the page (the right-click menu’s item)', () => {
    expect(focusToReturn(target(false), ITEM, BODY, inPopup)).toBeNull()
  })

  it('gives nothing when nothing had focus, or the opener has it already', () => {
    expect(focusToReturn(null, ITEM, BODY, inPopup)).toBeNull()
    const opener = target()
    expect(focusToReturn(opener, opener, BODY, inPopup)).toBeNull()
  })
})
