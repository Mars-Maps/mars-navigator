import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Panel } from '../../components/Panel'
import { PanelHeader } from '../../components/PanelHeader'
import { useMinimized } from '../../components/useMinimized'
import {
  formatMarsCoordinate,
  formatMeasuredValue,
  marsSolarTime,
  type Classified,
  type GeologicUnit,
  type MarsCoordinate,
  type MeasuredTemperatureLookup,
  type RadiationReference,
  type TemperatureModel,
} from '../../domain'
import { useMissionStore, useMissionTimeStore } from '../../state'
import { ClassifiedValue } from './ClassifiedValue'
import { stepPage } from './pageStep'
import { describePoint, type PointFields } from './pointFields'
import { formatSlope } from './slopeLimit'
import { SteepSlopeWarning } from './SteepSlopeWarning'
import { RadiationField } from './radiation/RadiationWarning'
import { TemperatureField } from './temperature/TemperatureField'
import type { TemperatureInputs } from './temperature/temperatureMath'

/**
 * The left-hand point menu for the point set from the right-click menu.
 * Every field goes through `ClassifiedValue`, so an UNAVAILABLE one reads as
 * deliberate, with its reason, and never as 0 or a blank.
 *
 * While the search bar above it is open the column has little height left,
 * so the fields collapse into a pager, one per page. The switch is
 * CSS: `in-[.peer\/search:has([aria-expanded=true])~*]` matches inside any
 * slot after the open search bar in the column (slots.ts), so the open state
 * stays local to SearchBar. Both forms render; the class picks one. The
 * slot hides the whole menu while the search bar is open, so the
 * pager does not show in the layout.
 *
 * Temperature is the model estimate for the mission time, so moving
 * the time menu moves it. The shell hands in the model and the
 * measurements; without them the field stays UNAVAILABLE.
 *
 * `radiationReference` is the one surface measurement, passed in by
 * the shell because it lives in src/data. It is in the radiation field's
 * methodology; the dose itself stays UNAVAILABLE at every point.
 *
 * `radiationShielding` is the atmosphere overhead against Gale. The
 * shell hands it in for the selected point, since the elevation behind it
 * is read asynchronously; without it the line stays UNAVAILABLE.
 * `pointElevation` is that same read, so the elevation row and the
 * shielding derived from it never disagree. `pointSlope` is the shell's
 * slope read at the selected point, the stop card's, since the Site
 * Inspector that showed it left the dock. `pointGeologicUnit` is the
 * shell's read of the USGS maps at the selected point.
 */
export function PointMenu({
  temperatureModel = null,
  measuredTemperature = null,
  radiationReference = null,
  radiationShielding = null,
  pointElevation,
  pointSlope,
  pointGeologicUnit,
}: {
  temperatureModel?: TemperatureModel | null
  measuredTemperature?: MeasuredTemperatureLookup | null
  radiationReference?: RadiationReference | null
  /** For the selected point only; null while it is being read, so a stale value never shows. */
  radiationShielding?: Classified<number> | null
  /** The selected point's height, from the same read as the shielding; null while reading. Required, so no caller forgets it. */
  pointElevation: Classified<number> | null
  /** The selected point's slope, degrees, from the shell's slope read; null while reading. Required, so no caller forgets it. */
  pointSlope: Classified<number> | null
  /** The selected point's geologic unit; null while reading. Required, so no caller forgets it. */
  pointGeologicUnit: Classified<GeologicUnit> | null
}) {
  const point = useMissionStore((s) => s.selectedPoint)
  const departure = useMissionStore((s) => s.routeDraft.departure)
  // To the minute: the running clock re-renders the menu, and re-runs the
  // model, once a minute rather than once a second. A set time still lands
  // at once.
  const minuteUtcMs = useMissionTimeStore((s) => Math.floor(s.utcMs / MINUTE_MS) * MINUTE_MS)
  const temperature = useMemo(
    () => ({ solar: marsSolarTime(minuteUtcMs), model: temperatureModel, measured: measuredTemperature }),
    [minuteUtcMs, temperatureModel, measuredTemperature],
  )
  return (
    <PointMenuView
      point={point}
      departure={departure}
      temperature={temperature}
      radiationReference={radiationReference}
      radiationShielding={radiationShielding}
      pointElevation={pointElevation}
      pointSlope={pointSlope}
      pointGeologicUnit={pointGeologicUnit}
    />
  )
}

