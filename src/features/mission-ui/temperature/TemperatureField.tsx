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
          <span className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
            {`at ${formatHours(conditions.localSolarHours)} local solar time`}
            {/* The season the estimate is for is in the mark, with how the time was worked out. */}
            <ClassificationBadge
              classification="DERIVED"
              detail={`Ls ${conditions.solarLongitudeDeg.toFixed(1)}° (${conditions.season}). ${conditions.method}`}
            />
          </span>
        )}
        {measured === null && isAvailable(estimate) && (
          <span className="inline-flex items-center gap-1.5 text-caption text-ink-subtle">
            No measurement here
            <ClassificationBadge classification="UNAVAILABLE" detail={NO_MEASUREMENT_HERE} />
          </span>
        )}
      </span>
    </span>
  )
}

/** Why a point away from the two rover sites has no measured line. */
export const NO_MEASUREMENT_HERE = 'Measured values exist only at Jezero and Gale'

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
      <span className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
        {`Measured · sol ${m.sol}`}
        <ClassificationBadge
          classification={measured.classification}
          detail={`Latest record from ${m.site}, ${m.instrument}: sol ${m.sol}, ${m.dateUtc}. Where the rover was that sol, not this point. ${source}. ${m.caveat}`}
        />
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
    </span>
  )
}
