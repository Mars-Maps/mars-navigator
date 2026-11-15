import { useMemo } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { isAvailable, type WalkPlan } from '../../../domain'
import { endsAtStart, stopsPhrase } from './walkCardFigures'
import { walkMapLayout } from './walkMap'

const WIDTH = 320
const HEIGHT = 170
const PADDING = 22
/** Smaller than a stop, so a flag on a stop leaves a ring of the stop showing. */
const FLAG_R = 2.5
const STOP_R = 5
const NOT_CHECKED_DASH = '4 3'

const formatKm = (km: number) => (km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The planned walk as a small north-up diagram beside its flags: at the
 * few km of a walk the globe's closest view shows about 20 px. Lines are each
 * leg's own path, marks the plan's own flags, numbers the panel's stops, in
 * order (the start "S"). A leg whose slope or map was not read is dashed and muted, so it never
 * reads as clear. A diagram, not imagery, and it says so.
 */
export function WalkPlanMap({ plan }: { plan: WalkPlan }) {
  const layout = useMemo(() => walkMapLayout(plan, WIDTH, HEIGHT, PADDING), [plan])
  const path = plan.legs.map((leg) => leg.path).find(isAvailable)
  const slopes = layout.flags.filter((f) => f.kind === 'slope').length
  const obstacles = layout.flags.length - slopes
  const unchecked = layout.legs.filter((leg) => leg.notFullyChecked).length
  const barLeft = WIDTH - 10 - layout.scale.length
  // The way back ends on the start's own mark, which keeps its "S": no number is drawn over it.
  const closing = endsAtStart(plan.stops) ? plan.stops.length - 1 : -1
  const label = [
    // The start is not a numbered stop, as the panel and the marks say.
    `Diagram of the planned walk, north up: ${stopsPhrase(plan.stops)}`,
    count(slopes, 'slope flag', 'slope flags'),
    count(obstacles, 'mapped obstacle', 'mapped obstacles'),
    ...(unchecked > 0 ? [count(unchecked, 'leg not fully checked', 'legs not fully checked')] : []),
  ].join(', ')

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${label}. The details are listed below.`}
        className="w-full rounded-control border border-line/60 bg-surface-raised/40"
      >
        <text x={10} y={HEIGHT - 10} className="fill-ink-subtle text-[10px]">N ↑</text>
        {layout.legs.map((leg, i) => (
          <polyline
            key={i}
            points={leg.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={leg.notFullyChecked ? NOT_CHECKED_DASH : undefined}
            className={leg.notFullyChecked ? 'stroke-ink-muted' : 'stroke-ink'}
          />
        ))}
        {layout.stops.map((s, i) => (
          <g key={plan.stops[i].id}>
            <circle cx={s.x} cy={s.y} r={STOP_R} className="fill-ink" />
            {/* As the panel names them: the start is "S", then Stop 1, Stop 2 …. */}
            {i !== closing && (
              <text x={s.x + STOP_R + 2} y={s.y - STOP_R} className="fill-ink text-[11px] font-semibold">
                {i === 0 ? 'S' : i}
              </text>
            )}
          </g>
        ))}
        {/* Over the stops: a flag can fall on one, and must still show. */}
        {layout.flags.map((f) =>
          f.kind === 'slope' ? (
            <circle key={f.id} cx={f.x} cy={f.y} r={FLAG_R} className="fill-danger" />
          ) : (
            <circle key={f.id} cx={f.x} cy={f.y} r={FLAG_R} strokeWidth={1.25} className="fill-none stroke-accent" />
          ),
        )}
        <line x1={barLeft} x2={WIDTH - 10} y1={HEIGHT - 10} y2={HEIGHT - 10} strokeWidth={1.5} className="stroke-ink-muted" />
        <text x={WIDTH - 10} y={HEIGHT - 14} textAnchor="end" className="fill-ink-muted text-[10px]">
          {formatKm(layout.scale.km)}
        </text>
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-ink-muted">
        <span className="flex items-center gap-1">
          <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" className="fill-danger" /></svg>
          Slope flag
        </span>
        <span className="flex items-center gap-1">
          <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3" strokeWidth="1.25" className="fill-none stroke-accent" /></svg>
          Mapped obstacle
        </span>
        {unchecked > 0 && (
          <span className="flex items-center gap-1">
            <svg width="16" height="8" aria-hidden="true">
              <line x1="0" x2="16" y1="4" y2="4" strokeWidth="1.5" strokeDasharray={NOT_CHECKED_DASH} className="stroke-ink-muted" />
            </svg>
            Not fully checked
          </span>
        )}
        <span className="flex items-center gap-1">
          Diagram, no imagery
          {path && (
            <ClassificationBadge
              classification={path.classification}
              detail={path.classification === 'DERIVED' ? path.method : path.source}
            />
          )}
        </span>
      </figcaption>
    </figure>
  )
}