/** What the rows render besides the point's own fields. */
interface RowContext {
  radiationReference: RadiationReference | null
}

const MINUTE_MS = 60_000

/** Renders from props, so a test covers every state without the store. */
export function PointMenuView({
  point,
  departure,
  temperature = null,
  radiationReference = null,
  radiationShielding = null,
  pointElevation,
  pointSlope,
  pointGeologicUnit,
}: {
  point: MarsCoordinate | null
  departure: MarsCoordinate | null
  temperature?: TemperatureInputs | null
  radiationReference?: RadiationReference | null
  radiationShielding?: Classified<number> | null
  pointElevation?: Classified<number> | null
  pointSlope?: Classified<number> | null
  pointGeologicUnit?: Classified<GeologicUnit> | null
}) {
  const fields =
    point === null
      ? null
      : describePoint(point, departure, {
          shielding: radiationShielding,
          elevation: pointElevation,
          slope: pointSlope,
          temperature,
          geologicUnit: pointGeologicUnit,
        })
  const context: RowContext = { radiationReference }
  const { minimized, toggle, bodyId } = useMinimized()
  return (
    <Panel
      surface="glass"
      compact={minimized}
      className="w-full in-[.peer\/search:has([aria-expanded=true])~*]:p-4"
    >
      <PanelHeader
        title="Point"
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        spacing="mb-3 in-[.peer\/search:has([aria-expanded=true])~*]:mb-2"
      >
        <h2 className="text-heading font-semibold text-ink">Point</h2>
      </PanelHeader>
      {minimized ? null : fields === null ? (
        <p id={bodyId} className="text-caption text-ink-subtle">
          No point selected. Right-click the surface and choose Set point.
        </p>
      ) : (
        <div id={bodyId}>
          <div className="in-[.peer\/search:has([aria-expanded=true])~*]:hidden">
            <FieldList fields={fields} context={context} />
          </div>
          <div className="hidden in-[.peer\/search:has([aria-expanded=true])~*]:block">
            <FieldPager fields={fields} context={context} />
          </div>
        </div>
      )}
    </Panel>
  )
}

/** The fields in display order; the list and the pager both map over it. */
const ROWS: readonly { label: string; render: (fields: PointFields, context: RowContext) => ReactNode }[] = [
  {
    label: 'Coordinate',
    render: (f) => <ClassifiedValue value={f.coordinate} format={(c) => formatMarsCoordinate(c, 2)} />,
  },
  {
    label: 'Elevation',
    render: (f) => (
      <ClassifiedValue value={f.elevation} format={(m) => `${Math.round(m).toLocaleString('en-US')} m`} />
    ),
  },
  {
    // Right after the height it is worked out from; in the stop card's words and bands.
    label: 'Slope',
    render: (f) => (
      <span className="flex flex-col gap-0.5">
        <ClassifiedValue value={f.slope} format={formatSlope} />
        <SteepSlopeWarning slope={f.slope} />
      </span>
    ),
  },
  {
    label: 'Distance from departure',
    render: (f) => <ClassifiedValue value={f.distanceFromDeparture} format={(km) => `${km.toFixed(2)} km`} />,
  },
  {
    label: 'Temperature',
    render: (f) => <TemperatureField reading={f.temperature} />,
  },
  {
    label: 'Radiation',
    render: (f, { radiationReference }) => (
      <RadiationField
        reading={f.radiation}
        doseReference={radiationReference && <RadiationReferenceLine reference={radiationReference} />}
      />
    ),
  },
  { label: 'Geologic unit', render: (f) => <ClassifiedValue value={f.geologicUnit} format={(u) => `${u.name} (${u.symbol})`} /> },
]

