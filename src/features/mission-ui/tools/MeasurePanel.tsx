import { useEffect } from 'react'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { derived, formatMarsCoordinate, type MarsCoordinate } from '../../../domain'
import { useMeasure } from '../../../state'
import { distanceAndBearing } from '../../route-analysis/distanceAndBearing'
import { ClassifiedValue } from '../ClassifiedValue'

/** Where A and B come from: the same pick as the right-click menu's point. */
export const MEASURE_POINT_METHOD = 'Surface point under the click, from the pick ray on the mean-radius sphere'

const formatPoint = (c: MarsCoordinate) => formatMarsCoordinate(c, 2)

/**
 * The Measure tool's panel, wired to the store. The scene adds a
 * point on each click while the tool is active; releasing the tool (press
 * again, Escape, another tool) unmounts this panel and clears the points,
 * so no line is left on the globe with nothing explaining it.
 */
export function MeasurePanel() {
  const points = useMeasure((s) => s.points)
  const clear = useMeasure((s) => s.clearMeasure)
  useEffect(() => clear, [clear])
  return <MeasurePanelView points={points} onClear={clear} />
}

/**
 * Distance and initial bearing from A to B, from the tested
 * `distanceAndBearing`: DERIVED with its method, and the bearing
 * UNAVAILABLE with the reason where no direction exists (same point, a pole,
 * antipodes). Renders from props, so a test covers every state.
 */
export function MeasurePanelView({
  points,
  onClear,
}: {
  points: readonly MarsCoordinate[]
  onClear: () => void
}) {
  const { minimized, toggle, bodyId } = useMinimized()
  const [a, b] = points
  const result = a && b ? distanceAndBearing(a, b) : null

  return (
    <Panel surface="glass" compact={minimized} className="w-full">
      <PanelHeader title="Measure" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId} spacing="mb-3">
        <h2 className="text-heading font-semibold text-ink">Measure</h2>
      </PanelHeader>
      {!minimized && (
        <div id={bodyId}>
          {!a ? (
            <p className="text-caption text-ink-subtle">Click the surface to set point A.</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
              <dt className="text-ink-subtle">A</dt>
              <dd className="tabular-nums">
                <ClassifiedValue value={derived(a, MEASURE_POINT_METHOD)} format={formatPoint} />
              </dd>
              <dt className="text-ink-subtle">B</dt>
              <dd className={b ? 'tabular-nums' : 'text-caption text-ink-subtle'}>
                {b ? <ClassifiedValue value={derived(b, MEASURE_POINT_METHOD)} format={formatPoint} /> : 'Click a second point.'}
              </dd>
              {result && (
                <>
                  <dt className="text-ink-subtle">Distance</dt>
                  <dd>
                    <ClassifiedValue value={result.distanceKm} format={(km) => `${km.toFixed(2)} km`} />
                  </dd>
                  <dt className="text-ink-subtle">Bearing</dt>
                  <dd>
                    <ClassifiedValue value={result.initialBearingDeg} format={(deg) => `${deg.toFixed(1)}°`} />
                  </dd>
                </>
              )}
            </dl>
          )}
          {/* Short, so the panel covers little of the globe being clicked;
              each value's method is in its mark. */}
          {result && <p className="mt-2 text-caption text-ink-subtle">Bearing at A. A third click starts again.</p>}
          {a && (
            <button
              type="button"
              onClick={onClear}
              className="mt-3 rounded-control border border-line px-2 py-1 text-caption text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink focus-visible:bg-surface-raised focus-visible:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </Panel>
  )
}
