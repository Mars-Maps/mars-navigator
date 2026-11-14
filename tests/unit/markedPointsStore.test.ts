import { beforeEach, describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import { MARKER_DESCRIPTION_MAX, useMissionStore } from '../../src/state'

// Test fixtures only: invented points and descriptions, never shown in the app.
const A: MarsCoordinate = { latitude: -4.5, longitudeEast: 137.4 }
const B: MarsCoordinate = { latitude: 18.65, longitudeEast: 226.2 }
const C: MarsCoordinate = { latitude: 0, longitudeEast: 0 }

const markers = () => useMissionStore.getState().markers
const idOf = (i: number) => markers()[i]!.id

describe('marked points in the store', () => {
  beforeEach(() => {
    useMissionStore.setState({ markers: [] })
  })

  describe('markPoint', () => {
    it('keeps a trimmed description as the label', () => {
      useMissionStore.getState().markPoint(A, '  fixture-description  ')
      expect(markers()).toHaveLength(1)
      expect(markers()[0]).toMatchObject({ coordinate: A, label: 'fixture-description' })
    })

    it('leaves the point unnamed with no description, or a blank one', () => {
      const { markPoint } = useMissionStore.getState()
      markPoint(A)
      markPoint(B, '')
      markPoint(C, '   ')
      expect(markers().map((m) => m.label)).toEqual([undefined, undefined, undefined])
    })

    it(`caps the description at ${MARKER_DESCRIPTION_MAX} characters`, () => {
      useMissionStore.getState().markPoint(A, 'x'.repeat(MARKER_DESCRIPTION_MAX + 20))
      expect(markers()[0]!.label).toBe('x'.repeat(MARKER_DESCRIPTION_MAX))
    })

    it('trims before capping, so leading spaces do not use up the limit', () => {
      useMissionStore.getState().markPoint(A, `   ${'x'.repeat(MARKER_DESCRIPTION_MAX)}`)
      expect(markers()[0]!.label).toBe('x'.repeat(MARKER_DESCRIPTION_MAX))
    })

    it('still gives every marker its own id and an UNAVAILABLE elevation', () => {
      const { markPoint } = useMissionStore.getState()
      markPoint(A, 'fixture-one')
      markPoint(A, 'fixture-one')
      expect(idOf(0)).not.toBe(idOf(1))
      expect(markers()[0]!.elevationMeters.classification).toBe('UNAVAILABLE')
    })
  })

  describe('unmarkPoint', () => {
    beforeEach(() => {
      const { markPoint } = useMissionStore.getState()
      markPoint(A, 'fixture-a')
      markPoint(B, 'fixture-b')
      markPoint(C, 'fixture-c')
    })

    it('removes only that marker and keeps the others in order', () => {
      useMissionStore.getState().unmarkPoint(idOf(1))
      expect(markers().map((m) => m.label)).toEqual(['fixture-a', 'fixture-c'])
    })

    it('can remove the first and the last marker', () => {
      const { unmarkPoint } = useMissionStore.getState()
      unmarkPoint(idOf(0))
      unmarkPoint(idOf(1))
      expect(markers().map((m) => m.label)).toEqual(['fixture-b'])
    })

    it('does nothing for an unknown id, not even a new array', () => {
      const before = markers()
      useMissionStore.getState().unmarkPoint('marker-unknown')
      expect(markers()).toBe(before)
    })

    it('does nothing for an id that was already unmarked', () => {
      const id = idOf(0)
      const { unmarkPoint } = useMissionStore.getState()
      unmarkPoint(id)
      const before = markers()
      unmarkPoint(id)
      expect(markers()).toBe(before)
    })
  })

  describe('describePoint', () => {
    beforeEach(() => {
      const { markPoint } = useMissionStore.getState()
      markPoint(A)
      markPoint(B, 'fixture-b')
    })

    it('sets a trimmed description and changes nothing else about the point', () => {
      const before = markers()[0]!
      useMissionStore.getState().describePoint(before.id, '  fixture-new  ')
      expect(markers()[0]).toEqual({ ...before, label: 'fixture-new' })
      expect(markers()[1]!.label).toBe('fixture-b')
    })

    it('replaces an existing description', () => {
      useMissionStore.getState().describePoint(idOf(1), 'fixture-replaced')
      expect(markers()[1]!.label).toBe('fixture-replaced')
    })

    it(`caps the description at ${MARKER_DESCRIPTION_MAX} characters`, () => {
      useMissionStore.getState().describePoint(idOf(0), 'y'.repeat(MARKER_DESCRIPTION_MAX + 1))
      expect(markers()[0]!.label).toBe('y'.repeat(MARKER_DESCRIPTION_MAX))
    })

    it('clears the description when the text is blank', () => {
      useMissionStore.getState().describePoint(idOf(1), '   ')
      expect(markers()[1]!.label).toBeUndefined()
    })

    it('does nothing for an unknown id, not even a new array', () => {
      const before = markers()
      useMissionStore.getState().describePoint('marker-unknown', 'fixture-ignored')
      expect(markers()).toBe(before)
    })
  })
})
