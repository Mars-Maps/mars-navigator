import { isAvailable, type Classified, type MeasuredGroundTemperature } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { ClassifiedValue } from '../ClassifiedValue'
import { formatHours } from '../time/timeControls'
import { formatCelsius, formatEstimate, type TemperatureReading } from './temperatureMath'

/**
 * The Temperature field of the point menu. A rover's measurement,
 * where one exists, comes first; the model estimate follows it and never
 * stands in for it. The estimate says what it is ("Model estimate"), its
 * error, and the local time and season it is for. Those come from the
 * mission time, so the time menu's sun slider and date move it (no second
 * clock). The method and inputs are in the DERIVED mark, as on every field.
 *
 * Short stacked lines, label then value then detail: the column beside the
 * field names is narrow, and a "min … max …" pair broke mid-pair.
 */
export function TemperatureField({ reading }: { reading: TemperatureReading }) {
  const { measured, estimate, conditions } = reading
  return (
    <span className="flex flex-col gap-2">
      {measured && <MeasuredBlock measured={measured} />}
      <span className="flex flex-col">
        <span className="text-caption text-ink-muted">Model estimate</span>
        <ClassifiedValue value={estimate} format={formatEstimate} />
        {conditions && (
          <span className="text-caption text-ink-muted">
            {`at ${formatHours(conditions.localSolarHours)} local solar time, Ls ${conditions.solarLongitudeDeg.toFixed(1)}° `}
            {/* The mark wraps with the season, never onto a line of its own. */}
            <span className="whitespace-nowrap">
              {`(${conditions.season}) `}
              <ClassificationBadge classification="DERIVED" detail={conditions.method} />
            </span>
          </span>
        )}
        {measured === null && isAvailable(estimate) && (
          <span className="text-caption text-ink-subtle">Measured values exist only at Jezero and Gale</span>
        )}
      </span>
    </span>
  )
}

/**
 * A rover's ground temperature at the point's site: the latest usable
 * sol's minimum and maximum, each with its own mark. It stays put while the
 * estimate below moves with the time menu, and it is where the rover was that
 * sol, not this point, so the heading says "latest record" and the date shows. The record's source and its
 * caveat (brightness, not kinetic; outreach feed, not archive) are in the
 * heading's mark: several sentences, too long for the menu's column. At a
 * site with no usable record, the reason, never a number.
 */
function MeasuredBlock({ measured }: { measured: Classified<MeasuredGroundTemperature> }) {
  if (!isAvailable(measured)) {
    return (
      <span className="flex flex-col">
        <span className="text-caption text-ink-muted">Measured</span>
        <ClassifiedValue value={measured} />
      </span>
    )
  }
  const m = measured.value
  const source = measured.classification === 'DERIVED' ? measured.method : measured.source
  return (
    <span className="flex flex-col">
      <span className="text-caption text-ink-muted">
        {`Latest record from ${m.site}, ${m.instrument} `}
        <span className="whitespace-nowrap">
          <ClassificationBadge classification={measured.classification} detail={`${source}. ${m.caveat}`} />
        </span>
      </span>
      <span className="flex flex-wrap gap-x-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink-muted">min</span>
          <ClassifiedValue value={m.minK} format={(k) => formatCelsius(k)} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink-muted">max</span>
          <ClassifiedValue value={m.maxK} format={(k) => formatCelsius(k)} />
        </span>
      </span>
      <span className="text-caption text-ink-subtle">{`sol ${m.sol}, ${m.dateUtc}`}</span>
    </span>
  )
}
