import { describe, expect, it } from 'vitest'
import {
  leaveOf,
  rowAction,
  type FocusTarget,
  type RowEvent,
} from '../../src/features/mission-ui/rowFocus'

/** The last action that is not 'none', as the row would end up. */
const outcome = (events: RowEvent[]) =>
  events.map(rowAction).filter((a) => a !== 'none').at(-1) ?? 'none'

describe('rowAction ("Add stop sometimes doesn\'t work")', () => {
  it('commits the stop on Enter', () => {
    expect(outcome([{ kind: 'enter' }])).toBe('commit')
  })

  it('commits the stop when focus leaves the row from a field', () => {
    expect(outcome([{ kind: 'leave', from: 'fields', to: 'outside' }])).toBe('commit')
  })

  it('waits while focus moves between X and Y, for every point', () => {
    expect(outcome([{ kind: 'leave', from: 'fields', to: 'fields' }])).toBe('none')
  })

  // The reported bug, reproduced in the browser: type a stop, press Tab.
  // Focus lands on the × first, which skipped the commit; Tab again and
  // nothing ever added it, while the status read "Route ready · 0 stops".
  it('commits the stop when Tab passes over the × and out of the row', () => {
    expect(
      outcome([
        { kind: 'leave', from: 'fields', to: 'cancel' },
        { kind: 'leave', from: 'cancel', to: 'outside' },
      ]),
    ).toBe('commit')
  })

  it('waits while focus is on the ×, so the × can still cancel', () => {
    expect(outcome([{ kind: 'leave', from: 'fields', to: 'cancel' }])).toBe('none')
    expect(
      outcome([
        { kind: 'leave', from: 'fields', to: 'cancel' },
        { kind: 'press-cancel' },
      ]),
    ).toBe('discard')
  })

  it('waits when Shift+Tab goes from the × back to a field', () => {
    expect(
      outcome([
        { kind: 'leave', from: 'fields', to: 'cancel' },
        { kind: 'leave', from: 'cancel', to: 'fields' },
      ]),
    ).toBe('none')
  })
})

describe('leaveOf: where focus went when a point lost it', () => {
  // Stand-ins for the new stop's group: its X and Y fields and its ×, plus
  // elements outside it. Only `data-focus` and membership matter.
  const el = (focus?: string): FocusTarget => ({ dataset: { focus } })
  const x = el('new-stop')
  const y = el('new-stop-y')
  const cancel = el('new-stop-cancel')
  const addStop = el('add-stop')
  const otherCancel = el('new-stop-cancel')
  const members = new Set([x, y, cancel])
  const group = { contains: (e: FocusTarget) => members.has(e) }
  const HOLD = 'new-stop-cancel'

  it('X to Y stays inside the fields', () => {
    expect(leaveOf(x, y, group, HOLD)).toEqual({ kind: 'leave', from: 'fields', to: 'fields' })
  })

  it("a field to this group's × is 'cancel'", () => {
    expect(leaveOf(y, cancel, group, HOLD)).toEqual({ kind: 'leave', from: 'fields', to: 'cancel' })
  })

  it("the × to a control outside the row is from 'cancel' to 'outside'", () => {
    expect(leaveOf(cancel, addStop, group, HOLD)).toEqual({ kind: 'leave', from: 'cancel', to: 'outside' })
  })

  it("focus leaving the page (no related target) is 'outside'", () => {
    expect(leaveOf(x, null, group, HOLD).to).toBe('outside')
  })

  it("another row's × with the same key is 'outside', not this row's cancel", () => {
    expect(leaveOf(x, otherCancel, group, HOLD).to).toBe('outside')
  })

  it("without a hold key (departure, destination) the group's controls are fields", () => {
    expect(leaveOf(x, cancel, group).to).toBe('fields')
    expect(leaveOf(cancel, addStop, group).from).toBe('fields')
  })

  it("is 'outside' when the group is gone", () => {
    expect(leaveOf(x, y, null, HOLD).to).toBe('outside')
  })

  // The reported bug end to end: type a stop, Tab onto the ×, Tab out.
  it('a typed stop commits after Tab onto the × and Tab out of the row', () => {
    expect(outcome([leaveOf(y, cancel, group, HOLD), leaveOf(cancel, addStop, group, HOLD)])).toBe(
      'commit',
    )
  })

  it('Tab onto the × then Shift+Tab back to Y does not commit yet', () => {
    expect(outcome([leaveOf(y, cancel, group, HOLD), leaveOf(cancel, y, group, HOLD)])).toBe('none')
  })
})
