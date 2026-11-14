import { EARTH_DAYS_PER_SOL } from '../../../domain'

/**
 * Pure helpers behind the time menu. No React, no store, so each
 * mapping from a control to a UTC instant is testable on its own.
 */

/** Mars hours (1/24 of a sol) → milliseconds of UTC, from the domain's ratio. */
const MS_PER_MARS_HOUR = (EARTH_DAYS_PER_SOL * 86400 * 1000) / 24

/**
 * Top of the sun slider. 24 would be the start of the next sol, and a margin
 * below double precision at this Julian Date (about 1e-9 h) does not keep
 * the sol reliably; one slider step does.
 */
export const SUN_SLIDER_MAX_HOURS = 23.9

/**
 * Hour 0 is the sol boundary too: landing a rounding error before it reads
 * as 23:59 of the previous sol. 1e-6 h (3.6 ms) is two orders above the
 * precision of the Julian Date arithmetic and invisible on any readout.
 */
const SOL_START_MARGIN_HOURS = 1e-6

/** The pickers accept these years. Outside them a typed year is not finished. */
export const MIN_YEAR = 1900
export const MAX_YEAR = 2199

/**
 * The sun slider: move the clock within the current sol so that Coordinated
 * Mars Time becomes `targetHours`. Coordinated Mars Time is linear in UTC, so
 * shifting by the hour difference scaled to sol length lands on the target
 * to within floating-point error, and the same slider position always gives
 * the same instant. A shift across a leap second (none since 2017) is one
 * second off, which no reader of the clock can see.
 *
 * Returns `utcMs` unchanged for anything non-finite: the scene must never
 * receive NaN from a half-typed control.
 */
export function instantForMarsHour(
  utcMs: number,
  currentHours: number,
  targetHours: number,
): number {
  if (!Number.isFinite(utcMs) || !Number.isFinite(currentHours) || !Number.isFinite(targetHours)) {
    return utcMs
  }
  const target = Math.min(Math.max(targetHours, SOL_START_MARGIN_HOURS), SUN_SLIDER_MAX_HOURS)
  return utcMs + (target - currentHours) * MS_PER_MARS_HOUR
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** A UTC instant as the values of a `type="date"` and a `type="time"` input. */
export function utcInputValues(utcMs: number): { date: string; time: string } {
  const d = new Date(utcMs)
  return {
    date: `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  }
}

/**
 * The inverse: a date and a time input value, read as UTC, to an instant.
 * `null` while either input is empty, malformed, or outside MIN_YEAR–MAX_YEAR.
 * A browser emits a complete value on every keystroke in the year field, so
 * without the year window typing "2027" would set the clock to year 202 on
 * the way. The caller leaves the clock as it is on `null`.
 */
export function instantFromUtcInputs(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time)
  if (!d || !t) return null
  const year = +d[1]
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  const ms = Date.UTC(year, +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] ?? 0))
  if (!Number.isFinite(ms)) return null
  // Date.UTC rolls 2026-02-31 over to March and 24:00 to the next day.
  // Reject what a calendar rejects by checking the round trip.
  const back = utcInputValues(ms)
  const normalisedTime = t[3] === undefined ? `${time}:00` : time
  return back.date === date && back.time === normalisedTime ? ms : null
}

/**
 * The instant in the computer's own time zone and format, with the offset,
 * e.g. "Oct 20, 2026, 9:10 PM GMT+2": the clock is UTC, so without
 * this it reads as hours off the taskbar. `timeZone` and `locale` default to
 * the computer's; tests pass them so the result does not depend on the
 * machine.
 */
export function formatLocalTime(
  utcMs: number,
  { timeZone, locale }: { timeZone?: string; locale?: string } = {},
): string {
  if (!Number.isFinite(utcMs)) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  }).format(utcMs)
}

/**
 * Hours 0–24 as "HH:MM", truncated like a clock, never rounded up. The
 * tolerance absorbs floating-point noise only: a slider stop at 2.3 h comes
 * back from Mars24 as 2.2999999…, and 4.1 × 60 is already 245.99999999999997
 * in JavaScript. 1e-6 min is 60 µs of Mars time, below anything shown.
 */
export function formatHours(hours: number): string {
  const total = Math.floor(hours * 60 + 1e-6)
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`
}