/**
 * The one measurement, as a reference in the field's methodology:
 * its value with the stated uncertainty, where, when and under what solar
 * conditions it was taken. The badge carries the citation. The absorbed
 * dose is given too, since the dose equivalent is derived from it by the
 * paper's own quality factor. Nothing here is scaled to the point.
 */
/** A true minus sign, as the rest of the UI prints heights. */
const formatElevationKm = (km: number) => `${km < 0 ? '−' : ''}${Math.abs(km)}`

function RadiationReferenceLine({ reference }: { reference: RadiationReference }) {
  return (
    <span data-radiation-reference className="block">
      Measured at {reference.site} ({reference.instrument}, {formatElevationKm(reference.elevationKm)} km,{' '}
      {reference.period},{' '}
      {reference.conditions}):{' '}
      <ClassifiedValue value={reference.doseEquivalent} format={(m) => formatMeasuredValue(m, 2)} />{' '}
      <ClassifiedValue value={reference.absorbedDose} format={(m) => `(${formatMeasuredValue(m, 3)})`} />
      <span className="block">Not scaled to this point.</span>
    </span>
  )
}

function FieldList({ fields, context }: { fields: PointFields; context: RowContext }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-body">
      {ROWS.map((row) => (
        <Row key={row.label} label={row.label}>
          {row.render(fields, context)}
        </Row>
      ))}
    </dl>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

/**
 * One field per page, its reason or provenance wrapped in full. The box is
 * as tall as the page it shows: a short page such as Coordinate no
 * longer sits in the tallest page's empty space, at the cost of the box
 * changing height as the page changes, which the arrows and dots follow.
 * The hidden pages are `hidden`, out of the layout and the accessibility
 * tree. The page is
 * kept when the point changes, so one field can be compared across points.
 * A page change is announced by an offscreen live region ("Elevation, 2 of
 * 6"): flipping `aria-hidden` alone is not reliably read out.
 */
function FieldPager({ fields, context }: { fields: PointFields; context: RowContext }) {
  const [index, setIndex] = useState(0)
  const count = ROWS.length
  const go = (delta: number) => setIndex((i) => stepPage(i, delta, count))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') go(-1)
    else if (e.key === 'ArrowRight') go(1)
    else return
    e.preventDefault()
  }

  return (
    <div role="group" aria-roledescription="carousel" aria-label="Point fields" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
        <PagerButton label="Previous field" onClick={() => go(-1)}>
          <path d="m15 6-6 6 6 6" />
        </PagerButton>
        <div className="min-w-0 flex-1 text-body">
          {ROWS.map((row, i) => (
            <dl key={row.label} aria-hidden={i !== index} className={i === index ? '' : 'hidden'}>
              <dt className="text-caption text-ink-subtle">{row.label}</dt>
              <dd>{row.render(fields, context)}</dd>
            </dl>
          ))}
        </div>
        <PagerButton label="Next field" onClick={() => go(1)}>
          <path d="m9 6 6 6-6 6" />
        </PagerButton>
      </div>
      <p className="sr-only" aria-live="polite">
        {`${ROWS[index].label}, ${index + 1} of ${count}`}
      </p>

      <div className="mt-2 flex justify-center gap-1">
        {ROWS.map((row, i) => (
          <button
            key={row.label}
            type="button"
            aria-label={`${row.label}, field ${i + 1} of ${count}`}
            aria-current={i === index ? 'true' : undefined}
            onClick={() => setIndex(i)}
            className="group/dot flex size-4 items-center justify-center rounded-full"
          >
            <span
              className={`size-1.5 rounded-full transition-colors duration-(--duration-fast) ${
                i === index ? 'bg-accent' : 'bg-ink-subtle/50 group-hover/dot:bg-ink-muted'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

function PagerButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  )
}
