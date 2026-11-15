import { useId, useRef, useState } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { Panel } from '../../components/Panel'
import { formatMarsCoordinate, isAvailable } from '../../domain'
import { useMissionTime } from '../../state'
import {
  MAX_YEAR,
  MIN_YEAR,
  SUN_SLIDER_MAX_HOURS,
  formatHours,
  formatLocalTime,
  instantForMarsHour,
  instantFromUtcInputs,
  utcInputValues,
} from './time/timeControls'
import { useEscapeLayer } from '../../lib/useEscapeLayer'

/**
 * The top-right time menu. Collapsed, it is one line: the UTC instant
 * and the Mars time for it, and "paused" when the clock is not running.
 * Open, it adds the UTC date and time pickers, a sun slider that scrubs the
 * current sol, the Mars readouts, Pause / Run and Set now.
 *
 * Every control writes the one mission instant, and the clock runs on
 * from whatever is set: the pickers and the readouts follow it once
 * a second. Everything Martian shown here is calculated from it and
 * labelled DERIVED with the Mars24 method, which is an analytic
 * approximation, not an ephemeris.
 */
export function TimeMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { utcMs, solar, running, setInstant, setNow, pause, resume } = useMissionTime()
  const id = useId()
  // defaultOpen is for render tests; in the app the toggle opens it.
  const [open, setOpen] = useState(defaultOpen)
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Escape closes, when this is the top layer, and hands focus back
  // to the toggle, so a keyboard user who was on the slider does not land
  // on <body>. Focus in the pickers or slider still closes the menu.
  useEscapeLayer(open, () => {
    setOpen(false)
    toggleRef.current?.focus()
  })

  const canonical = utcInputValues(utcMs)
  const marsHours = isAvailable(solar) ? solar.value.coordinatedMarsTimeHours : null
  // On the mark in the header line, so it reads collapsed and open.
  const provenance = !isAvailable(solar)
    ? solar.reason
    : solar.classification === 'DERIVED'
      ? solar.method
      : solar.source
  const bodyId = `${id}-body`

  // Open, it must draw above the icon panel, which comes later in the slot order.
  // It also stays inside the viewport: the layout clips overflow, so on a short
  // window the body scrolls instead of losing its last rows off-screen.
  return (
    <Panel
      surface="glass"
      className={open ? 'relative z-10 flex max-h-[calc(100vh-2rem)] flex-col' : ''}
    >
      <button
        ref={toggleRef}
        type="button"
        // The only aria-expanded in the time menu: slots.ts moves the icon
        // panel when it is true. Keep it the only one, and keep it
        // aria-expanded.
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-control text-left transition-colors duration-(--duration-fast) hover:bg-surface-raised"
      >
        <span className="flex flex-col">
          <span className="sr-only">Mission time: </span>
          <span className="text-body tabular-nums text-ink">
            {canonical.date} {canonical.time.slice(0, 5)} UTC
          </span>
          <span className="flex items-center gap-1.5 text-caption tabular-nums text-ink-muted">
            {marsHours === null ? 'Mars time unavailable' : `${formatHours(marsHours)} MTC`}
            <ClassificationBadge classification={solar.classification} detail={provenance} />
            {/* On the short line, so the UTC line never wraps. */}
            {!running && <span className="text-micro uppercase text-ink-subtle">· paused</span>}
          </span>
        </span>
        <span aria-hidden="true" className="text-ink-subtle">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        // p-1 with -mx-1 leaves room for the 2px focus outline at 2px offset,
        // which the scroll container would otherwise clip; scroll-p-1 keeps that
        // room when focus scrolls a control into view. mt-3 + p-1 keeps mt-4.
        <div
          id={bodyId}
          className="-mx-1 mt-3 flex min-h-0 scroll-p-1 flex-col gap-4 overflow-y-auto p-1"
        >
          <Pickers
            id={id}
            utcMs={utcMs}
            canonical={canonical}
            running={running}
            setInstant={setInstant}
            setNow={setNow}
            onToggleRun={running ? pause : resume}
          />

          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label htmlFor={`${id}-sun`} className="text-micro uppercase text-ink-subtle">
                Sun · Mars time
              </label>
              <span className="text-caption tabular-nums text-ink">
                {marsHours === null ? '—' : `${formatHours(marsHours)} MTC`}
              </span>
            </div>
            <input
              id={`${id}-sun`}
              type="range"
              min={0}
              max={SUN_SLIDER_MAX_HOURS}
              step={0.1}
              value={marsHours ?? 0}
              disabled={marsHours === null}
              aria-valuetext={
                marsHours === null ? 'unavailable' : `${formatHours(marsHours)} Coordinated Mars Time`
              }
              onChange={(e) => {
                if (marsHours === null) return
                setInstant(instantForMarsHour(utcMs, marsHours, Number(e.target.value)))
              }}
              className="w-full accent-accent disabled:opacity-40"
            />
          </div>

          {isAvailable(solar) ? (
            <dl className="flex flex-col gap-1 text-caption">
              <Row label="Mars Sol Date">
                {Math.floor(solar.value.marsSolDate).toLocaleString('en-US')}
              </Row>
              <Row label="Season Ls">{`${solar.value.solarLongitudeDeg.toFixed(1)}°`}</Row>
              <Row label="Sun overhead">{formatMarsCoordinate(solar.value.subsolarPoint)}</Row>
            </dl>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-ink-subtle">
              <span className="italic">Mars time unavailable</span>
              <ClassificationBadge classification="UNAVAILABLE" detail={solar.reason} />
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * The UTC pickers keep a draft, because a date input reports "" while a
 * field is half-typed. The clock moves only on a complete, valid value
 * inside the year window, and the draft snaps back whenever the clock
 * changes.
 */
function Pickers({
  id,
  utcMs,
  canonical,
  running,
  setInstant,
  setNow,
  onToggleRun,
}: {
  id: string
  utcMs: number
  canonical: { date: string; time: string }
  running: boolean
  setInstant: (utcMs: number) => void
  setNow: () => void
  onToggleRun: () => void
}) {
  const [draft, setDraft] = useState(canonical)
  const [draftFor, setDraftFor] = useState(utcMs)
  // While a picker has focus the running clock must not overwrite what is
  // being typed; the draft catches up when focus leaves the group.
  const [editing, setEditing] = useState(false)
  if (!editing && draftFor !== utcMs) {
    setDraftFor(utcMs)
    setDraft(canonical)
  }

  const onChange = (next: { date: string; time: string }) => {
    setDraft(next)
    const ms = instantFromUtcInputs(next.date, next.time)
    if (ms !== null) setInstant(ms)
  }

  const groupId = `${id}-utc`
  return (
    <div>
      {/* Set now sits beside the group name, not inside it, so the group is
          announced as "Earth · UTC" alone. */}
      <div className="mb-1 flex items-baseline justify-between">
        <span id={groupId} className="text-micro uppercase text-ink-subtle">
          Earth · UTC
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleRun}
            // The label says what a press does; no aria-pressed, which would
            // read "Run, pressed" while paused.
            className="rounded-control px-2 py-0.5 text-caption text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink"
          >
            {running ? 'Pause' : 'Run'}
          </button>
          <button
            type="button"
            onClick={setNow}
            className="rounded-control px-2 py-0.5 text-caption text-accent transition-colors duration-(--duration-fast) hover:bg-accent/15"
          >
            Set now
          </button>
        </span>
      </div>
      <div
        role="group"
        aria-labelledby={groupId}
        className="flex flex-col gap-2"
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return
          setEditing(false)
          setDraftFor(utcMs)
          setDraft(canonical)
        }}
      >
        <label htmlFor={`${id}-date`} className="sr-only">
          Date (UTC)
        </label>
        <input
          id={`${id}-date`}
          type="date"
          min={`${MIN_YEAR}-01-01`}
          max={`${MAX_YEAR}-12-31`}
          value={draft.date}
          onChange={(e) => onChange({ ...draft, date: e.target.value })}
          className={INPUT}
        />
        <label htmlFor={`${id}-time`} className="sr-only">
          Time (UTC)
        </label>
        <input
          id={`${id}-time`}
          type="time"
          step={1}
          value={draft.time}
          onChange={(e) => onChange({ ...draft, time: e.target.value })}
          className={INPUT}
        />
      </div>
      {/* The pickers are the browser's own and follow the computer's
          regional format (e.g. 10/19/2026, 03:09 PM); the value is UTC
          either way, and the line above shows it in ISO. */}
      <p className="mt-1 text-caption text-ink-subtle">
        Shown in this computer's date format; the time is UTC.
      </p>
      {/* The same instant on the computer's clock, so Set now does not read
          as hours behind the taskbar. Follows the clock, not the draft. */}
      <p className="mt-2 flex items-baseline justify-between gap-2 text-caption">
        <span className="text-micro uppercase text-ink-subtle">Local</span>
        <span className="text-right tabular-nums text-ink-muted">{formatLocalTime(utcMs)}</span>
      </p>
    </div>
  )
}

// :invalid is driven by the date input's min/max, so a year outside the
// window shows why the clock did not move.
const INPUT =
  'w-full rounded-control border border-line bg-surface px-3 py-1.5 text-body tabular-nums text-ink invalid:border-danger/40'

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="tabular-nums text-ink">{children}</dd>
    </div>
  )
}
