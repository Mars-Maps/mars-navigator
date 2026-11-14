import { describe, expect, it } from 'vitest'
import { isAvailable, marsSolarTime } from '../../src/domain'
import {
  SUN_SLIDER_MAX_HOURS,
  formatHours,
  formatLocalTime,
  instantForMarsHour,
  instantFromUtcInputs,
  utcInputValues,
} from '../../src/features/mission-ui/time/timeControls'

/** Coordinated Mars Time and sol number for an instant, via the domain's Mars24. */
function mtc(utcMs: number) {
  const solar = marsSolarTime(utcMs)
  if (!isAvailable(solar)) throw new Error(solar.reason)
  return {
    hours: solar.value.coordinatedMarsTimeHours,
    sol: Math.floor(solar.value.marsSolDate),
  }
}

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0)

/** 200 instants spread over about two years, so no single lucky start passes. */
const INSTANTS = Array.from({ length: 200 }, (_, i) => T0 + i * 3.7 * 86_400_000)

describe('instantForMarsHour — the sun slider', () => {
  it('lands on the requested Mars hour, in the same sol', () => {
    const start = mtc(T0)
    for (const target of [0, 6.5, 12, 18.25, SUN_SLIDER_MAX_HOURS]) {
      const moved = instantForMarsHour(T0, start.hours, target)
      const after = mtc(moved)
      expect(after.hours).toBeCloseTo(target, 5)
      expect(after.sol).toBe(start.sol)
    }
  })

  it('is a no-op at the current hour and round-trips', () => {
    const start = mtc(T0)
    expect(instantForMarsHour(T0, start.hours, start.hours)).toBe(T0)
    const there = instantForMarsHour(T0, start.hours, 3)
    const back = instantForMarsHour(there, mtc(there).hours, start.hours)
    expect(back).toBeCloseTo(T0, -1) // within 10 ms of floating-point drift
  })

  it('clamps to the slider range and never crosses into the next sol', () => {
    for (const t of INSTANTS) {
      const start = mtc(t)
      const top = mtc(instantForMarsHour(t, start.hours, 24))
      expect(top.sol).toBe(start.sol)
      expect(top.hours).toBeCloseTo(SUN_SLIDER_MAX_HOURS, 6)
      const bottom = mtc(instantForMarsHour(t, start.hours, -1))
      expect(bottom.sol).toBe(start.sol)
      expect(bottom.hours).toBeCloseTo(0, 5)
    }
  })

  it('ignores non-finite input instead of poisoning the clock', () => {
    expect(instantForMarsHour(T0, 5, Number.NaN)).toBe(T0)
    expect(instantForMarsHour(T0, Number.NaN, 5)).toBe(T0)
    expect(instantForMarsHour(Number.NaN, 5, 5)).toBeNaN()
  })
})

describe('utcInputValues / instantFromUtcInputs — the date and time pickers', () => {
  it('formats an instant as UTC input values', () => {
    expect(utcInputValues(Date.UTC(2026, 9, 18, 7, 5, 9))).toEqual({
      date: '2026-10-18',
      time: '07:05:09',
    })
  })

  it('round-trips through the inputs', () => {
    const { date, time } = utcInputValues(T0)
    expect(instantFromUtcInputs(date, time)).toBe(T0)
  })

  it('accepts a time without seconds', () => {
    expect(instantFromUtcInputs('2026-10-18', '12:00')).toBe(T0)
  })

  it('returns null for empty, partial or impossible values', () => {
    expect(instantFromUtcInputs('', '12:00')).toBeNull()
    expect(instantFromUtcInputs('2026-10-18', '')).toBeNull()
    expect(instantFromUtcInputs('2026-1-8', '12:00')).toBeNull()
    expect(instantFromUtcInputs('2026-02-31', '12:00')).toBeNull()
    expect(instantFromUtcInputs('2026-10-18', '24:00')).toBeNull()
    expect(instantFromUtcInputs('2026-10-18', '12:60')).toBeNull()
  })

  it('rejects a year still being typed: "2027" passes through 0002, 0020 and 0202', () => {
    expect(instantFromUtcInputs('0002-10-18', '12:00')).toBeNull()
    expect(instantFromUtcInputs('0020-10-18', '12:00')).toBeNull()
    expect(instantFromUtcInputs('0202-10-18', '12:00')).toBeNull()
    expect(instantFromUtcInputs('1899-12-31', '12:00')).toBeNull()
    expect(instantFromUtcInputs('2200-01-01', '12:00')).toBeNull()
    expect(instantFromUtcInputs('1900-01-01', '00:00')).toBe(Date.UTC(1900, 0, 1))
    expect(instantFromUtcInputs('2199-12-31', '23:59:59')).toBe(Date.UTC(2199, 11, 31, 23, 59, 59))
  })
})

describe('formatHours', () => {
  it('prints Mars hours as HH:MM, truncated like a clock', () => {
    expect(formatHours(0)).toBe('00:00')
    expect(formatHours(13.5)).toBe('13:30')
    expect(formatHours(12.0084)).toBe('12:00')
    expect(formatHours(23.999)).toBe('23:59')
  })

  it('does not drop a minute to floating-point noise at slider stops', () => {
    expect(4.1 * 60).not.toBe(246) // the noise this guards against
    expect(formatHours(4.1)).toBe('04:06')
    expect(formatHours(2.3 - 1e-9)).toBe('02:18')
    for (let k = 0; k < 240; k++) {
      const stop = k / 10
      const expected = `${String(Math.floor(stop)).padStart(2, '0')}:${String(Math.round((stop % 1) * 60)).padStart(2, '0')}`
      expect(formatHours(stop - 1e-9)).toBe(expected)
    }
  })
})

describe('formatLocalTime', () => {
  // ICU puts a narrow no-break space before AM/PM; compare on plain spaces.
  const local = (utcMs: number, timeZone: string) =>
    formatLocalTime(utcMs, { timeZone, locale: 'en-US' }).replace(/\s/g, ' ')

  it('shows the instant on a summer-time European clock, two hours ahead of UTC', () => {
    expect(local(Date.UTC(2026, 9, 20, 19, 10), 'Europe/Berlin')).toBe('Oct 20, 2026, 9:10 PM GMT+2')
  })

  it('follows the zone rules of the instant, not of today', () => {
    // Central European summer time ends 2026-10-25 at 01:00 UTC.
    expect(local(Date.UTC(2026, 9, 26, 19, 10), 'Europe/Berlin')).toBe('Oct 26, 2026, 8:10 PM GMT+1')
  })

  it('rolls the date over when the local clock is past midnight', () => {
    expect(local(Date.UTC(2026, 9, 20, 23, 30), 'Europe/Berlin')).toBe('Oct 21, 2026, 1:30 AM GMT+2')
    expect(local(Date.UTC(2026, 9, 20, 2, 0), 'America/New_York')).toBe('Oct 19, 2026, 10:00 PM GMT-4')
  })

  it('shows a zero offset for UTC (ICU writes it as GMT or GMT+0)', () => {
    expect(local(Date.UTC(2026, 9, 20, 19, 10), 'UTC')).toMatch(/^Oct 20, 2026, 7:10 PM GMT(\+0)?$/)
  })

  it('prints a dash, never a fake date, for a non-finite instant', () => {
    expect(formatLocalTime(Number.NaN)).toBe('—')
  })
})
