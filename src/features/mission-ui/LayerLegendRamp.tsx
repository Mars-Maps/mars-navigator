import type { MapLayerLegend } from '../../domain'
import { rampCss } from '../../lib/colorRamp'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import { labelledStops, NO_RAMP_STOPS } from './legendLabels'

export type RampLegend = Extract<MapLayerLegend, { kind: 'ramp' }>

/**
 * A colour scale this project drew over a dataset's values: the
 * bar as a gradient of the legend's own stops, each stop's value under it,
 * the unit, the classification with its citation or method, and the note
 * that the colours are ours and what the gaps mean. The bar is painted
 * from the same stops the layer is. A thermal grid layer is drawn partly
 * see-through over the grey ground, so its shade on the map can be off
 * the legend by up to about two steps; the caption says so.
 */
export function LayerLegendRamp({ legend }: { legend: RampLegend }) {
  const { stops } = legend
  const heading = (
    <p className="flex items-center gap-2 text-body text-ink-muted">
      {legend.quantity}
      <ClassificationBadge classification={legend.classification} detail={legend.source} />
    </p>
  )
  // The type allows no stops; say so rather than draw a scale from nothing.
  if (stops.length === 0) {
    return (
      <>
        {heading}
        <p className="mt-2 text-caption text-ink-muted">{NO_RAMP_STOPS}</p>
        <p className="mt-1 text-caption break-words text-ink-subtle">{legend.note}</p>
      </>
    )
  }
  const lo = stops[0].value
  const labels = labelledStops(stops)
  return (
    <>
      {heading}
      <div
        data-legend-ramp=""
        role="img"
        aria-label={`Colour scale from ${formatStop(lo)} to ${formatStop(stops[stops.length - 1].value)} ${legend.unit}`}
        className="mt-2 h-3 rounded-sm border border-line/60"
        style={{ background: rampCss(stops) }}
      />
      <div className="relative mt-0.5 h-4 text-caption tabular-nums text-ink">
        {labels.map((label, i) => {
          const edge = i === 0 ? 'translate-x-0' : i === labels.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
          return (
            <span key={label.value} className={`absolute top-0 ${edge}`} style={{ left: `${label.at}%` }}>
              {formatStop(label.value)}
            </span>
          )
        })}
      </div>
      <p className="mt-0.5 text-caption text-ink-subtle">
        {legend.unit}; under {formatStop(lo)} and over {formatStop(stops[stops.length - 1].value)} take the end colours
      </p>
      <p className="mt-1 text-caption break-words text-ink-subtle">{legend.note}</p>
    </>
  )
}

/** "−130", "50": a true minus, no decimals the stops do not carry. */
function formatStop(value: number): string {
  const text = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return value < 0 ? `−${text}` : text
}
