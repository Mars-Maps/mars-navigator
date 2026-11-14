import { useId, type ReactNode } from 'react'
import { formatMarsCoordinate, isAvailable, type RouteOption } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { SEARCH_PENDING_REASON } from '../../route-analysis/strategies/searchedRoute'
import { ClassifiedValue } from '../ClassifiedValue'
import { STRATEGY_LABEL } from './labels'

/**
 * Where the route ends, which route it is, and what it costs. Every metric
 * comes from the route itself: duration and energy stay UNAVAILABLE with the
 * reason the planner gives — this panel never fills one in.
 *
 * The route picker lists every option the planner offered, in its
 * order. An option with a DERIVED path shows its distance and is drawn when
 * selected; one without shows "Searching…" while its search runs, or
 * "Not drawn", with the strategy's reason on the mark, so the three terrain strategies are visible before their
 * bodies exist, without a made-up line.
 */
export function DestinationBar({
  route,
  options = [],
  onSelect,
  onEnd,
}: {
  route: RouteOption | null
  /** Every option offered for this draft; `route` is one of them. */
  options?: readonly RouteOption[]
  /** Makes another option the route. Required when there is more than one. */
  onSelect?: (id: string) => void
  /**
   * Stops following the route and returns to close-up. Required:
   * this bar is the navigation screen's only way out.
   */
  onEnd: () => void
}) {
  const { minimized, toggle, bodyId } = useMinimized()
  // Boxed, so the only way out never reads as a caption; in the
  // header's top-right corner rather than a full-width row, so the bar fits
  // the navigation column at 720 px.
  const end = (
    <button
      type="button"
      onClick={onEnd}
      className="shrink-0 rounded-control border border-accent/40 bg-accent/10 px-2.5 py-1 text-caption font-medium text-accent transition-colors duration-(--duration-fast) hover:border-accent/70 hover:bg-accent/20"
    >
      End navigation
    </button>
  )

  if (!route) {
    // The store keeps a route set whenever it navigates, so this is a
    // backstop; it still offers the way out.
    return (
      <Panel surface="glass" compact>
        <PanelHeader
          title="Destination"
          minimized={minimized}
          onToggleMinimized={toggle}
          bodyId={bodyId}
          spacing="mb-1"
        >
          <header className="flex items-start justify-between gap-3">
            <h2 className="text-body font-semibold text-ink">Destination</h2>
            {end}
          </header>
        </PanelHeader>
        {!minimized && (
          <div id={bodyId}>
            <p className="text-body text-ink-muted">No route planned</p>
            <p className="mt-1 text-caption text-ink-subtle">
              Plan a route from the search bar in close-up view.
            </p>
          </div>
        )}
      </Panel>
    )
  }

  // A route is planned when its path has a method. Until then the strategy
  // is only the slot it was filed under, so the bar does not claim it: no
  // "Fastest route" for a path nobody computed.
  const planned = isAvailable(route.path)

  const destination = route.points.at(-1)

  return (
    <Panel surface="glass" compact>
      {/* Minimised, the bar keeps the destination and End navigation: this
          bar is the navigation screen's only way out. */}
      <PanelHeader
        title="Destination"
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        spacing="mb-2"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-ink">
              {destination?.label ?? 'Destination'}
            </h2>
            <p className="mt-0.5 text-caption text-ink-subtle">
              <span className="tabular-nums">
                {destination
                  ? formatMarsCoordinate(destination.coordinate)
                  : 'Route has no points'}
              </span>
              {' · '}
              {planned ? `${STRATEGY_LABEL[route.strategy]} route` : 'Not yet planned'}
            </p>
          </div>
          {end}
        </header>
      </PanelHeader>

      {!minimized && (
        <div id={bodyId}>
          {options.length > 1 && onSelect && (
            <RouteOptions options={options} selectedId={route.id} onSelect={onSelect} />
          )}

          {/* One row, label over value, so the bar stays short. */}
          <dl className="grid grid-cols-3 gap-x-3">
            <Metric label="Distance">
              <ClassifiedValue
                value={route.metrics.distanceKm}
                format={(km) => `${km.toFixed(2)} km`}
              />
            </Metric>
            <Metric label="Duration">
              <ClassifiedValue
                value={route.metrics.durationHours}
                format={(h) => `${h.toFixed(1)} h`}
              />
            </Metric>
            <Metric label="Energy">
              <ClassifiedValue
                value={route.metrics.metabolicEnergyKcal}
                format={(kcal) => `${Math.round(kcal)} kcal`}
              />
            </Metric>
            {/* The scientific route's measure: the map's units it crosses, named, never a score. */}
            {route.metrics.unitsCrossed && (
              <Metric label="Geologic units crossed" className="col-span-3 mt-1">
                <ClassifiedValue
                  value={route.metrics.unitsCrossed}
                  format={(names) => `${names.length}: ${names.join(', ')}`}
                />
              </Metric>
            )}
          </dl>
        </div>
      )}
    </Panel>
  )
}

function Metric({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-caption text-ink-subtle">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  )
}

/**
 * The options as native radios, two per row: one Tab stop, arrows move the
 * selection, no keyboard code of our own. The selected one is the route
 * the panels and the scene show. Each row says what is known: the DERIVED
 * distance; "Searching…" while its search still runs; or "Not drawn"
 * when it found no path. Both keep the UNAVAILABLE reason on the mark. The
 * input is visually hidden, so the row carries its focus ring.
 */
function RouteOptions({
  options,
  selectedId,
  onSelect,
}: {
  options: readonly RouteOption[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const name = useId()
  return (
    <fieldset className="mb-2 grid min-w-0 grid-cols-[auto_1fr] gap-1">
      <legend className="sr-only">Route options</legend>
      {options.map((option) => {
        const selected = option.id === selectedId
        const { path } = option
        return (
          <label
            key={option.id}
            className={`flex cursor-pointer flex-col rounded-control px-2 py-1 text-caption transition-colors duration-(--duration-fast) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--color-focus) ${
              selected
                ? 'bg-accent/15 text-ink'
                : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={selected}
              onChange={() => onSelect(option.id)}
              className="sr-only"
            />
            <span>{STRATEGY_LABEL[option.strategy]}</span>
            <span className="flex items-baseline gap-1 tabular-nums">
              {isAvailable(path) ? (
                <ClassifiedValue
                  value={option.metrics.distanceKm}
                  format={(km) => `${km.toFixed(1)} km`}
                />
              ) : (
                <>
                  {/* Still being searched reads as "Searching…", not as a failure. */}
                  <span className="text-ink-subtle">
                    {path.reason === SEARCH_PENDING_REASON ? 'Searching…' : 'Not drawn'}
                  </span>
                  <ClassificationBadge classification="UNAVAILABLE" detail={path.reason} />
                </>
              )}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
